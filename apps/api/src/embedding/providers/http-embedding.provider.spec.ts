import { HttpEmbeddingProvider } from './http-embedding.provider';
import { EmbeddingProviderUnavailableError, EmbeddingResponseInvalidError } from '../embedding-provider.port';

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
});
