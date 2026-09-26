import * as http from 'node:http';
import { HttpEmbeddingProvider } from './http-embedding.provider';
import { EmbeddingProviderUnavailableError, EmbeddingResponseInvalidError } from '../embedding-provider.port';
import { installGovernanceRuntime, resetGovernanceRuntimeForTest } from '../../common/governance/governance-runtime';

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

describe('HttpEmbeddingProvider', () => {
  const baseUrl = 'http://127.0.0.1:8100';
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it('connect()는 /health를 조회해 modelId·dimension을 고정한다', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ status: 'ok', modelId: 'kure-v1@main|noprefix|l2', dimension: 1024, device: 'cpu', warmedUp: true }),
    );
    const provider = await HttpEmbeddingProvider.connect(baseUrl);
    expect(provider.modelId).toBe('kure-v1@main|noprefix|l2');
    expect(provider.dimension).toBe(1024);
    expect(fetchMock).toHaveBeenCalledWith(`${baseUrl}/health`, expect.any(Object));
  });

  it('status가 loading이면 EmbeddingProviderUnavailableError를 던진다', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ status: 'loading', device: 'cpu' }));
    await expect(HttpEmbeddingProvider.connect(baseUrl)).rejects.toBeInstanceOf(
      EmbeddingProviderUnavailableError,
    );
  });

  it('embed()는 L2 정규화된 벡터를 Float32Array로 변환해 반환한다', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({ status: 'ok', modelId: 'm@1|noprefix|l2', dimension: 3, device: 'cpu', warmedUp: true }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ modelId: 'm@1|noprefix|l2', dimension: 3, vectors: [[0.1, 0.2, 0.3]] }),
      );
    const provider = await HttpEmbeddingProvider.connect(baseUrl);
    const vectors = await provider.embed(['안녕하세요'], 'QUERY');
    expect(vectors).toHaveLength(1);
    expect(vectors[0]).toBeInstanceOf(Float32Array);
    Array.from(vectors[0]).forEach((v, i) => expect(v).toBeCloseTo([0.1, 0.2, 0.3][i], 5));
  });

  it('배치 상한을 초과하면 네트워크 호출 없이 예외를 던진다', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ status: 'ok', modelId: 'm@1|noprefix|l2', dimension: 3, device: 'cpu', warmedUp: true }),
    );
    const provider = await HttpEmbeddingProvider.connect(baseUrl, { batchMax: 2 });
    fetchMock.mockClear();
    await expect(provider.embed(['a', 'b', 'c'], 'QUERY')).rejects.toBeInstanceOf(
      EmbeddingResponseInvalidError,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('HTTP 5xx는 EmbeddingProviderUnavailableError로 수렴한다', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({ status: 'ok', modelId: 'm@1|noprefix|l2', dimension: 3, device: 'cpu', warmedUp: true }),
      )
      .mockResolvedValueOnce(jsonResponse({}, 503));
    const provider = await HttpEmbeddingProvider.connect(baseUrl);
    await expect(provider.embed(['x'], 'QUERY')).rejects.toBeInstanceOf(EmbeddingProviderUnavailableError);
  });

  it('스키마와 다른 응답은 EmbeddingResponseInvalidError로 수렴한다(FR-0-42와 같은 원칙)', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({ status: 'ok', modelId: 'm@1|noprefix|l2', dimension: 3, device: 'cpu', warmedUp: true }),
      )
      .mockResolvedValueOnce(jsonResponse({ unexpected: true }));
    const provider = await HttpEmbeddingProvider.connect(baseUrl);
    await expect(provider.embed(['x'], 'QUERY')).rejects.toBeInstanceOf(EmbeddingResponseInvalidError);
  });

  it('런타임 중 modelId가 바뀌면 EmbeddingProviderUnavailableError를 던진다(EX-N1-2 대응)', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({ status: 'ok', modelId: 'm@1|noprefix|l2', dimension: 3, device: 'cpu', warmedUp: true }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ modelId: 'm@2|noprefix|l2', dimension: 3, vectors: [[0.1, 0.2, 0.3]] }),
      );
    const provider = await HttpEmbeddingProvider.connect(baseUrl);
    await expect(provider.embed(['x'], 'QUERY')).rejects.toBeInstanceOf(EmbeddingProviderUnavailableError);
  });

  it('네트워크 예외(타임아웃 포함)는 EmbeddingProviderUnavailableError로 수렴한다', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({ status: 'ok', modelId: 'm@1|noprefix|l2', dimension: 3, device: 'cpu', warmedUp: true }),
      )
      .mockRejectedValueOnce(new DOMException('The operation was aborted', 'AbortError'));
    const provider = await HttpEmbeddingProvider.connect(baseUrl);
    await expect(provider.embed(['x'], 'QUERY')).rejects.toBeInstanceOf(EmbeddingProviderUnavailableError);
  });

  it('healthy()는 예외를 던지지 않고 boolean만 반환한다', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({ status: 'ok', modelId: 'm@1|noprefix|l2', dimension: 3, device: 'cpu', warmedUp: true }),
      )
      .mockRejectedValueOnce(new Error('connection refused'));
    const provider = await HttpEmbeddingProvider.connect(baseUrl);
    await expect(provider.healthy()).resolves.toBe(false);
  });
  describe('타임아웃 분리 — 단건(대화 예산) vs 배치(관리자 경로)', () => {
    const health = { status: 'ok', modelId: 'm@1|noprefix|l2', dimension: 3, device: 'cpu', warmedUp: true };

    /** signal이 abort될 때까지 대기하다가, `delayMs` 뒤에는 정상 응답을 준다. */
    function slowEmbed(delayMs: number, count: number) {
      return (_url: string, init?: RequestInit): Promise<Response> =>
        new Promise((resolve, reject) => {
          const timer = setTimeout(
            () => resolve(jsonResponse({ modelId: 'm@1|noprefix|l2', dimension: 3, vectors: Array.from({ length: count }, () => [0.1, 0.2, 0.3]) })),
            delayMs,
          );
          init?.signal?.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
          });
        });
    }

    it('단건 호출은 timeoutMs를 넘기면 "시간 초과" 사유로 실패한다', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(health));
      const provider = await HttpEmbeddingProvider.connect(baseUrl, { timeoutMs: 20, batchTimeoutMs: 1000 });
      fetchMock.mockImplementationOnce(slowEmbed(100, 1));
      await expect(provider.embed(['x'], 'QUERY')).rejects.toThrow('ml-worker 호출 시간 초과(20ms)');
    });

    it('배치 호출은 timeoutMs를 넘겨도 batchTimeoutMs 안이면 성공한다(CPU 재색인 회귀 방지)', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(health));
      const provider = await HttpEmbeddingProvider.connect(baseUrl, { timeoutMs: 20, batchTimeoutMs: 1000 });
      fetchMock.mockImplementationOnce(slowEmbed(100, 3));
      const vectors = await provider.embed(['a', 'b', 'c'], 'PASSAGE');
      expect(vectors).toHaveLength(3);
    });

    it('배치 호출도 batchTimeoutMs를 넘기면 실패한다', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(health));
      const provider = await HttpEmbeddingProvider.connect(baseUrl, { timeoutMs: 10, batchTimeoutMs: 30 });
      fetchMock.mockImplementationOnce(slowEmbed(200, 2));
      await expect(provider.embed(['a', 'b'], 'PASSAGE')).rejects.toThrow('ml-worker 호출 시간 초과(30ms)');
    });
  });
});

/**
 * M-1(코드 리뷰 R1) 회귀 시험 — 실제 `http` 서버로 리다이렉트를 재현한다(jest 목 fetch는
 * `redirect:'manual'` 의미를 실제로 검증하지 못한다). 모드 ON(enforce)에서는 허용 호스트가 비허용
 * 호스트로 3xx를 돌려줘도 그 호스트로 넘어가지 않고 기존 실패 경로(`EmbeddingProviderUnavailableError`)로
 * 수렴해야 한다. 모드 OFF에서는 기존(`follow`) 동작이 그대로 유지되어야 한다(§27 I-11 결정).
 */
describe('HttpEmbeddingProvider — 리다이렉트로 출구 게이트 우회 차단(M-1)', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    resetGovernanceRuntimeForTest();
    global.fetch = originalFetch;
  });

  function startRedirectServer(locationUrl: string): Promise<{ url: string; close: () => Promise<void>; hitCount: () => number }> {
    return new Promise((resolve) => {
      let hits = 0;
      const server = http.createServer((_req, res) => {
        hits += 1;
        res.writeHead(302, { Location: locationUrl });
        res.end();
      });
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        const port = typeof address === 'object' && address ? address.port : 0;
        resolve({
          url: `http://127.0.0.1:${port}`,
          close: () => new Promise((r) => server.close(() => r())),
          hitCount: () => hits,
        });
      });
    });
  }

  function startTargetServer(): Promise<{ url: string; close: () => Promise<void>; hitCount: () => number }> {
    return new Promise((resolve) => {
      let hits = 0;
      const server = http.createServer((_req, res) => {
        hits += 1;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', modelId: 'm@1|noprefix|l2', dimension: 3, device: 'cpu', warmedUp: true }));
      });
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        const port = typeof address === 'object' && address ? address.port : 0;
        resolve({
          url: `http://127.0.0.1:${port}`,
          close: () => new Promise((r) => server.close(() => r())),
          hitCount: () => hits,
        });
      });
    });
  }

  it('모드 ON: 허용 호스트가 비허용 호스트로 3xx를 돌려주면 그 호스트로 넘어가지 않고 실패로 수렴한다', async () => {
    global.fetch = originalFetch;
    const target = await startTargetServer(); // 비허용 호스트(리다이렉트 대상) — 절대 호출되면 안 된다
    const redirector = await startRedirectServer(target.url);
    try {
      const allowedHost = new URL(redirector.url).host; // 127.0.0.1:<port> — 리다이렉트 대상은 목록 밖
      installGovernanceRuntime({ mode: 'ON', egress: { allowlist: [allowedHost], enforce: true }, encryptionEnabled: false });

      await expect(HttpEmbeddingProvider.connect(redirector.url)).rejects.toBeInstanceOf(EmbeddingProviderUnavailableError);
      expect(target.hitCount()).toBe(0); // 리다이렉트 대상은 한 번도 호출되지 않았다
      expect(redirector.hitCount()).toBe(1);
    } finally {
      await redirector.close();
      await target.close();
    }
  });

  it('모드 OFF(기본): 기존 follow 동작이 그대로 유지되어 리다이렉트를 따라간다', async () => {
    global.fetch = originalFetch;
    const target = await startTargetServer();
    const redirector = await startRedirectServer(target.url);
    try {
      // installGovernanceRuntime을 호출하지 않는다 — 미설치 기본값(mode='OFF', enforce=false).
      const provider = await HttpEmbeddingProvider.connect(redirector.url);
      expect(provider.modelId).toBe('m@1|noprefix|l2');
      expect(target.hitCount()).toBe(1); // 최종 목적지까지 정상적으로 도달했다(follow)
    } finally {
      await redirector.close();
      await target.close();
    }
  });
});
