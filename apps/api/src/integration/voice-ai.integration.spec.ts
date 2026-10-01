import type { GovernanceMapResponse, VoiceOverviewResponse, VoiceSettingsInput, VoiceSettingsView, VoiceStatsResponse } from '@chat-bot/shared-types';
import { HandoffGateService } from '../handoff/handoff-gate.service';
import { MockSpeechRecognitionProvider } from '../speech/providers/mock-speech-recognition.provider';
import { SPEECH_RECOGNITION_PROVIDER } from '../speech/providers/speech-recognition-provider.port';
import type { SpeechRecognitionInput, SpeechRecognitionOutcome, SpeechRecognitionProvider } from '../speech/providers/speech-recognition-provider.port';
import { bootHarness, eventually, startFakeRag } from './helpers/ai-guardrails.harness';
import { waitForLiveSessionRef } from './helpers/eventual.helper';
import type { FakeRag, Harness } from './helpers/ai-guardrails.harness';
import { loadGolden, normalizeBody, rawPost } from './helpers/voice-ai.helpers';

/**
 * 음성 AI(No.32) 커밋 ③ 통합 시험 — voice-ai-설계.md §14·§15(AC-VO1~VO4). 서버 음성 켜짐 + `mock` 공급자(비운영) + 제어 가능한 가짜 공급자.
 * 골든 바이트(`helpers/voice-ai-golden.json` — 커밋 ①이 도입 전에 캡처)와 비교해 "듣기 켜짐 ∧ speech-v1 선언"에서도 시스템 안내 3종 응답이
 * 바이트 동일함(H-3)과 음성 설정 없는 챗봇의 응답이 바이트 동일함을 확인한다.
 */

interface Fake extends SpeechRecognitionProvider {
  calls: number;
  healthyValue: boolean;
  behavior?: (input: SpeechRecognitionInput) => Promise<SpeechRecognitionOutcome>;
  last?: SpeechRecognitionInput;
}

function createFake(): Fake {
  const mock = new MockSpeechRecognitionProvider();
  const fake: Fake = {
    providerId: 'mock',
    calls: 0,
    healthyValue: true,
    async transcribe(input) {
      fake.calls += 1;
      fake.last = input;
      return fake.behavior ? fake.behavior(input) : mock.transcribe(input);
    },
    async healthy() {
      return fake.healthyValue;
    },
  };
  return fake;
}

const RAG_ANSWER = '문서 답변 본문입니다. 연락처는 02-123-4567 입니다.';
const REPLACEMENT = '지금은 안내드릴 수 없어요. 전문 상담 기관에 연락해 주세요.';
const RRN = '901231-1234567';

type Msg = Record<string, unknown> & { messageId: string; outputs: Array<{ type: string; payload?: { text?: string } }>; speech?: { text: string; tone: string } };

describe('음성 AI(No.32) 통합 시험', () => {
  let h: Harness & { moduleRef: { get: <T>(token: unknown) => T } };
  let rag: FakeRag;
  const fake = createFake();
  const golden = loadGolden();

  const voice = (over: Partial<VoiceSettingsInput> = {}): VoiceSettingsInput => ({
    inputEnabled: false,
    ttsEnabled: false,
    autoReadToggleVisible: true,
    rateMultiplier: 1,
    defaultTone: 'CALM',
    toneByKind: {},
    nodeTones: [],
    ...over,
  });

  beforeAll(async () => {
    rag = await startFakeRag();
    rag.answer = RAG_ANSWER;
    h = (await bootHarness({
      tmpPrefix: 'voice-ai-',
      env: {
        SPEECH_ENABLED: 'true',
        SPEECH_PROVIDER: 'mock',
        SPEECH_MAX_CONCURRENCY: '1',
        SPEECH_MAX_AUDIO_BYTES: '65536',
        SPEECH_HEALTH_CACHE_MS: '5000',
        PUBLIC_SPEECH_RATE_LIMIT_IP_PER_MIN: '10000',
        RAG_BASE_URL: rag.url,
        RAG_STATUS_CACHE_MS: '600000',
      },
      overrides: (b) => b.overrideProvider(SPEECH_RECOGNITION_PROVIDER).useValue(fake),
    })) as unknown as Harness & { moduleRef: { get: <T>(token: unknown) => T } };
  }, 90_000);

  afterAll(async () => {
    await h?.close();
    await rag?.close();
  }, 20_000);

  async function engineBot(prefix: string, settings?: Partial<VoiceSettingsInput>): Promise<{ id: string; slug: string; keyword: string; nodeId: string }> {
    const bot = await h.createChatbot(prefix);
    const keyword = `음성키워드${bot.id.slice(0, 6)}`;
    const kw = await h.admin<{ id: string }>('POST', `/chatbots/${bot.id}/keywords`, { name: keyword, synonyms: [] });
    const node = await h.admin<{ id: string }>('POST', `/chatbots/${bot.id}/dialog-nodes`, {
      name: '응답',
      nodeType: 'NORMAL',
      keywordIds: [kw.body.id],
      outputs: [{ type: 'TEXT', payload: { text: '엔진 답변입니다.' } }],
    });
    expect(node.status).toBe(201);
    if (settings) expect((await h.admin('PUT', `/chatbots/${bot.id}/voice`, voice(settings))).status).toBe(200);
    return { ...bot, keyword, nodeId: node.body.id };
  }

  const send = (slug: string, message: string, features?: string[], sessionId = h.sessionUuid()) =>
    h.pub<Msg>('POST', `/public/chatbots/${slug}/messages`, { sessionId, message, ...(features ? { features } : {}) });

  const audioPost = (slug: string, body: Buffer | Buffer[], headers: Record<string, string> = {}, opts: { chunked?: boolean } = {}) =>
    rawPost<Record<string, unknown>>(`${h.baseUrl}/public/chatbots/${slug}/speech/transcriptions`, body, { 'Content-Type': 'audio/webm;codecs=opus', 'x-cb-session-id': h.sessionUuid(), ...headers }, opts);

  const mockAudio = (text: string) => Buffer.from(`MOCK:${text}`);

  /* ───────────────────────────── 관리 API ───────────────────────────── */

  describe('관리 API(GET/PUT/stats · 권한 · 감사)', () => {
    it('행 없음 = 전부 꺼짐 기본값 · 서버 상태 · 맥락', async () => {
      const bot = await h.createChatbot('음성기본');
      const res = await h.admin<VoiceOverviewResponse>('GET', `/chatbots/${bot.id}/voice`);
      expect(res.status).toBe(200);
      expect(res.body.settings).toEqual({
        inputEnabled: false,
        ttsEnabled: false,
        autoReadToggleVisible: true,
        rateMultiplier: 1,
        defaultTone: 'CALM',
        toneByKind: {},
        nodeTones: [],
        updatedAt: null,
      });
      expect(res.body.server).toEqual({ enabled: true, provider: 'mock', inputAvailable: true });
      expect(res.body.context).toEqual({ webChannelEnabled: true, chatbotStatus: 'ACTIVE' });
      expect(res.body.limits).toEqual({ nodeTonesMax: 200 });
    });

    it('PUT 전체 교체 → 조회에 반영 · 노드 이름 · 없는 노드는 nodeMissing', async () => {
      const bot = await engineBot('음성저장');
      const put = await h.admin<VoiceSettingsView>(
        'PUT',
        `/chatbots/${bot.id}/voice`,
        voice({ inputEnabled: true, ttsEnabled: true, autoReadToggleVisible: false, rateMultiplier: 1.05, defaultTone: 'BRIGHT', toneByKind: { UNANSWERED: 'INFORMATIVE' }, nodeTones: [{ nodeId: bot.nodeId, tone: 'APOLOGETIC' }] }),
      );
      expect(put.status).toBe(200);
      expect(put.body).toMatchObject({ inputEnabled: true, ttsEnabled: true, autoReadToggleVisible: false, rateMultiplier: 1.05, defaultTone: 'BRIGHT', toneByKind: { UNANSWERED: 'INFORMATIVE' } });
      expect(put.body.nodeTones).toEqual([{ nodeId: bot.nodeId, tone: 'APOLOGETIC', nodeName: '응답' }]);

      // 노드를 지워도 설정은 남고 조회에 nodeMissing 배지
      expect((await h.admin('DELETE', `/chatbots/${bot.id}/dialog-nodes/${bot.nodeId}`)).status).toBe(204);
      const after = await h.admin<VoiceOverviewResponse>('GET', `/chatbots/${bot.id}/voice`);
      expect(after.body.settings.nodeTones).toEqual([{ nodeId: bot.nodeId, tone: 'APOLOGETIC', nodeName: null, nodeMissing: true }]);

      // 전체 교체 — 빈 노드 말투로 저장하면 사라진다
      const replaced = await h.admin<VoiceSettingsView>('PUT', `/chatbots/${bot.id}/voice`, voice({ ttsEnabled: true }));
      expect(replaced.body.nodeTones).toEqual([]);
      expect(replaced.body.inputEnabled).toBe(false);
    });

    it('저장 검증 — 모르는 toneByKind 키(BLOCKED·ERROR)·배율 단위·다른 챗봇 노드', async () => {
      const bot = await engineBot('음성검증');
      const other = await engineBot('음성검증타봇');
      const body = (over: Record<string, unknown>) => ({ ...voice(), ...over });
      for (const key of ['BLOCKED', 'ERROR', 'WAITING', 'ANSWERED', 'SAFETY']) {
        const res = await h.admin<{ code: string }>('PUT', `/chatbots/${bot.id}/voice`, body({ toneByKind: { [key]: 'CALM' } }));
        expect(res.status).toBe(400);
        expect(res.body.code).toBe('VALIDATION_FAILED');
      }
      expect((await h.admin('PUT', `/chatbots/${bot.id}/voice`, body({ rateMultiplier: 1.07 }))).status).toBe(400);
      expect((await h.admin('PUT', `/chatbots/${bot.id}/voice`, body({ rateMultiplier: 1.5 }))).status).toBe(400);
      expect((await h.admin('PUT', `/chatbots/${bot.id}/voice`, body({ defaultTone: 'LOUD' }))).status).toBe(400);
      expect((await h.admin('PUT', `/chatbots/${bot.id}/voice`, { ...voice(), extra: 1 })).status).toBe(400);
      const ref = await h.admin<{ code: string }>('PUT', `/chatbots/${bot.id}/voice`, body({ nodeTones: [{ nodeId: other.nodeId, tone: 'CALM' }] }));
      expect(ref.status).toBe(400);
      expect(ref.body.code).toBe('INVALID_REFERENCE');
      expect((await h.admin('PUT', `/chatbots/${bot.id}/voice`, body({ nodeTones: [{ nodeId: bot.nodeId, tone: 'CALM' }, { nodeId: bot.nodeId, tone: 'BRIGHT' }] }))).status).toBe(400);
    });

    it('권한 — VIEWER는 조회만(PUT 403) · EDITOR는 저장 가능 · 없는 챗봇 404', async () => {
      const bot = await h.createChatbot('음성권한');
      expect((await h.viewer('GET', `/chatbots/${bot.id}/voice`)).status).toBe(200);
      expect((await h.viewer('GET', `/chatbots/${bot.id}/voice/stats`)).status).toBe(200);
      expect((await h.viewer('PUT', `/chatbots/${bot.id}/voice`, voice())).status).toBe(403);
      expect((await h.editor('PUT', `/chatbots/${bot.id}/voice`, voice({ ttsEnabled: true }))).status).toBe(200);
      expect((await h.admin('GET', '/chatbots/00000000-0000-4000-8000-000000000000/voice')).status).toBe(404);
    });

    it('감사 — UPDATE Chatbot 1건(voice 요약 · 노드 id 원문 0) · 같은 값 재저장은 감사 0', async () => {
      const bot = await engineBot('음성감사');
      const before = await h.prisma.auditLog.count({ where: { targetId: bot.id, action: 'UPDATE' } });
      const input = voice({ ttsEnabled: true, nodeTones: [{ nodeId: bot.nodeId, tone: 'BRIGHT' }] });
      expect((await h.admin('PUT', `/chatbots/${bot.id}/voice`, input)).status).toBe(200);
      const rows = await eventually(async () => {
        const found = await h.prisma.auditLog.findMany({ where: { targetId: bot.id, action: 'UPDATE', targetType: 'Chatbot' }, orderBy: { createdAt: 'desc' } });
        return found.length > before ? found : null;
      });
      expect(rows).not.toBeNull();
      const latest = rows![0];
      expect(latest.afterValue).toContain('"voice"');
      expect(latest.afterValue).toContain('"nodeToneCount":1');
      expect(latest.afterValue).not.toContain(bot.nodeId);
      expect(latest.summary).toContain('음성 설정 변경');

      const countAfter = await h.prisma.auditLog.count({ where: { targetId: bot.id, action: 'UPDATE' } });
      expect((await h.admin('PUT', `/chatbots/${bot.id}/voice`, input)).status).toBe(200);
      // 양성 대조: 값을 실제로 바꾼 저장은 감사가 쓰이는 것을 폴링으로 확인한 뒤, 같은 값 재저장분이 끼어들지 않았는지 정확한 건수로 검사한다.
      expect((await h.admin('PUT', `/chatbots/${bot.id}/voice`, voice({ ttsEnabled: true, rateMultiplier: 0.9, nodeTones: [{ nodeId: bot.nodeId, tone: 'BRIGHT' }] }))).status).toBe(200);
      const changed = await eventually(async () => ((await h.prisma.auditLog.count({ where: { targetId: bot.id, action: 'UPDATE' } })) > countAfter ? true : null));
      expect(changed).toBe(true);
      expect(await h.prisma.auditLog.count({ where: { targetId: bot.id, action: 'UPDATE' } })).toBe(countAfter + 1);
    });
  });

  /* ───────────────────────────── 공개 설정 `voice` ───────────────────────────── */

  describe('공개 설정 voice 키(§5.1)', () => {
    it('음성 설정이 없는 챗봇 = 골든과 바이트 동일(voice 키 없음)', async () => {
      const bot = await h.createChatbot('골든설정');
      const res = await h.pub<Record<string, unknown>>('GET', `/public/chatbots/${bot.slug}/config`);
      const raw = JSON.stringify(res.body);
      expect(raw).not.toContain('"voice"');
      const normalized = normalizeBody(raw, [[bot.slug, '<SLUG>']]).split(/골든설정-[a-z0-9]+/).join('<NAME>');
      expect(normalized).toBe(golden.config.replace(/<NAME>/g, '<NAME>'));
    });

    it('듣기만 / 입력만 / 둘 다 · 키 순서(voice가 마지막) · 선제 조회도 같은 객체', async () => {
      const ttsOnly = await engineBot('설정듣기', { ttsEnabled: true, rateMultiplier: 0.9 });
      const a = await h.pub<Record<string, unknown>>('GET', `/public/chatbots/${ttsOnly.slug}/config`);
      expect(a.body.voice).toEqual({ input: false, tts: true, autoReadToggle: true, rate: 0.9 });
      expect(Object.keys(a.body).at(-1)).toBe('voice');
      expect(Object.keys(a.body.voice as object)).toEqual(['input', 'tts', 'autoReadToggle', 'rate']);

      const inputOnly = await engineBot('설정입력', { inputEnabled: true });
      const b = await h.pub<Record<string, unknown>>('GET', `/public/chatbots/${inputOnly.slug}/config`);
      expect(b.body.voice).toEqual({ input: true, tts: false, autoReadToggle: false, rate: 1 });

      const both = await engineBot('설정둘다', { inputEnabled: true, ttsEnabled: true, autoReadToggleVisible: false });
      const c = await h.pub<Record<string, unknown>>('GET', `/public/chatbots/${both.slug}/config?proactive=1`);
      expect(c.body.voice).toEqual({ input: true, tts: true, autoReadToggle: false, rate: 1 });
      expect(Object.keys(c.body).slice(-2)).toEqual(['proactive', 'voice']);

      const neither = await engineBot('설정없음', { inputEnabled: false, ttsEnabled: false });
      const d = await h.pub<Record<string, unknown>>('GET', `/public/chatbots/${neither.slug}/config`);
      expect('voice' in d.body).toBe(false);
    });

    it('저장 직후 같은 인스턴스는 즉시 반영한다(캐시 무효화)', async () => {
      const bot = await engineBot('설정즉시', { ttsEnabled: true });
      expect(((await h.pub<{ voice?: { tts: boolean } }>('GET', `/public/chatbots/${bot.slug}/config`)).body.voice ?? {}).tts).toBe(true);
      await h.admin('PUT', `/chatbots/${bot.id}/voice`, voice({ ttsEnabled: false }));
      expect('voice' in (await h.pub<Record<string, unknown>>('GET', `/public/chatbots/${bot.slug}/config`)).body).toBe(false);
    });
  });

  /* ───────────────────────────── 공개 인식 엔드포인트 ───────────────────────────── */

  describe('공개 인식 POST …/speech/transcriptions(§5.3)', () => {
    it('성공 — 한글 숫자 정규화 · 응답 키 · no-store · 대화 로그 0 · 집계 +1(AC-VO2-8·10)', async () => {
      const bot = await engineBot('인식성공', { inputEnabled: true });
      const logsBefore = await h.prisma.conversationLog.count({ where: { chatbotId: bot.id } });
      const res = await audioPost(bot.slug, mockAudio('구공공일일이 다시 일이삼사오육칠'));
      expect(res.status).toBe(200);
      expect(Object.keys(res.body).sort()).toEqual(['durationMs', 'text']);
      expect(res.body.text).toBe('900112-1234567');
      expect(res.body.durationMs).toEqual(expect.any(Number));
      expect(res.headers['cache-control']).toBe('no-store');

      const stats = await eventually(async () => {
        const s = await h.admin<VoiceStatsResponse>('GET', `/chatbots/${bot.id}/voice/stats`);
        return s.body.totals.ok >= 1 ? s : null;
      });
      expect(stats!.body.totals).toEqual({ requested: 1, ok: 1, empty: 0, invalid: 0, failed: 0, busy: 0 });
      expect(stats!.body.daily).toHaveLength(7);
      expect(await h.prisma.conversationLog.count({ where: { chatbotId: bot.id } })).toBe(logsBefore);
      expect(await h.prisma.unansweredQuestion.count({ where: { chatbotId: bot.id } })).toBe(0);

      // 다음 단계(전송) — 인식 글자는 평범한 사용자 메시지로 기존 경로가 처리한다(로그 마스킹)
      const sent = await send(bot.slug, `주민번호 ${RRN}`);
      expect(sent.status).toBe(200);
    });

    it('말소리 없음 → 200 { text:"", empty:true } · 집계 empty', async () => {
      const bot = await engineBot('인식무음', { inputEnabled: true });
      const res = await audioPost(bot.slug, Buffer.alloc(2048));
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ text: '', empty: true });
      const stats = await eventually(async () => {
        const s = await h.admin<VoiceStatsResponse>('GET', `/chatbots/${bot.id}/voice/stats`);
        return s.body.totals.empty >= 1 ? s : null;
      });
      expect(stats!.body.totals).toMatchObject({ requested: 1, empty: 1 });
    });

    it('후처리 결과가 비면(공백뿐) empty로 응답한다', async () => {
      const bot = await engineBot('인식공백', { inputEnabled: true });
      const res = await audioPost(bot.slug, mockAudio('   '));
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ text: '', empty: true });
    });

    it('MOCK-INVALID → 400 SPEECH_AUDIO_INVALID · MOCK-BUSY → 503 SPEECH_BUSY + Retry-After', async () => {
      const bot = await engineBot('인식오류', { inputEnabled: true });
      const invalid = await audioPost(bot.slug, Buffer.from('MOCK-INVALID'));
      expect(invalid.status).toBe(400);
      expect(invalid.body.code).toBe('SPEECH_AUDIO_INVALID');
      const busy = await audioPost(bot.slug, Buffer.from('MOCK-BUSY'));
      expect(busy.status).toBe(503);
      expect(busy.body.code).toBe('SPEECH_BUSY');
      expect(busy.headers['retry-after']).toBe('2');
      const stats = await eventually(async () => {
        const s = await h.admin<VoiceStatsResponse>('GET', `/chatbots/${bot.id}/voice/stats`);
        return s.body.totals.requested >= 2 ? s : null;
      });
      expect(stats!.body.totals).toMatchObject({ invalid: 1, busy: 1 });
    });

    it('통일된 503 SPEECH_UNAVAILABLE — 없는 슬러그·비공개·입력 꺼짐·WEB 꺼짐이 같은 본문(AC-VO2-9)', async () => {
      const off = await engineBot('인식꺼짐', { inputEnabled: false, ttsEnabled: true });
      const noRow = await h.createChatbot('인식행없음');
      const draft = await h.createChatbot('인식초안', { activate: false });
      const webOff = await engineBot('인식채널꺼짐', { inputEnabled: true });
      await h.admin('PATCH', `/chatbots/${webOff.id}/channels/WEB`, { enabled: false, config: { allowedOrigins: [] } });
      const results = await Promise.all(
        [off.slug, noRow.slug, draft.slug, webOff.slug, 'no-such-slug-xyz'].map((slug) => audioPost(slug, mockAudio('안녕하세요'))),
      );
      for (const r of results) {
        expect(r.status).toBe(503);
        expect(r.body).toEqual({ statusCode: 503, code: 'SPEECH_UNAVAILABLE', message: '지금은 음성 입력을 사용할 수 없습니다. 글자로 입력해 주세요.' });
      }
    });

    it('요청 검증 — 세션 헤더·형식·길이(본문을 읽기 전)', async () => {
      const bot = await engineBot('인식검증', { inputEnabled: true });
      const callsBefore = fake.calls;
      const noSession = await rawPost<{ code: string }>(`${h.baseUrl}/public/chatbots/${bot.slug}/speech/transcriptions`, mockAudio('x'), { 'Content-Type': 'audio/webm' });
      expect(noSession.status).toBe(400);
      expect(noSession.body.code).toBe('VALIDATION_FAILED');
      const badSession = await audioPost(bot.slug, mockAudio('x'), { 'x-cb-session-id': 'not-a-uuid' });
      expect(badSession.status).toBe(400);
      expect(badSession.body.code).toBe('VALIDATION_FAILED');

      const json = await audioPost(bot.slug, Buffer.from('{}'), { 'Content-Type': 'application/json' });
      expect(json.status).toBe(400);
      expect(json.body.code).toBe('SPEECH_AUDIO_INVALID');
      const text = await audioPost(bot.slug, Buffer.from('hello'), { 'Content-Type': 'text/plain' });
      expect(text.body.code).toBe('SPEECH_AUDIO_INVALID');
      const octet = await audioPost(bot.slug, mockAudio('옥텟'), { 'Content-Type': 'application/octet-stream' });
      expect(octet.status).toBe(200);

      const big = await audioPost(bot.slug, Buffer.alloc(65537));
      expect(big.status).toBe(413);
      expect(big.body.code).toBe('SPEECH_AUDIO_TOO_LARGE');
      expect(fake.calls).toBe(callsBefore + 1); // octet-stream 1건만 공급자까지 갔다
    });

    it('청크 전송(Content-Length 없음)이 상한을 넘으면 읽기 중 413 · 빈 본문은 400', async () => {
      const bot = await engineBot('인식청크', { inputEnabled: true });
      const callsBefore = fake.calls;
      const over = await audioPost(bot.slug, [Buffer.alloc(40000, 1), Buffer.alloc(40000, 1)], {}, { chunked: true }).catch((e: NodeJS.ErrnoException) => ({ status: -1, body: { code: e.code } }) as never);
      // 서버가 413 응답 후 연결을 닫으면 클라이언트가 응답을 못 받는 경우가 있다(-1) — 어느 쪽이든 공급자까지 가지 않는다.
      expect([413, -1]).toContain(over.status);
      if (over.status === 413) expect((over.body as { code: string }).code).toBe('SPEECH_AUDIO_TOO_LARGE');
      const empty = await audioPost(bot.slug, Buffer.alloc(0));
      expect(empty.status).toBe(400);
      expect(empty.body.code).toBe('SPEECH_AUDIO_INVALID');
      expect(fake.calls).toBe(callsBefore);
    });

    it('로그·응답에 인식 글자·세션 전체 id가 남지 않는다(응답은 text·durationMs뿐)', async () => {
      const bot = await engineBot('인식로그', { inputEnabled: true });
      const logs: string[] = [];
      const { Logger } = await import('@nestjs/common');
      const spies = (['log', 'warn', 'error', 'debug', 'verbose'] as const).map((level) => jest.spyOn(Logger.prototype, level).mockImplementation((...args: unknown[]) => void logs.push(args.map(String).join(' '))));
      const session = h.sessionUuid();
      const res = await audioPost(bot.slug, mockAudio('비밀스러운발화내용'), { 'x-cb-session-id': session });
      // 양성 대조 신호(로그가 실제로 쓰였음)를 폴링으로 기다린 뒤에 유출을 검사한다 — 고정 대기 금지.
      const positive = await eventually(async () => (logs.some((l) => /speech stage=PROVIDER result=OK/.test(l)) ? true : null), 5000);
      spies.forEach((s) => s.mockRestore());
      expect(positive).toBe(true);
      expect(res.status).toBe(200);
      const dumped = logs.join('\n');
      expect(dumped).not.toContain('비밀스러운발화내용');
      expect(dumped).not.toContain(session);
    });

    it('전용 레이트 버킷 — 같은 세션 분당 10회 초과 429 + Retry-After · 대화 session 버킷은 소비하지 않는다', async () => {
      const bot = await engineBot('인식한도', { inputEnabled: true });
      const session = h.sessionUuid();
      const statuses: number[] = [];
      let limited: Awaited<ReturnType<typeof audioPost>> | undefined;
      for (let i = 0; i < 11; i += 1) {
        const r = await audioPost(bot.slug, mockAudio(`발화${i}`), { 'x-cb-session-id': session });
        statuses.push(r.status);
        if (r.status === 429) limited = r;
      }
      expect(statuses.slice(0, 10)).toEqual(Array(10).fill(200));
      expect(statuses[10]).toBe(429);
      expect(limited!.headers['retry-after']).toBeDefined();
      expect(limited!.body.code).toBe('RATE_LIMITED');
      // 같은 세션으로 보내는 일반 대화는 영향이 없다(`session` 버킷 비소비)
      expect((await send(bot.slug, `${bot.keyword} 문의`, undefined, session)).status).toBe(200);
    });

    it('동시 처리 상한(1) — 초과는 대기 없이 즉시 503 SPEECH_BUSY · 해제 뒤 다시 처리', async () => {
      const bot = await engineBot('인식동시', { inputEnabled: true });
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      fake.behavior = async () => {
        await gate;
        return { kind: 'OK', text: '느린 인식', durationMs: 1000 };
      };
      try {
        const callsBefore = fake.calls;
        const slow = audioPost(bot.slug, mockAudio('느림'));
        expect(await eventually(async () => (fake.calls > callsBefore ? true : null), 3000)).toBe(true);
        // 구조적 단언: 첫 요청이 게이트에 걸려 끝나지 않은 상태에서 두 번째가 응답을 받았다 = 대기 없이 즉시 거절(시간 상한 대신).
        const rejected = await audioPost(bot.slug, mockAudio('두번째'));
        expect(rejected.status).toBe(503);
        expect(rejected.body.code).toBe('SPEECH_BUSY');
        expect(rejected.headers['retry-after']).toBe('2');
        release();
        const first = await slow;
        expect(first.status).toBe(200);
        expect(first.body.text).toBe('느린 인식');
      } finally {
        release();
        fake.behavior = undefined;
      }
      expect((await audioPost(bot.slug, mockAudio('세번째'))).status).toBe(200);
    });

    it('공급자 실패 매핑 — FAILED → 502 SPEECH_FAILED · 인프라 실패는 마이크를 숨긴다(다음 설정 조회부터) · 회복되면 다시 보인다', async () => {
      const bot = await engineBot('인식실패', { inputEnabled: true });
      const input = async () => (await h.pub<{ voice?: { input: boolean } }>('GET', `/public/chatbots/${bot.slug}/config`)).body.voice?.input;
      expect(await input()).toBe(true);
      try {
        fake.behavior = async () => ({ kind: 'FAILED', cause: 'INVALID_RESPONSE' });
        const invalidResponse = await audioPost(bot.slug, mockAudio('x'));
        expect(invalidResponse.status).toBe(502);
        expect(invalidResponse.body.code).toBe('SPEECH_FAILED');
        // 설정·형식 문제는 가용성에 영향이 없다
        expect(await input()).toBe(true);

        fake.behavior = async () => ({ kind: 'TOO_LONG' });
        const tooLong = await audioPost(bot.slug, mockAudio('x'));
        expect(tooLong.status).toBe(413);
        expect(tooLong.body.code).toBe('SPEECH_AUDIO_TOO_LARGE');

        fake.behavior = async () => ({ kind: 'FAILED', cause: 'NOT_CONFIGURED' });
        expect((await audioPost(bot.slug, mockAudio('x'))).body.code).toBe('SPEECH_UNAVAILABLE');
        expect(await input()).toBe(true);

        fake.behavior = async () => ({ kind: 'FAILED', cause: 'NETWORK' });
        const network = await audioPost(bot.slug, mockAudio('x'));
        expect(network.status).toBe(502);
        // 입력만 켜진 챗봇은 마이크가 숨겨지면 voice 키 자체가 없다
        const hidden = await h.pub<Record<string, unknown>>('GET', `/public/chatbots/${bot.slug}/config`);
        expect('voice' in hidden.body).toBe(false);
        // 마이크가 숨겨진 동안 인식 호출도 503(공급자 사용 불가)
        expect((await audioPost(bot.slug, mockAudio('x'))).body.code).toBe('SPEECH_UNAVAILABLE');
      } finally {
        fake.behavior = undefined;
        fake.healthyValue = true;
      }

      // 회복 — 실패 캐시는 성공 TTL(5초)의 1/3 뒤 갱신된다(만료 시 직전 값을 돌려주고 백그라운드 갱신)
      const recovered = await eventually(async () => ((await input()) === true ? true : null), 6000);
      expect(recovered).toBe(true);
      const stats = await h.admin<VoiceStatsResponse>('GET', `/chatbots/${bot.id}/voice/stats`);
      expect(stats.body.totals.failed).toBeGreaterThanOrEqual(1);
    });

    it('504 연쇄(M-3) — TIMEOUT·HTTP_5XX 1~2회는 마이크를 숨기지 않고, 연속 3회째에 숨긴다 · 성공이 끼면 계수가 초기화된다', async () => {
      const bot = await engineBot('인식연쇄', { inputEnabled: true });
      const input = async () => (await h.pub<{ voice?: { input: boolean } }>('GET', `/public/chatbots/${bot.slug}/config`)).body.voice?.input;
      try {
        expect((await audioPost(bot.slug, mockAudio('성공'))).status).toBe(200); // 계수 초기화
        fake.behavior = async () => ({ kind: 'FAILED', cause: 'TIMEOUT' });
        expect((await audioPost(bot.slug, mockAudio('x'))).status).toBe(502);
        fake.behavior = async () => ({ kind: 'FAILED', cause: 'HTTP_5XX' });
        expect((await audioPost(bot.slug, mockAudio('x'))).status).toBe(502);
        expect(await input()).toBe(true);

        fake.behavior = undefined;
        expect((await audioPost(bot.slug, mockAudio('중간성공'))).status).toBe(200);
        fake.behavior = async () => ({ kind: 'FAILED', cause: 'TIMEOUT' });
        expect((await audioPost(bot.slug, mockAudio('x'))).status).toBe(502);
        expect((await audioPost(bot.slug, mockAudio('x'))).status).toBe(502);
        expect(await input()).toBe(true); // 성공이 끼어 연속 2회뿐

        expect((await audioPost(bot.slug, mockAudio('x'))).status).toBe(502); // 연속 3회째
        expect('voice' in (await h.pub<Record<string, unknown>>('GET', `/public/chatbots/${bot.slug}/config`)).body).toBe(false);
      } finally {
        fake.behavior = undefined;
        fake.healthyValue = true;
      }
      expect(await eventually(async () => ((await input()) === true ? true : null), 6000)).toBe(true);
    });
  });

  /* ───────────────────────────── 응답 speech 키 ───────────────────────────── */

  describe('응답 speech 키(§5.2 · H-3 — 봇 답변 2지점)', () => {
    it('선언 없음 → 듣기 켜짐이어도 speech 없음 · 음성 설정 없는 챗봇은 선언해도 speech 없음', async () => {
      const bot = await engineBot('말투선언없음', { ttsEnabled: true });
      expect('speech' in (await send(bot.slug, `${bot.keyword} 문의`)).body).toBe(false);
      const plain = await engineBot('말투설정없음');
      expect('speech' in (await send(plain.slug, `${plain.keyword} 문의`, ['speech-v1'])).body).toBe(false);
      const off = await engineBot('말투듣기꺼짐', { ttsEnabled: false, inputEnabled: true });
      expect('speech' in (await send(off.slug, `${off.keyword} 문의`, ['speech-v1'])).body).toBe(false);
    });

    it('정상 답 = ANSWERED(기본 말투) · 마지막 키 · 로그 글자는 화면용 그대로', async () => {
      const bot = await engineBot('말투정상', { ttsEnabled: true, defaultTone: 'BRIGHT' });
      const res = await send(bot.slug, `${bot.keyword} 문의`, ['speech-v1']);
      expect(res.body.speech).toEqual({ text: '엔진 답변입니다.', tone: 'BRIGHT' });
      expect(Object.keys(res.body).at(-1)).toBe('speech');
      const log = await eventually(() => h.prisma.conversationLog.findUnique({ where: { id: res.body.messageId } }));
      expect(log?.botResponse).toBe('엔진 답변입니다.');
      expect(JSON.stringify(log)).not.toContain('"speech"');
    });

    it('미응답 = UNANSWERED(기본 APOLOGETIC · 관리자 지정이 있으면 그 말투)', async () => {
      const bot = await engineBot('말투미응답', { ttsEnabled: true });
      const res = await send(bot.slug, '전혀 관련없는 질문 zzqx', ['speech-v1']);
      expect(res.body.speech).toEqual({ text: '죄송해요, 잘 이해하지 못했어요. 다른 방식으로 질문해 주시겠어요?', tone: 'APOLOGETIC' });
      const custom = await engineBot('말투미응답지정', { ttsEnabled: true, toneByKind: { UNANSWERED: 'INFORMATIVE' } });
      expect((await send(custom.slug, '전혀 관련없는 질문 zzqx', ['speech-v1'])).body.speech?.tone).toBe('INFORMATIVE');
    });

    it('노드 꼬리표 — 종류 규칙·기본 말투보다 앞선다', async () => {
      const bot = await engineBot('말투노드');
      await h.admin('PUT', `/chatbots/${bot.id}/voice`, voice({ ttsEnabled: true, defaultTone: 'CALM', nodeTones: [{ nodeId: bot.nodeId, tone: 'BRIGHT' }] }));
      expect((await send(bot.slug, `${bot.keyword} 문의`, ['speech-v1'])).body.speech?.tone).toBe('BRIGHT');
      expect((await send(bot.slug, '전혀 관련없는 질문 zzqx', ['speech-v1'])).body.speech?.tone).toBe('APOLOGETIC');
    });

    it('입구 안전 문구 대체 = SAFETY(CALM 고정 — 기본 말투·미응답 지정과 무관) · 대체 문구가 읽힌다', async () => {
      const bot = await engineBot('말투안전', { ttsEnabled: true, defaultTone: 'BRIGHT', toneByKind: { UNANSWERED: 'BRIGHT' } });
      const rule = await h.admin('POST', `/chatbots/${bot.id}/guardrails/rules`, { name: '위기', category: 'CRISIS_SELF_HARM', expressions: ['위험표현'], appliesTo: 'INBOUND', action: 'REPLACE', replacementText: REPLACEMENT });
      expect(rule.status).toBe(201);
      const res = await send(bot.slug, '위험표현 이 있는 질문', ['speech-v1']);
      expect(res.body.outputs[0].payload?.text).toBe(REPLACEMENT);
      expect(res.body.speech).toEqual({ text: REPLACEMENT, tone: 'CALM' });
      expect(Object.keys(res.body).at(-1)).toBe('speech');
      // 선언이 없으면 안전 문구 응답에도 speech 없음
      expect('speech' in (await send(bot.slug, '위험표현 이 있는 질문')).body).toBe(false);
    });

    it('시스템 안내 3종(BLOCK·일시 장애·RAG 대기)은 듣기 켜짐 ∧ speech-v1 선언에서도 speech 없음 + 골든 바이트 동일(AC-VO3-14)', async () => {
      // BLOCK
      const blockBot = await engineBot('안내금지어', { ttsEnabled: true });
      const banned = `음성금지어${Math.random().toString(36).slice(2, 8)}`;
      expect((await h.admin('POST', '/banned-words', { word: banned, matchType: 'CONTAINS', policy: 'BLOCK' })).status).toBe(201);
      const block = await h.pub('POST', `/public/chatbots/${blockBot.slug}/messages`, { sessionId: h.sessionUuid(), message: `${banned} 포함 문의`, features: ['speech-v1'] });
      expect(normalizeBody(JSON.stringify(block.body), [[blockBot.slug, '<SLUG>']])).toBe(golden.message_block);

      // 일시 장애(버전 읽기 실패)
      const broken = await h.createChatbot('안내버전실패');
      await h.admin('PUT', `/chatbots/${broken.id}/voice`, voice({ ttsEnabled: true }));
      await h.prisma.chatbotVersionSequence.create({ data: { chatbotId: broken.id, lastVersionNo: 1 } });
      const row = await h.prisma.chatbotVersion.create({ data: { chatbotId: broken.id, versionNo: 1, trigger: 'MANUAL', schemaVersion: 1, contentHash: 'voice-corrupt-hash', counts: '{}', sizeBytes: 10 } });
      await h.prisma.chatbotVersionPayload.create({ data: { versionId: row.id, payload: 'not-a-valid-snapshot' } });
      await h.prisma.chatbot.update({ where: { id: broken.id }, data: { prodVersionId: row.id } });
      const unavailable = await send(broken.slug, '아무 질문', ['speech-v1']);
      expect(normalizeBody(JSON.stringify(unavailable.body), [[broken.slug, '<SLUG>']])).toBe(golden.message_version_unavailable);

      // RAG 대기(보류 시작)
      const ragBot = await h.createChatbot('안내RAG');
      expect((await h.admin('PUT', `/chatbots/${ragBot.id}/answer-settings`, { semanticEnabled: false, ragEnabled: true, ragCompany: '테스트회사' })).status).toBe(200);
      await h.admin('PUT', `/chatbots/${ragBot.id}/voice`, voice({ ttsEnabled: true }));
      const pending = await send(ragBot.slug, '문서에서 찾아줄 질문입니다', ['speech-v1']);
      expect(normalizeBody(JSON.stringify(pending.body), [[ragBot.slug, '<SLUG>']])).toBe(golden.message_pending_start);
      expect(pending.body.pendingAnswer).toBeDefined();
      expect('speech' in pending.body).toBe(false);
    });

    it('엔진 응답이 듣기 꺼짐 바이트와 같다 — 골든 정상·미응답과 비교(음성 설정 없는 챗봇)', async () => {
      const bot = await engineBot('골든엔진');
      const answered = await send(bot.slug, `${bot.keyword} 문의`, ['speech-v1']);
      expect(normalizeBody(JSON.stringify(answered.body), [[bot.slug, '<SLUG>'], [bot.keyword, '<KW>']])).toBe(golden.message_answered);
      const unanswered = await send(bot.slug, '전혀 관련없는 질문 zzqx');
      expect(normalizeBody(JSON.stringify(unanswered.body), [[bot.slug, '<SLUG>']])).toBe(golden.message_unanswered);
    });

    it('G-8 전치(상담원 미전달) 출력은 읽지 않는다 — 읽기 글자는 봇 출력만(C-16)', async () => {
      const bot = await engineBot('전치출력', { ttsEnabled: true });
      const gate = h.moduleRef.get<HandoffGateService>(HandoffGateService);
      const original = gate.evaluate.bind(gate);
      const session = h.sessionUuid();
      const spy = jest.spyOn(gate, 'evaluate').mockImplementation(async (arg) => {
        const result = await original(arg);
        if (arg.sessionId === session && result.kind === 'PASS') return { ...result, prependOutputs: [{ type: 'TEXT', payload: { text: '상담원이 남긴 메시지입니다' } }] };
        return result;
      });
      try {
        const res = await send(bot.slug, `${bot.keyword} 문의`, ['speech-v1'], session);
        expect(res.body.outputs.map((o) => o.payload?.text)).toEqual(['상담원이 남긴 메시지입니다', '엔진 답변입니다.']);
        expect(res.body.speech).toEqual({ text: '엔진 답변입니다.', tone: 'CALM' });
        expect(res.body.speech?.text).not.toContain('상담원');
      } finally {
        spy.mockRestore();
      }
    });
  });

  /* ───────────────────────────── 보류 답변 폴링 ───────────────────────────── */

  describe('보류 답변 폴링 speech(§6.5)', () => {
    async function ragBot(prefix: string, settings: Partial<VoiceSettingsInput>) {
      const bot = await h.createChatbot(prefix);
      expect((await h.admin('PUT', `/chatbots/${bot.id}/answer-settings`, { semanticEnabled: false, ragEnabled: true, ragCompany: '테스트회사' })).status).toBe(200);
      expect((await h.admin('PUT', `/chatbots/${bot.id}/voice`, voice(settings))).status).toBe(200);
      return bot;
    }
    async function ragTurn(bot: { slug: string }, answer: string, features?: string[]) {
      rag.answer = answer;
      const first = await send(bot.slug, '문서에서 찾아줄 질문입니다', features);
      expect(first.body.pendingAnswer).toBeDefined();
      const done = await eventually(async () => {
        const r = await h.pub<{ status: string; outputs?: Array<{ payload?: { text?: string } }>; speech?: { text: string; tone: string } }>('GET', `/public/chatbots/${bot.slug}/messages/${first.body.messageId}`);
        return r.body.status !== 'PENDING' ? r : null;
      }, 8000);
      expect(done).not.toBeNull();
      return done!;
    }

    it('READY = ANSWERED(기본 말투) · 전화번호 쉼 · speech가 마지막 키', async () => {
      const bot = await ragBot('폴링정상', { ttsEnabled: true, defaultTone: 'BRIGHT' });
      const done = await ragTurn(bot, RAG_ANSWER, ['speech-v1']);
      expect(done.body.status).toBe('READY');
      expect(done.body.speech).toEqual({ text: '문서 답변 본문입니다. 연락처는 02, 123, 4567 입니다.', tone: 'BRIGHT' });
      expect(Object.keys(done.body).at(-1)).toBe('speech');
    });

    it('선언이 없으면 보류 폴링에도 speech 없음(계획을 저장하지 않는다) · 바이트는 골든 poll_ready와 같다', async () => {
      const bot = await ragBot('폴링선언없음', { ttsEnabled: true });
      const done = await ragTurn(bot, RAG_ANSWER);
      expect('speech' in done.body).toBe(false);
      expect(normalizeBody(JSON.stringify(done.body), [[bot.slug, '<SLUG>']])).toBe(golden.poll_ready);
    });

    it('FAILED(챗봇 폴백 문구) = UNANSWERED(기본 APOLOGETIC · 지정 말투) — 골든 poll_failed와 같은 응답에 speech만 붙는다', async () => {
      const bot = await ragBot('폴링폴백', { ttsEnabled: true });
      const done = await ragTurn(bot, RRN, ['speech-v1']);
      expect(done.body.status).toBe('FAILED');
      expect(done.body.speech).toEqual({ text: expect.stringContaining('죄송해요'), tone: 'APOLOGETIC' });
      const { speech, ...withoutSpeech } = done.body;
      expect(speech).toBeDefined();
      expect(normalizeBody(JSON.stringify(withoutSpeech), [[bot.slug, '<SLUG>']])).toBe(golden.poll_failed);

      const custom = await ragBot('폴링폴백지정', { ttsEnabled: true, toneByKind: { UNANSWERED: 'INFORMATIVE' } });
      expect((await ragTurn(custom, RRN, ['speech-v1'])).body.speech?.tone).toBe('INFORMATIVE');
    });

    it('FAILED + 안전 문구 대체(출구 REPLACE) = SAFETY(CALM 고정) — 골든 poll_safety_replaced와 같은 응답에 speech만 붙는다', async () => {
      const bot = await ragBot('폴링안전', { ttsEnabled: true, defaultTone: 'BRIGHT', toneByKind: { UNANSWERED: 'BRIGHT' } });
      expect((await h.admin('POST', `/chatbots/${bot.id}/guardrails/rules`, { name: '골든의료', category: 'MEDICAL_ADVICE', expressions: ['복용하세요'], appliesTo: 'OUTBOUND', action: 'REPLACE', replacementText: REPLACEMENT })).status).toBe(201);
      const done = await ragTurn(bot, '하루 세 번 약을 복용하세요.', ['speech-v1']);
      expect(done.body.status).toBe('FAILED');
      expect(done.body.speech).toEqual({ text: REPLACEMENT, tone: 'CALM' });
      const { speech, ...withoutSpeech } = done.body;
      expect(speech).toBeDefined();
      expect(normalizeBody(JSON.stringify(withoutSpeech), [[bot.slug, '<SLUG>']])).toBe(golden.poll_safety_replaced);
    });
  });

  /* ───────────────────────────── 거버넌스 · 삭제 · 쿼리 수 ───────────────────────────── */

  describe('거버넌스 데이터 지도 · 영구삭제', () => {
    it('서버 음성 켜짐 ∧ mock — speech 절은 있고(mock 표시) SPEECH_LOCAL 출구 행은 없다', async () => {
      const map = await h.admin<GovernanceMapResponse>('GET', '/governance/map');
      expect(map.status).toBe(200);
      expect(map.body.speech).toMatchObject({
        serverEnabled: true,
        provider: 'mock',
        audioStored: false,
        audioDiskWrite: false,
        transcriptStored: 'ONLY_WHEN_SENT',
        ttsLocation: 'USER_DEVICE',
        ttsServerEgress: false,
        onlineVoicesExcluded: true,
        counters: 'CHATBOT_DAILY_COUNTS_ONLY',
      });
      expect(map.body.speech!.chatbotsInputEnabled).toBeGreaterThan(0);
      expect(map.body.speech!.chatbotsTtsEnabled).toBeGreaterThan(0);
      expect(map.body.egress.exits.map((e) => e.exitId)).not.toContain('SPEECH_LOCAL');
    });

    it('챗봇 영구삭제 시 음성 설정·일별 숫자가 함께 삭제된다(X-11)', async () => {
      const bot = await h.createChatbot('음성삭제');
      await h.admin('PUT', `/chatbots/${bot.id}/voice`, voice({ inputEnabled: true, ttsEnabled: true }));
      expect((await audioPost(bot.slug, mockAudio('삭제 전 발화'))).status).toBe(200);
      await eventually(async () => ((await h.prisma.speechDailyStat.count({ where: { chatbotId: bot.id } })) > 0 ? true : null));
      await h.admin('DELETE', `/chatbots/${bot.id}/channels/WEB`);
      await h.admin('DELETE', `/chatbots/${bot.id}`);
      const name = (await h.prisma.chatbot.findUnique({ where: { id: bot.id } }))!.name;
      expect((await h.admin('POST', `/chatbots/${bot.id}/permanent-delete`, { confirmName: name })).status).toBe(204);
      expect(await h.prisma.chatbotVoiceSetting.count({ where: { chatbotId: bot.id } })).toBe(0);
      expect(await h.prisma.speechDailyStat.count({ where: { chatbotId: bot.id } })).toBe(0);
    });
  });

  /* ───────────────────────────── 추적표 보강(test-automation — AC-VO1-4·VO2-8·VO2-10·VO3-4·VO3-6·VO3-11 · EX-VO-17 · NFR-VOS1·VOS4) ───────────────────────────── */

  describe('추적표 보강 — 설계 §15.4 매핑 중 기존 시험이 단언하지 않던 것', () => {
    it('AC-VO2-10: 인식 글자(한글 숫자 정규화)를 전송하면 대화 로그에는 저장 마스킹된 글자만 남는다', async () => {
      const bot = await engineBot('인식마스킹', { inputEnabled: true });
      const recognized = await audioPost(bot.slug, mockAudio('구공공일일이 다시 일이삼사오육칠'));
      expect(recognized.body.text).toBe('900112-1234567');
      // 인식 요청 단계에서는 로그가 없고, 사용자가 전송한 뒤에만 기존 경로가 저장한다
      expect(await h.prisma.conversationLog.count({ where: { chatbotId: bot.id } })).toBe(0);
      const sent = await send(bot.slug, `${recognized.body.text as string} 입니다`);
      expect(sent.status).toBe(200);
      const log = await eventually(() => h.prisma.conversationLog.findUnique({ where: { id: sent.body.messageId } }));
      expect(log).not.toBeNull();
      expect(log!.userMessage).not.toContain('900112');
      expect(log!.userMessage).not.toContain('1234567');
      expect(log!.userMessage).toMatch(/\[[^\]]+\]/);
    });

    it('AC-VO1-4: 음성 입력·듣기가 켜진 챗봇의 메시지 턴·보류 폴링은 STT 공급자를 부르지 않는다(대화 경로 모델 호출 +0)', async () => {
      const bot = await engineBot('턴공급자호출', { inputEnabled: true, ttsEnabled: true });
      const callsBefore = fake.calls;
      for (const message of [`${bot.keyword} 문의`, '전혀 관련없는 질문 zzqx']) {
        const res = await send(bot.slug, message, ['speech-v1']);
        expect(res.status).toBe(200);
        expect(res.body.speech).toBeDefined();
      }
      const ragBotRow = await h.createChatbot('턴공급자RAG');
      expect((await h.admin('PUT', `/chatbots/${ragBotRow.id}/answer-settings`, { semanticEnabled: false, ragEnabled: true, ragCompany: '테스트회사' })).status).toBe(200);
      await h.admin('PUT', `/chatbots/${ragBotRow.id}/voice`, voice({ inputEnabled: true, ttsEnabled: true }));
      rag.answer = RAG_ANSWER;
      const first = await send(ragBotRow.slug, '문서에서 찾아줄 질문입니다', ['speech-v1']);
      const done = await eventually(async () => {
        const r = await h.pub<{ status: string; speech?: unknown }>('GET', `/public/chatbots/${ragBotRow.slug}/messages/${first.body.messageId}`);
        return r.body.status !== 'PENDING' ? r : null;
      }, 8000);
      expect(done?.body.speech).toBeDefined();
      expect(fake.calls).toBe(callsBefore);
    });

    it('AC-VO3-4 · EX-VO-17: 상담원이 개입한 세션의 응답(HANDLED)에는 듣기 켜짐 ∧ 선언이어도 speech 키가 없다', async () => {
      const bot = await engineBot('상담음성', { ttsEnabled: true });
      expect(
        (
          await h.admin('PUT', `/chatbots/${bot.id}/handoff-settings`, {
            enabled: true,
            cautionThreshold: 1,
            warningThreshold: 2,
            activeWindowMinutes: 10,
            userIdleMinutes: 10,
            agentNoReplyMinutes: 5,
            connectNotice: '상담원이 연결되었어요.',
            endNotice: '상담이 종료되었어요.',
            failNotice: '연결이 어려워요.',
          })
        ).status,
      ).toBe(200);
      const session = h.sessionUuid();
      // 선언을 싣고도 봇 답변 턴에는 speech가 붙는다(대조군 — 기능이 실제로 켜져 있음)
      const control = await send(bot.slug, `${bot.keyword} 문의`, ['speech-v1', 'handoff-v1'], session);
      expect(control.body.speech).toBeDefined();
      await send(bot.slug, '이해할 수 없는 질문입니다', ['speech-v1', 'handoff-v1'], session);
      const sessionRef = await waitForLiveSessionRef(() => h.admin<{ items?: Array<{ sessionRef: string }> }>('GET', `/chatbots/${bot.id}/live-sessions`));
      expect((await h.admin('POST', `/chatbots/${bot.id}/live-sessions/${sessionRef}/handoff`, {})).status).toBe(201);
      const handled = await send(bot.slug, `${bot.keyword} 문의`, ['speech-v1', 'handoff-v1'], session);
      expect(handled.status).toBe(200);
      expect((handled.body as { handoff?: { status: string } }).handoff?.status).toBe('CONNECTED');
      expect('speech' in handled.body).toBe(false);
    });

    it('AC-VO3-6: RAG 답의 출구 가림 표시는 소리로도 가려진다 — 원래 숫자 없이 "카드번호 가림"을 읽는다', async () => {
      const bot = await h.createChatbot('폴링가림');
      expect((await h.admin('PUT', `/chatbots/${bot.id}/answer-settings`, { semanticEnabled: false, ragEnabled: true, ragCompany: '테스트회사' })).status).toBe(200);
      await h.admin('PUT', `/chatbots/${bot.id}/voice`, voice({ ttsEnabled: true }));
      rag.answer = `주민 ${RRN}, 카드 1234-5678-9012-3456 입니다.`;
      const first = await send(bot.slug, '문서에서 찾아줄 질문입니다', ['speech-v1']);
      const done = await eventually(async () => {
        const r = await h.pub<{ status: string; outputs?: Array<{ payload?: { text?: string } }>; speech?: { text: string; tone: string } }>('GET', `/public/chatbots/${bot.slug}/messages/${first.body.messageId}`);
        return r.body.status !== 'PENDING' ? r : null;
      }, 8000);
      expect(done!.body.status).toBe('READY');
      expect(done!.body.outputs?.[0].payload?.text).toContain('[카드번호]');
      expect(done!.body.speech?.text).toContain('카드번호 가림');
      expect(done!.body.speech?.text).toContain('주민등록번호 가림');
      expect(done!.body.speech?.text).not.toMatch(/\[|1234|5678|9012|3456|901231/);
    });

    it('AC-VO3-11: 노드 말투 꼬리표를 저장·변경해도 버전 스냅샷 해시가 같다(꼬리표는 스냅샷 밖)', async () => {
      const bot = await engineBot('말투스냅샷');
      const latestHash = async (): Promise<string> => {
        expect((await h.admin('POST', `/chatbots/${bot.id}/versions`, {})).status).toBeLessThan(300);
        const row = await h.prisma.chatbotVersion.findFirst({ where: { chatbotId: bot.id }, orderBy: { versionNo: 'desc' } });
        return row!.contentHash;
      };
      const before = await latestHash();
      expect((await h.admin('PUT', `/chatbots/${bot.id}/voice`, voice({ ttsEnabled: true, defaultTone: 'BRIGHT', nodeTones: [{ nodeId: bot.nodeId, tone: 'APOLOGETIC' }] }))).status).toBe(200);
      const afterSave = await latestHash();
      expect((await h.admin('PUT', `/chatbots/${bot.id}/voice`, voice({ ttsEnabled: true, nodeTones: [{ nodeId: bot.nodeId, tone: 'INFORMATIVE' }] }))).status).toBe(200);
      const afterChange = await latestHash();
      expect(afterSave).toBe(before);
      expect(afterChange).toBe(before);
    });

    it('AC-VO2-8 · NFR-VOS1: 인식 요청(성공·무음·형식 오류·상한 초과) 처리 중 API 프로세스는 파일 쓰기를 하지 않는다', async () => {
      const bot = await engineBot('인식디스크0', { inputEnabled: true });
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const fs = require('node:fs') as typeof import('node:fs');
      const names = ['writeFile', 'writeFileSync', 'appendFile', 'appendFileSync', 'createWriteStream', 'mkdtemp', 'mkdtempSync', 'copyFile', 'copyFileSync', 'rename', 'renameSync'] as const;
      const spies = names.map((n) => ({ n: `fs.${n}`, spy: jest.spyOn(fs, n as never) as jest.SpyInstance }));
      const promiseNames = ['writeFile', 'appendFile', 'mkdtemp', 'copyFile', 'rename'] as const;
      const promiseSpies = promiseNames.map((n) => ({ n: `fs.promises.${n}`, spy: jest.spyOn(fs.promises, n as never) as jest.SpyInstance }));
      const all = [...spies, ...promiseSpies];
      try {
        expect((await audioPost(bot.slug, mockAudio('디스크에 남기지 않는 발화'))).status).toBe(200);
        expect((await audioPost(bot.slug, Buffer.alloc(2048))).status).toBe(200); // 무음 → empty
        expect((await audioPost(bot.slug, Buffer.from('MOCK-INVALID'))).status).toBe(400);
        expect((await audioPost(bot.slug, Buffer.alloc(65537))).status).toBe(413);
        const written = all.filter(({ spy }) => spy.mock.calls.length > 0).map(({ n, spy }) => `${n}:${JSON.stringify(spy.mock.calls[0]?.[0])}`);
        expect(written).toEqual([]);
      } finally {
        all.forEach(({ spy }) => spy.mockRestore());
      }
    });

    it('NFR-VOS4: 인식 오류 응답(400·413·502·503)에 모델·주소·장비 정보가 없다', async () => {
      const bot = await engineBot('인식오류정보', { inputEnabled: true });
      const bodies: string[] = [];
      try {
        bodies.push((await audioPost(bot.slug, Buffer.from('MOCK-INVALID'))).raw);
        bodies.push((await audioPost(bot.slug, Buffer.alloc(65537))).raw);
        bodies.push((await audioPost(bot.slug, Buffer.from('MOCK-BUSY'))).raw);
        fake.behavior = async () => ({ kind: 'FAILED', cause: 'NETWORK' });
        bodies.push((await audioPost(bot.slug, mockAudio('x'))).raw);
        fake.behavior = async () => ({ kind: 'FAILED', cause: 'INVALID_RESPONSE' });
        bodies.push((await audioPost(bot.slug, mockAudio('x'))).raw);
      } finally {
        fake.behavior = undefined;
        fake.healthyValue = true;
      }
      for (const raw of bodies) {
        expect(raw.length).toBeGreaterThan(2);
        expect(raw).not.toMatch(/model|whisper|faster|cuda|gpu|localhost|127\.0\.0\.1|https?:\/\/|ml[-_]?worker|stack|at\s+\w+\s*\(/i);
        expect(Object.keys(JSON.parse(raw) as Record<string, unknown>).sort()).toEqual(['code', 'message', 'statusCode']);
      }
      // NETWORK 실패로 서버 가용성이 하락했으므로, 실제 인식이 다시 200이 될 때까지 기다린다(다음 시험 격리 — 설정 조회 값은 캐시라 회복 판정에 쓰지 않는다)
      expect(await eventually(async () => ((await audioPost(bot.slug, mockAudio('복구 확인'))).status === 200 ? true : null), 10_000)).toBe(true);
    });

    it('EX-VO-19: 인식 경로도 허용 Origin 검사를 거친다 — 허용 목록 밖 Origin은 403이고 공급자까지 가지 않는다', async () => {
      const bot = await engineBot('인식출처', { inputEnabled: true });
      expect((await h.admin('PATCH', `/chatbots/${bot.id}/channels/WEB`, { enabled: true, config: { allowedOrigins: ['https://allowed.example'] } })).status).toBe(200);
      const callsBefore = fake.calls;
      const evil = await audioPost(bot.slug, mockAudio('x'), { Origin: 'https://evil.example' });
      expect(evil.status).toBe(403);
      expect(evil.body.code).toBe('ORIGIN_NOT_ALLOWED');
      expect(fake.calls).toBe(callsBefore);
      const ok = await audioPost(bot.slug, mockAudio('허용 출처'), { Origin: 'https://allowed.example' });
      expect(ok.status).toBe(200);
      expect(ok.body.text).toBe('허용 출처');
    });
  });
});
