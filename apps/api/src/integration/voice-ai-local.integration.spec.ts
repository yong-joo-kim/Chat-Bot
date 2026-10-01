import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { GovernanceMapResponse, VoiceOverviewResponse, VoiceSettingsInput } from '@chat-bot/shared-types';
import { bootHarness, eventually } from './helpers/ai-guardrails.harness';
import type { Harness } from './helpers/ai-guardrails.harness';
import { rawPost } from './helpers/voice-ai.helpers';

/**
 * 음성 AI(No.32) — **운영(NODE_ENV=production) ∧ local 공급자 ∧ 거버넌스 모드 ON** 통합 시험(voice-ai-설계.md §7.2 · §11.2 · §12.3 · DD-135 ③).
 * 가짜 ml-worker(`/speech/health`·`/speech/transcribe`)로 확인한다: ① 운영에서 ml-worker 백엔드가 `mock`이면 사용 불가(마이크 숨김 · 송신 0)
 * ② 백엔드가 실제 값이면 사용 가능 + 원시 바이트 본문 전달 ③ ml-worker 오류 상태 → API 오류 코드 매핑 ④ 데이터 지도 `SPEECH_LOCAL` 행 · 허용 판정.
 */

interface FakeWorker {
  url: string;
  backend: string;
  healthCalls: number;
  transcribeCalls: number;
  lastBody?: Buffer;
  lastContentType?: string;
  respond?: (res: http.ServerResponse) => void;
  close(): Promise<void>;
}

async function startFakeWorker(): Promise<FakeWorker> {
  const worker: FakeWorker = {
    url: '',
    backend: 'mock',
    healthCalls: 0,
    transcribeCalls: 0,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
  const server = http.createServer((req, res) => {
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (req.method === 'GET' && req.url === '/speech/health') {
      worker.healthCalls += 1;
      json(200, { status: 'ok', backend: worker.backend, modelId: 'fake-model', device: 'cpu', computeType: 'int8', vad: 'energy', maxConcurrency: 2, maxAudioSeconds: 32, warmedUp: true });
      return;
    }
    if (req.method === 'POST' && req.url === '/speech/transcribe') {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        worker.transcribeCalls += 1;
        worker.lastBody = Buffer.concat(chunks);
        worker.lastContentType = req.headers['content-type'];
        if (worker.respond) {
          worker.respond(res);
          return;
        }
        const text = worker.lastBody.toString('utf8').replace(/^TEXT:/, '');
        json(200, { modelId: 'fake-model', text, durationMs: 2500, empty: false });
      });
      return;
    }
    json(404, { detail: 'not found' });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  worker.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return worker;
}

describe('음성 AI(No.32) — 운영 ∧ local 공급자 ∧ 거버넌스 ON', () => {
  let h: Harness;
  let worker: FakeWorker;
  let previousNodeEnv: string | undefined;

  const voice = (over: Partial<VoiceSettingsInput> = {}): VoiceSettingsInput => ({
    inputEnabled: true,
    ttsEnabled: false,
    autoReadToggleVisible: true,
    rateMultiplier: 1,
    defaultTone: 'CALM',
    toneByKind: {},
    nodeTones: [],
    ...over,
  });

  beforeAll(async () => {
    worker = await startFakeWorker();
    previousNodeEnv = process.env.NODE_ENV;
    h = await bootHarness({
      tmpPrefix: 'voice-ai-local-',
      env: {
        NODE_ENV: 'production',
        SPEECH_ENABLED: 'true',
        SPEECH_PROVIDER: 'local',
        ML_WORKER_SPEECH_URL: `${worker.url}/`,
        SPEECH_HEALTH_CACHE_MS: '5000',
        PUBLIC_SPEECH_RATE_LIMIT_IP_PER_MIN: '10000',
        RAG_BASE_URL: '',
        EMBEDDING_BASE_URL: '',
        DATA_GOVERNANCE_MODE: 'ON',
        DATA_ENCRYPTION_ENABLED: 'false',
        DATA_ENCRYPTION_KEYS: '',
        DATA_EGRESS_ALLOWED_HOSTS: '127.0.0.1',
        DATA_RETENTION_JOB_ENABLED: 'false',
        DATA_REENCRYPT_JOB_ENABLED: 'false',
      },
    });
  }, 90_000);

  afterAll(async () => {
    await h?.close();
    await worker?.close();
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
  }, 20_000);

  const post = (slug: string, body: Buffer) => rawPost<Record<string, unknown>>(`${h.baseUrl}/public/chatbots/${slug}/speech/transcriptions`, body, { 'Content-Type': 'audio/webm', 'x-cb-session-id': h.sessionUuid() });

  it('운영 ∧ ml-worker 백엔드 mock → 마이크 숨김(voice 키 없음) · 서버 상태 PROVIDER_UNAVAILABLE · 인식 요청은 송신 없이 503', async () => {
    const bot = await h.createChatbot('운영목');
    expect((await h.admin('PUT', `/chatbots/${bot.id}/voice`, voice())).status).toBe(200);
    worker.backend = 'mock';

    const config = await h.pub<Record<string, unknown>>('GET', `/public/chatbots/${bot.slug}/config`);
    expect('voice' in config.body).toBe(false);
    const overview = await h.admin<VoiceOverviewResponse>('GET', `/chatbots/${bot.id}/voice`);
    expect(overview.body.server).toEqual({ enabled: true, provider: 'local', inputAvailable: false, reason: 'PROVIDER_UNAVAILABLE' });

    const res = await post(bot.slug, Buffer.from('TEXT:안녕하세요'));
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('SPEECH_UNAVAILABLE');
    expect(worker.transcribeCalls).toBe(0);
    expect(worker.healthCalls).toBeGreaterThan(0);
  });

  it('백엔드가 실제 값이 되면(실패 캐시 TTL 뒤) 사용 가능 · 원시 바이트(octet-stream)를 그대로 전달하고 후처리를 적용한다', async () => {
    const bot = await h.createChatbot('운영실제');
    expect((await h.admin('PUT', `/chatbots/${bot.id}/voice`, voice({ ttsEnabled: true }))).status).toBe(200);
    worker.backend = 'faster-whisper';
    const available = await eventually(async () => {
      const r = await h.pub<{ voice?: { input: boolean } }>('GET', `/public/chatbots/${bot.slug}/config`);
      return r.body.voice?.input === true ? r : null;
    }, 6000);
    expect(available).not.toBeNull();
    expect((await h.admin<VoiceOverviewResponse>('GET', `/chatbots/${bot.id}/voice`)).body.server).toEqual({ enabled: true, provider: 'local', inputAvailable: true });

    const audio = Buffer.concat([Buffer.from('TEXT:'), Buffer.from('구공공일일이 다시 일이삼사오육칠', 'utf8')]);
    const res = await post(bot.slug, audio);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ text: '900112-1234567', durationMs: 2500 });
    expect(worker.lastContentType).toBe('application/octet-stream');
    expect(worker.lastBody!.equals(audio)).toBe(true);
    // modelId는 공개 응답 어디에도 없다
    expect(JSON.stringify(res.body)).not.toContain('fake-model');
  });

  it('ml-worker 오류 상태 → API 오류 코드 매핑(400·413·503 BUSY·500·형식 불량·무응답)', async () => {
    worker.backend = 'faster-whisper';
    const bot = await h.createChatbot('운영오류');
    await h.admin('PUT', `/chatbots/${bot.id}/voice`, voice());
    await eventually(async () => ((await h.pub<{ voice?: { input: boolean } }>('GET', `/public/chatbots/${bot.slug}/config`)).body.voice?.input === true ? true : null), 6000);

    const respondWith = (status: number, body: unknown) => (res: http.ServerResponse) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    const cases: Array<[number, unknown, number, string]> = [
      [400, { detail: 'INVALID' }, 400, 'SPEECH_AUDIO_INVALID'],
      [413, { detail: 'TOO_LONG' }, 413, 'SPEECH_AUDIO_TOO_LARGE'],
      [503, { detail: 'BUSY' }, 503, 'SPEECH_BUSY'],
      [200, { nothing: true }, 502, 'SPEECH_FAILED'],
    ];
    try {
      for (const [status, body, expectedStatus, expectedCode] of cases) {
        worker.respond = respondWith(status, body);
        const r = await post(bot.slug, Buffer.from('TEXT:x'));
        expect([r.status, r.body.code]).toEqual([expectedStatus, expectedCode]);
      }
      worker.respond = respondWith(500, { detail: 'FAILED' });
      const configBody = async () => (await h.pub<Record<string, unknown>>('GET', `/public/chatbots/${bot.slug}/config`)).body;
      for (let n = 1; n <= 3; n += 1) {
        const failed = await post(bot.slug, Buffer.from('TEXT:x'));
        expect([failed.status, failed.body.code]).toEqual([502, 'SPEECH_FAILED']);
        // 인프라 실패(HTTP 5xx)는 1~2회로는 마이크를 숨기지 않는다(M-3) — 연속 3회째에 숨긴다
        if (n < 3) expect('voice' in (await configBody())).toBe(true);
      }
      expect('voice' in (await h.pub<Record<string, unknown>>('GET', `/public/chatbots/${bot.slug}/config`)).body).toBe(false);
    } finally {
      worker.respond = undefined;
    }
  });

  it('데이터 지도 — SPEECH_LOCAL 출구 행(AUDIO_RAW · 마스킹 안 함 · 허용 목록 안 = ALLOWED)과 speech 절(provider local)', async () => {
    const map = await h.admin<GovernanceMapResponse>('GET', '/governance/map');
    expect(map.status).toBe(200);
    const row = map.body.egress.exits.find((e) => e.exitId === 'SPEECH_LOCAL');
    expect(row).toMatchObject({ exitId: 'SPEECH_LOCAL', configured: true, host: '127.0.0.1', dataKind: 'AUDIO_RAW', masked: 'NO', decision: 'ALLOWED' });
    expect(map.body.speech).toMatchObject({ serverEnabled: true, provider: 'local', audioStored: false, audioDiskWrite: false });
  });
});
