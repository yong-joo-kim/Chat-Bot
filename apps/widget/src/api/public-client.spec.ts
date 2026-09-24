import { describe, expect, it, vi, afterEach } from 'vitest';
import { createPublicClient } from './public-client';

const SLUG = 'order-bot';
const API_BASE = 'https://api.example.test/api/v1';

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('widget api/public-client — No.24 계약 확장(ADR-0036)', () => {
  it('sendMessage는 항상 features:["handoff-v1"]를 본문에 싣는다', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ messageId: '1', outputs: [], state: {}, stateReset: false }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const client = createPublicClient(API_BASE, SLUG);

    await client.sendMessage({ sessionId: 'sess-1', message: '안녕' });

    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(String(init?.body)) as { features?: string[] };
    expect(body.features).toEqual(['handoff-v1']);
  });

  it('토큰이 있으면 x-cb-handoff-token 헤더를 보내고 Content-Type은 그대로 유지한다(헤더 병합 결함 수정)', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ messageId: '1', outputs: [], state: {}, stateReset: false }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const client = createPublicClient(API_BASE, SLUG);

    await client.sendMessage({ sessionId: 'sess-1', message: '안녕' }, { handoffToken: 'tok-xyz' });

    const [, init] = fetchMock.mock.calls[0];
    const headers = init?.headers as Record<string, string>;
    expect(headers['x-cb-handoff-token']).toBe('tok-xyz');
    expect(headers['Content-Type']).toBe('application/json');
  });

  it('토큰이 없으면 handoff-token 헤더를 보내지 않는다', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ messageId: '1', outputs: [], state: {}, stateReset: false }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const client = createPublicClient(API_BASE, SLUG);

    await client.sendMessage({ sessionId: 'sess-1', message: '안녕' });

    const [, init] = fetchMock.mock.calls[0];
    const headers = init?.headers as Record<string, string>;
    expect(headers['x-cb-handoff-token']).toBeUndefined();
    expect(headers['Content-Type']).toBe('application/json');
  });

  it('pollHandoff은 세션 헤더(필수)·토큰 헤더(선택)·after/restore 쿼리를 보낸다', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ status: 'CONNECTED', messages: [], cursor: 7, pollAfterMs: 3000 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const client = createPublicClient(API_BASE, SLUG);

    await client.pollHandoff({ sessionId: 'sess-1', token: 'tok-xyz', after: 5, restore: true });

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/handoff?after=5&restore=true');
    const headers = init?.headers as Record<string, string>;
    expect(headers['x-cb-session-id']).toBe('sess-1');
    expect(headers['x-cb-handoff-token']).toBe('tok-xyz');
  });

  it('pollHandoff은 토큰이 없으면 세션 헤더만 보낸다', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ status: 'NONE', messages: [], cursor: 0, pollAfterMs: 5000 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const client = createPublicClient(API_BASE, SLUG);

    await client.pollHandoff({ sessionId: 'sess-1', after: 0 });

    const [, init] = fetchMock.mock.calls[0];
    const headers = init?.headers as Record<string, string>;
    expect(headers['x-cb-session-id']).toBe('sess-1');
    expect(headers['x-cb-handoff-token']).toBeUndefined();
  });

  it('pollHandoff 404는 NOT_FOUND로 분류한다(§6.3 토큰 무효·교차·유예 경과)', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({}, 404));
    vi.stubGlobal('fetch', fetchMock);
    const client = createPublicClient(API_BASE, SLUG);

    await expect(client.pollHandoff({ sessionId: 'sess-1', after: 0 })).rejects.toMatchObject({ kind: 'NOT_FOUND' });
  });

  it('pollHandoff 429는 RATE_LIMITED로 분류한다(§7.3 폴링 전용 버킷)', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({}, 429));
    vi.stubGlobal('fetch', fetchMock);
    const client = createPublicClient(API_BASE, SLUG);

    await expect(client.pollHandoff({ sessionId: 'sess-1', after: 0 })).rejects.toMatchObject({ kind: 'RATE_LIMITED' });
  });
});
