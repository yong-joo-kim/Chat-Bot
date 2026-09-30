import * as http from 'node:http';
import { installGovernanceRuntime, resetGovernanceRuntimeForTest } from '../../common/governance/governance-runtime';
import type { MaskedUtteranceText } from '../lib/prepare-utterances';
import { ClusterNameHttpClient } from './cluster-name-http.client';
import { ClusterNameSuggesterFactory } from './cluster-name-suggester.factory';
import { MockClusterNameSuggester } from './mock-cluster-name.suggester';

/**
 * 묶음 이름 제안 출구 파일 단위 시험(설계서 §16.3 · DC-11) — 실제 `http` 서버로 계약(요청 본문 · 응답 파싱 · null 수렴)과
 * 출구 게이트(허용 목록 · 리다이렉트)를 확인한다. 예외는 던지지 않고 전부 `null`이다.
 */

interface FakeServer {
  url: string;
  bodies: Array<Record<string, unknown>>;
  hits: () => number;
  close: () => Promise<void>;
}

function startServer(handler: (req: http.IncomingMessage, res: http.ServerResponse, body: string) => void): Promise<FakeServer> {
  return new Promise((resolve) => {
    let hits = 0;
    const bodies: FakeServer['bodies'] = [];
    const server = http.createServer((req, res) => {
      hits += 1;
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        try {
          bodies.push(JSON.parse(raw) as Record<string, unknown>);
        } catch {
          // 본문이 없는 요청
        }
        handler(req, res, raw);
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      resolve({ url: `http://127.0.0.1:${port}`, bodies, hits: () => hits, close: () => new Promise((r) => (server.closeAllConnections?.(), server.close(() => r()))) });
    });
  });
}

const json = (res: http.ServerResponse, body: unknown, status = 200) => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
};

const input = { keywords: ['환불', '신청'], samples: ['환불 신청은 어떻게 하나요' as MaskedUtteranceText, '전화는 [전화번호] 입니다' as MaskedUtteranceText] };

describe('ClusterNameHttpClient — 이름 제안 출구(ml-worker /cluster-label)', () => {
  afterEach(() => {
    resetGovernanceRuntimeForTest();
  });

  it('요청 본문 = { keywords, samples, locale: "ko" } · 응답 label을 그대로 돌려준다', async () => {
    const server = await startServer((_req, res) => json(res, { modelId: 'm', label: '환불 신청 문의' }));
    try {
      const client = new ClusterNameHttpClient({ baseUrl: server.url, timeoutMs: 2000 });
      expect(await client.suggest(input, new AbortController().signal)).toBe('환불 신청 문의');
      expect(server.bodies).toEqual([{ keywords: ['환불', '신청'], samples: ['환불 신청은 어떻게 하나요', '전화는 [전화번호] 입니다'], locale: 'ko' }]);
      expect(client.suggesterId).toBe('local');
    } finally {
      await server.close();
    }
  });

  it('label=null · 비200 · 스키마 불일치 · 연결 실패는 전부 null(예외 없음)', async () => {
    const cases: Array<(res: http.ServerResponse) => void> = [
      (res) => json(res, { modelId: 'm', label: null }),
      (res) => json(res, { error: 'x' }, 500),
      (res) => json(res, { unexpected: true }),
      (res) => json(res, { modelId: 'm', label: 123 }),
      (res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('not json');
      },
    ];
    for (const respond of cases) {
      const server = await startServer((_req, res) => respond(res));
      try {
        const client = new ClusterNameHttpClient({ baseUrl: server.url, timeoutMs: 2000 });
        expect(await client.suggest(input, new AbortController().signal)).toBeNull();
      } finally {
        await server.close();
      }
    }
    // 아무도 듣지 않는 포트
    expect(await new ClusterNameHttpClient({ baseUrl: 'http://127.0.0.1:1', timeoutMs: 1000 }).suggest(input, new AbortController().signal)).toBeNull();
  });

  it('응답이 없으면 시간 제한에서 null · 바깥 신호(예산)로도 끊긴다', async () => {
    const server = await startServer(() => undefined); // 응답하지 않는다
    try {
      const client = new ClusterNameHttpClient({ baseUrl: server.url, timeoutMs: 200 });
      const started = Date.now();
      expect(await client.suggest(input, new AbortController().signal)).toBeNull();
      expect(Date.now() - started).toBeLessThan(2000);

      const outer = new AbortController();
      const slow = new ClusterNameHttpClient({ baseUrl: server.url, timeoutMs: 10_000 });
      setTimeout(() => outer.abort(), 100);
      const t0 = Date.now();
      expect(await slow.suggest(input, outer.signal)).toBeNull();
      expect(Date.now() - t0).toBeLessThan(3000);
      // 이미 중단된 신호는 요청 자체를 보내지 않는다
      const before = server.hits();
      const aborted = new AbortController();
      aborted.abort();
      expect(await slow.suggest(input, aborted.signal)).toBeNull();
      expect(server.hits()).toBe(before);
    } finally {
      await server.close();
    }
  });

  it('모드 ON — 허용 목록에 없는 호스트에는 요청을 보내지 않는다(null)', async () => {
    const server = await startServer((_req, res) => json(res, { modelId: 'm', label: '환불 신청 문의' }));
    try {
      installGovernanceRuntime({ mode: 'ON', egress: { allowlist: ['other.example.com'], enforce: true }, encryptionEnabled: false });
      const client = new ClusterNameHttpClient({ baseUrl: server.url, timeoutMs: 2000 });
      expect(await client.suggest(input, new AbortController().signal)).toBeNull();
      expect(server.hits()).toBe(0);
    } finally {
      await server.close();
    }
  });

  it('모드 ON — 허용 호스트가 3xx로 다른 호스트를 가리켜도 따라가지 않는다(리다이렉트 우회 차단)', async () => {
    const target = await startServer((_req, res) => json(res, { modelId: 'm', label: '우회 성공' }));
    const redirector = await startServer((_req, res) => {
      res.writeHead(302, { Location: `${target.url}/cluster-label` });
      res.end();
    });
    try {
      installGovernanceRuntime({ mode: 'ON', egress: { allowlist: [new URL(redirector.url).host], enforce: true }, encryptionEnabled: false });
      const client = new ClusterNameHttpClient({ baseUrl: redirector.url, timeoutMs: 2000 });
      expect(await client.suggest(input, new AbortController().signal)).toBeNull();
      expect(target.hits()).toBe(0);
      expect(redirector.hits()).toBe(1);
    } finally {
      await redirector.close();
      await target.close();
    }
  });

  it('모드 ON — 허용된 호스트는 정상 호출된다', async () => {
    const server = await startServer((_req, res) => json(res, { modelId: 'm', label: '환불 신청 문의' }));
    try {
      installGovernanceRuntime({ mode: 'ON', egress: { allowlist: [new URL(server.url).host], enforce: true }, encryptionEnabled: false });
      const client = new ClusterNameHttpClient({ baseUrl: server.url, timeoutMs: 2000 });
      expect(await client.suggest(input, new AbortController().signal)).toBe('환불 신청 문의');
    } finally {
      await server.close();
    }
  });
});

describe('MockClusterNameSuggester · ClusterNameSuggesterFactory', () => {
  it('mock은 결정론적으로 "키워드1 키워드2 문의"를 만든다(키워드 없으면 null)', async () => {
    const mock = new MockClusterNameSuggester();
    expect(await mock.suggest(input)).toBe('환불 신청 문의');
    expect(await mock.suggest({ keywords: ['환불'], samples: [] })).toBe('환불 문의');
    expect(await mock.suggest({ keywords: [], samples: [] })).toBeNull();
    expect(mock.suggesterId).toBe('mock');
  });

  it('팩토리 — 설정이 꺼졌거나 로컬 생성기 주소가 없으면 인스턴스를 만들지 않는다(생성 백엔드 호출 0)', () => {
    const make = (values: Record<string, unknown>) => new ClusterNameSuggesterFactory({ get: (k: string) => values[k] } as never);
    expect(make({}).create()).toBeUndefined();
    expect(make({ UTTERANCE_ANALYSIS_NAME_SUGGEST_ENABLED: true }).create()).toBeUndefined(); // 주소 없음
    expect(make({ AUGMENTATION_LOCAL_BASE_URL: 'http://gen:8101' }).create()).toBeUndefined(); // 설정 꺼짐
    expect(make({ UTTERANCE_ANALYSIS_NAME_SUGGEST_ENABLED: false, AUGMENTATION_LOCAL_BASE_URL: 'http://gen:8101' }).isAvailable()).toBe(false);
    const on = make({ UTTERANCE_ANALYSIS_NAME_SUGGEST_ENABLED: true, AUGMENTATION_LOCAL_BASE_URL: 'http://gen:8101' });
    expect(on.isAvailable()).toBe(true);
    expect(on.create()?.suggesterId).toBe('local');
  });
});
