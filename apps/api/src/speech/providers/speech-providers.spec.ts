import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import { installGovernanceRuntime, resetGovernanceRuntimeForTest } from '../../common/governance/governance-runtime';
import { LocalSpeechRecognitionProvider, UnconfiguredSpeechRecognitionProvider } from './local-speech-recognition.provider';
import { MOCK_DEFAULT_TEXT, MockSpeechRecognitionProvider } from './mock-speech-recognition.provider';
import { createSpeechRecognitionProvider } from './speech-recognition-provider.factory';

const input = (bytes: Uint8Array | string) => ({ audio: typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes, contentType: 'audio/webm', language: 'ko' as const });

describe('MockSpeechRecognitionProvider(§7.3 결정적 규칙)', () => {
  const mock = new MockSpeechRecognitionProvider();

  it('MOCK: 접두 → 나머지를 UTF-8 글자로(시험 주입)', async () => {
    expect(await mock.transcribe(input('MOCK:구공공일일이 다시 일이삼사오육칠'))).toMatchObject({ kind: 'OK', text: '구공공일일이 다시 일이삼사오육칠' });
  });
  it('전부 0 바이트 → EMPTY · MOCK-INVALID → INVALID_AUDIO · MOCK-BUSY → BUSY', async () => {
    expect(await mock.transcribe(input(new Uint8Array(64)))).toMatchObject({ kind: 'EMPTY' });
    expect(await mock.transcribe(input('MOCK-INVALID'))).toEqual({ kind: 'INVALID_AUDIO' });
    expect(await mock.transcribe(input('MOCK-BUSY'))).toEqual({ kind: 'BUSY' });
  });
  it('그 밖 → 고정 글자 · durationMs는 바이트 수 기반 결정값', async () => {
    const a = await mock.transcribe(input('some bytes of audio'));
    const b = await mock.transcribe(input('some bytes of audio'));
    expect(a).toEqual(b);
    expect(a).toMatchObject({ kind: 'OK', text: MOCK_DEFAULT_TEXT });
  });
  it('항상 사용 가능 · 공급자 id', async () => {
    expect(await mock.healthy()).toBe(true);
    expect(mock.providerId).toBe('mock');
  });
});

describe('createSpeechRecognitionProvider(교체 지점 1곳)', () => {
  it('mock · local(+주소) · local(주소 없음 = 사용 불가로 안전 수렴)', async () => {
    const cfg = (values: Record<string, string | undefined>) => ({ get: <T,>(k: string) => values[k] as unknown as T });
    expect(createSpeechRecognitionProvider(cfg({})).providerId).toBe('mock');
    expect(createSpeechRecognitionProvider(cfg({ SPEECH_PROVIDER: 'mock' })).providerId).toBe('mock');
    expect(createSpeechRecognitionProvider(cfg({ SPEECH_PROVIDER: 'local', ML_WORKER_SPEECH_URL: 'http://127.0.0.1:1' })).providerId).toBe('local');
    const unconfigured = createSpeechRecognitionProvider(cfg({ SPEECH_PROVIDER: 'local' }));
    expect(unconfigured).toBeInstanceOf(UnconfiguredSpeechRecognitionProvider);
    expect(await unconfigured.healthy()).toBe(false);
    expect(await unconfigured.transcribe(input('x'), { timeoutMs: 100 })).toEqual({ kind: 'FAILED', cause: 'NOT_CONFIGURED' });
  });
});

describe('LocalSpeechRecognitionProvider(출구 SPEECH_LOCAL — 가짜 ml-worker)', () => {
  type Handler = (req: http.IncomingMessage, res: http.ServerResponse, body: Buffer) => void;
  let server: http.Server;
  let baseUrl: string;
  let handler: Handler;
  let received: Array<{ method?: string; url?: string; contentType?: string; length: number }> = [];

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        const body = Buffer.concat(chunks);
        received.push({ method: req.method, url: req.url, contentType: req.headers['content-type'], length: body.length });
        handler(req, res, body);
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  beforeEach(() => {
    received = [];
  });
  afterEach(() => resetGovernanceRuntimeForTest());

  const json = (res: http.ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };

  it('원시 바이트 본문(application/octet-stream)으로 보내고 200을 OK로 매핑한다 — modelId는 결과에 없다', async () => {
    handler = (_req, res) => json(res, 200, { modelId: 'secret-model', text: '안녕하세요', durationMs: 1234, empty: false });
    const provider = new LocalSpeechRecognitionProvider(baseUrl, {});
    const outcome = await provider.transcribe(input('0123456789'), { timeoutMs: 2000 });
    expect(outcome).toEqual({ kind: 'OK', text: '안녕하세요', durationMs: 1234 });
    expect(JSON.stringify(outcome)).not.toContain('secret-model');
    expect(received[0]).toMatchObject({ method: 'POST', url: '/speech/transcribe', contentType: 'application/octet-stream', length: 10 });
  });

  it('empty:true 또는 빈 글자 → EMPTY', async () => {
    handler = (_req, res) => json(res, 200, { modelId: 'm', text: '', durationMs: 900, empty: true });
    expect(await new LocalSpeechRecognitionProvider(baseUrl, {}).transcribe(input('x'), { timeoutMs: 2000 })).toEqual({ kind: 'EMPTY', durationMs: 900 });
  });

  it.each([
    [400, { detail: 'INVALID' }, { kind: 'INVALID_AUDIO' }],
    [413, { detail: 'TOO_LARGE' }, { kind: 'TOO_LONG' }],
    [413, { detail: 'TOO_LONG' }, { kind: 'TOO_LONG' }],
    [503, { detail: 'BUSY' }, { kind: 'BUSY' }],
    [503, { detail: 'LOADING' }, { kind: 'FAILED', cause: 'HTTP_5XX' }],
    [504, { detail: 'DEADLINE' }, { kind: 'FAILED', cause: 'TIMEOUT' }],
    [500, { detail: 'FAILED' }, { kind: 'FAILED', cause: 'HTTP_5XX' }],
  ])('HTTP %i %j → %j', async (status, body, expected) => {
    handler = (_req, res) => json(res, status, body);
    expect(await new LocalSpeechRecognitionProvider(baseUrl, {}).transcribe(input('x'), { timeoutMs: 2000 })).toEqual(expected);
  });

  it('응답 형식 불량 → FAILED(INVALID_RESPONSE)', async () => {
    handler = (_req, res) => json(res, 200, { nothing: true });
    expect(await new LocalSpeechRecognitionProvider(baseUrl, {}).transcribe(input('x'), { timeoutMs: 2000 })).toEqual({ kind: 'FAILED', cause: 'INVALID_RESPONSE' });
    handler = (_req, res) => {
      res.writeHead(200);
      res.end('not json');
    };
    expect(await new LocalSpeechRecognitionProvider(baseUrl, {}).transcribe(input('x'), { timeoutMs: 2000 })).toEqual({ kind: 'FAILED', cause: 'INVALID_RESPONSE' });
  });

  it('제한 시간 초과 → TIMEOUT · 연결 실패 → NETWORK', async () => {
    handler = () => undefined; // 응답하지 않는다
    expect(await new LocalSpeechRecognitionProvider(baseUrl, {}).transcribe(input('x'), { timeoutMs: 80 })).toEqual({ kind: 'FAILED', cause: 'TIMEOUT' });
    expect(await new LocalSpeechRecognitionProvider('http://127.0.0.1:1', {}).transcribe(input('x'), { timeoutMs: 1000 })).toEqual({ kind: 'FAILED', cause: 'NETWORK' });
  });

  it('거버넌스 모드 ON ∧ 허용 목록 밖 → 송신 0 · FAILED(EGRESS_BLOCKED)', async () => {
    installGovernanceRuntime({ mode: 'ON', egress: { allowlist: ['some-other-host.internal'], enforce: true }, encryptionEnabled: false });
    handler = (_req, res) => json(res, 200, { text: 'x', durationMs: 1 });
    const provider = new LocalSpeechRecognitionProvider(baseUrl, {});
    expect(await provider.transcribe(input('x'), { timeoutMs: 1000 })).toEqual({ kind: 'FAILED', cause: 'EGRESS_BLOCKED' });
    expect(await provider.healthy()).toBe(false);
    expect(received).toHaveLength(0);
  });

  it('거버넌스 모드 ON ∧ 허용 목록 안 → 송신한다', async () => {
    installGovernanceRuntime({ mode: 'ON', egress: { allowlist: ['127.0.0.1'], enforce: true }, encryptionEnabled: false });
    handler = (_req, res) => json(res, 200, { text: '허용됨', durationMs: 10 });
    expect(await new LocalSpeechRecognitionProvider(baseUrl, {}).transcribe(input('x'), { timeoutMs: 2000 })).toMatchObject({ kind: 'OK', text: '허용됨' });
  });

  describe('healthy() — 운영 mock 백엔드 판정(DD-135 ③)', () => {
    it('GET /speech/health status ok → 참, loading → 거짓', async () => {
      handler = (_req, res) => json(res, 200, { status: 'ok', backend: 'faster-whisper', modelId: 'm' });
      const provider = new LocalSpeechRecognitionProvider(baseUrl, { NODE_ENV: 'production' });
      expect(await provider.healthy()).toBe(true);
      expect(received[0]).toMatchObject({ method: 'GET', url: '/speech/health' });
      handler = (_req, res) => json(res, 200, { status: 'loading', backend: 'faster-whisper' });
      expect(await provider.healthy()).toBe(false);
      handler = (_req, res) => json(res, 503, { detail: 'x' });
      expect(await provider.healthy()).toBe(false);
    });

    it('운영 ∧ backend mock → 사용 불가(거짓)', async () => {
      handler = (_req, res) => json(res, 200, { status: 'ok', backend: 'mock' });
      expect(await new LocalSpeechRecognitionProvider(baseUrl, { NODE_ENV: 'production' }).healthy()).toBe(false);
    });

    it('비운영 ∧ backend mock → 사용 가능(시연·개발에서 mock ml-worker 허용)', async () => {
      handler = (_req, res) => json(res, 200, { status: 'ok', backend: 'mock' });
      expect(await new LocalSpeechRecognitionProvider(baseUrl, { NODE_ENV: 'development' }).healthy()).toBe(true);
      expect(await new LocalSpeechRecognitionProvider(baseUrl, {}).healthy()).toBe(true);
    });

    it('연결 실패 → 거짓(예외 없음)', async () => {
      expect(await new LocalSpeechRecognitionProvider('http://127.0.0.1:1', {}).healthy()).toBe(false);
    });
  });
});
