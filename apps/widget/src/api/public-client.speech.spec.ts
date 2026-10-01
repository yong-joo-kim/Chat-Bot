import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPublicClient, SpeechClientError } from './public-client';

const BASE = 'https://api.example.test/api/v1';
const SLUG = 'voice-bot';

function res(status: number, body?: unknown, jsonThrows = false): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      if (jsonThrows) throw new Error('not json');
      return body;
    },
  } as Response;
}

afterEach(() => vi.unstubAllGlobals());

describe('sendMessage features — speech-v1은 opts.speech === true일 때만(요청 바이트 불변)', () => {
  it('opts 없음·speech 없음·false → features 3개 그대로', async () => {
    const fetchMock = vi.fn(async () => res(200, { messageId: 'x', outputs: [], state: {}, stateReset: false }));
    vi.stubGlobal('fetch', fetchMock);
    const client = createPublicClient(BASE, SLUG);
    await client.sendMessage({ sessionId: 's', message: 'a' });
    await client.sendMessage({ sessionId: 's', message: 'a' }, { speech: false });
    const bodies = fetchMock.mock.calls.map((c) => (c as unknown as [string, RequestInit])[1].body as string);
    expect(bodies[0]).toBe(bodies[1]); // 바이트 동일
    expect(JSON.parse(bodies[0]).features).toEqual(['handoff-v1', 'feedback-v1', 'rich-v1']);
  });

  it('speech: true → 끝에 speech-v1', async () => {
    const fetchMock = vi.fn(async () => res(200, { messageId: 'x', outputs: [], state: {}, stateReset: false }));
    vi.stubGlobal('fetch', fetchMock);
    await createPublicClient(BASE, SLUG).sendMessage({ sessionId: 's', message: 'a' }, { speech: true });
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.features).toEqual(['handoff-v1', 'feedback-v1', 'rich-v1', 'speech-v1']);
  });
});

describe('transcribeSpeech — 녹음 바이트 그대로 POST(설계 §9.6)', () => {
  it('경로·메서드·헤더·credentials·본문(Blob 그대로)', async () => {
    const fetchMock = vi.fn(async () => res(200, { text: '안녕하세요', durationMs: 1200 }));
    vi.stubGlobal('fetch', fetchMock);
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/webm;codecs=opus' });
    const ac = new AbortController();
    const result = await createPublicClient(BASE, SLUG).transcribeSpeech(blob, '11111111-1111-4111-8111-111111111111', ac.signal);
    expect(result).toEqual({ text: '안녕하세요', durationMs: 1200 });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${BASE}/public/chatbots/${SLUG}/speech/transcriptions`);
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('omit');
    expect(init.body).toBe(blob);
    expect(init.signal).toBe(ac.signal);
    expect(init.headers).toEqual({ 'Content-Type': 'audio/webm;codecs=opus', 'x-cb-session-id': '11111111-1111-4111-8111-111111111111' });
  });

  it('Blob 형식이 비어 있으면 application/octet-stream', async () => {
    const fetchMock = vi.fn(async () => res(200, { text: 'a', durationMs: 1 }));
    vi.stubGlobal('fetch', fetchMock);
    await createPublicClient(BASE, SLUG).transcribeSpeech(new Blob([new Uint8Array(1)]), 's', new AbortController().signal);
    expect(((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].headers as Record<string, string>)['Content-Type']).toBe('application/octet-stream');
  });

  it('empty: true를 그대로 돌려준다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res(200, { text: '', durationMs: 500, empty: true })));
    const r = await createPublicClient(BASE, SLUG).transcribeSpeech(new Blob(['x']), 's', new AbortController().signal);
    expect(r.empty).toBe(true);
  });

  it.each([
    [503, 'SPEECH_UNAVAILABLE', 'UNAVAILABLE'],
    [503, 'SPEECH_BUSY', 'BUSY'],
    [400, 'SPEECH_AUDIO_INVALID', 'INVALID'],
    [413, 'SPEECH_AUDIO_TOO_LARGE', 'TOO_LARGE'],
    [502, 'SPEECH_FAILED', 'FAILED'],
    [400, 'VALIDATION_FAILED', 'SESSION'],
    [429, 'RATE_LIMITED', 'RATE_LIMITED'],
    [403, 'ORIGIN_NOT_ALLOWED', 'DISABLED'],
  ])('%i %s → %s', async (status, code, kind) => {
    vi.stubGlobal('fetch', vi.fn(async () => res(status, { statusCode: status, code, message: 'm' })));
    await expect(createPublicClient(BASE, SLUG).transcribeSpeech(new Blob(['x']), 's', new AbortController().signal)).rejects.toMatchObject({ kind });
  });

  it('본문 없는 5xx·알 수 없는 코드 → FAILED(503은 UNAVAILABLE)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res(500, undefined, true)));
    await expect(createPublicClient(BASE, SLUG).transcribeSpeech(new Blob(['x']), 's', new AbortController().signal)).rejects.toMatchObject({ kind: 'FAILED' });
    vi.stubGlobal('fetch', vi.fn(async () => res(503, undefined, true)));
    await expect(createPublicClient(BASE, SLUG).transcribeSpeech(new Blob(['x']), 's', new AbortController().signal)).rejects.toMatchObject({ kind: 'UNAVAILABLE' });
  });

  it('네트워크 오류 → NETWORK · 중단(abort)은 AbortError 그대로(취소·시간 초과는 호출부가 구분)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('failed'))));
    const err = await createPublicClient(BASE, SLUG)
      .transcribeSpeech(new Blob(['x']), 's', new AbortController().signal)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SpeechClientError);
    expect((err as SpeechClientError).kind).toBe('NETWORK');

    const ac = new AbortController();
    ac.abort();
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(Object.assign(new Error('a'), { name: 'AbortError' }))));
    const aborted = await createPublicClient(BASE, SLUG)
      .transcribeSpeech(new Blob(['x']), 's', ac.signal)
      .catch((e: unknown) => e);
    expect(aborted).not.toBeInstanceOf(SpeechClientError);
    expect((aborted as Error).name).toBe('AbortError');
  });

  it('200인데 응답 형식이 이상하면 FAILED', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res(200, { nope: 1 })));
    await expect(createPublicClient(BASE, SLUG).transcribeSpeech(new Blob(['x']), 's', new AbortController().signal)).rejects.toMatchObject({ kind: 'FAILED' });
  });
});
