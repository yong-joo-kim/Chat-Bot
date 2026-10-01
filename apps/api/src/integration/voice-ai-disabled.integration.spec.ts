import type { GovernanceMapResponse, VoiceOverviewResponse, VoiceSettingsInput } from '@chat-bot/shared-types';
import type { QueryCountingPrismaClient } from './helpers/ai-guardrails.harness';
import { bootHarness, eventually } from './helpers/ai-guardrails.harness';
import type { Harness } from './helpers/ai-guardrails.harness';
import { rawPost } from './helpers/voice-ai.helpers';

/**
 * 음성 AI(No.32) — **서버 음성 꺼짐(기본 설치)** 통합 시험(voice-ai-설계.md §16 FR-0-322) · 쿼리 수 계측.
 * 첫 시험이 데이터 지도의 "기본 설치 바이트 동일"(speech 절·SPEECH_LOCAL 행 없음)을 확인하고, 이후 시험이 설정을 만든다.
 */
const EXPECTED_TURN_QUERY_COUNT = 17;
const VOICE_TABLE = /chatbot_voice_settings|speech_daily_stats/i;

describe('음성 AI(No.32) — 서버 스위치 꺼짐(기본)', () => {
  let h: Harness;
  let counter: QueryCountingPrismaClient;

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
    h = await bootHarness({ tmpPrefix: 'voice-ai-off-', countingPrisma: true, env: { RAG_BASE_URL: '', SPEECH_ENABLED: 'false' } });
    counter = h.prisma as unknown as QueryCountingPrismaClient;
  }, 90_000);

  afterAll(async () => {
    await h?.close();
  }, 20_000);

  async function bot(prefix: string): Promise<{ id: string; slug: string; keyword: string }> {
    const created = await h.createChatbot(prefix);
    const keyword = `음성쿼리-${created.id.slice(0, 6)}`;
    const kw = await h.admin<{ id: string }>('POST', `/chatbots/${created.id}/keywords`, { name: keyword, synonyms: [] });
    await h.admin('POST', `/chatbots/${created.id}/dialog-nodes`, { name: '응답노드', nodeType: 'NORMAL', keywordIds: [kw.body.id], outputs: [{ type: 'TEXT', payload: { text: '응답-A' } }] });
    return { ...created, keyword };
  }

  async function measure(slug: string, message: string, features?: string[]): Promise<{ count: number; queries: string[] }> {
    counter.queries.length = 0;
    const res = await h.pub('POST', `/public/chatbots/${slug}/messages`, { sessionId: h.sessionUuid(), message, ...(features ? { features } : {}) });
    expect(res.status).toBe(200);
    const logged = await eventually(async () => counter.queries.some((q) => /insert into[\s\S]*conversation_logs/i.test(q)));
    expect(logged).toBe(true);
    await new Promise((r) => setTimeout(r, 150));
    return { count: counter.queries.length, queries: [...counter.queries] };
  }

  it('기본 설치 데이터 지도 — speech 절도 SPEECH_LOCAL 출구 행도 없다(바이트 동일)', async () => {
    const map = await h.admin<GovernanceMapResponse>('GET', '/governance/map');
    expect(map.status).toBe(200);
    expect('speech' in map.body).toBe(false);
    expect(map.body.egress.exits.map((e) => e.exitId)).toEqual(['EMBEDDING', 'RAG', 'AUGMENT_GEMINI', 'AUGMENT_LOCAL']);
  });

  it('서버 꺼짐 → 인식 요청은 핸들러 DB 접근 0으로 503 SPEECH_UNAVAILABLE(챗봇이 입력을 켜 두었어도)', async () => {
    const b = await bot('끔인식');
    await h.admin('PUT', `/chatbots/${b.id}/voice`, voice({ inputEnabled: true }));
    counter.queries.length = 0;
    const res = await rawPost<{ code: string }>(`${h.baseUrl}/public/chatbots/${b.slug}/speech/transcriptions`, Buffer.from('MOCK:안녕'), { 'Content-Type': 'audio/webm', 'x-cb-session-id': h.sessionUuid() });
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('SPEECH_UNAVAILABLE');
    // 핸들러 자체의 DB 접근은 0 — 기존 Origin 가드의 챗봇·채널 조회 2건만 있다(핸들러가 슬러그 판정·음성 설정을 읽지 않는다).
    expect(counter.queries.filter((q) => !/from `main`\.`(chatbots|channels)`/i.test(q))).toEqual([]);
    expect(counter.queries.length).toBeLessThanOrEqual(2);
  });

  it('서버 꺼짐 — 입력은 마이크 없음 · 듣기는 서버 스위치와 무관하게 켜진다 · 관리 화면 서버 상태 SERVER_DISABLED', async () => {
    const inputOnly = await bot('끔입력');
    await h.admin('PUT', `/chatbots/${inputOnly.id}/voice`, voice({ inputEnabled: true }));
    expect('voice' in (await h.pub<Record<string, unknown>>('GET', `/public/chatbots/${inputOnly.slug}/config`)).body).toBe(false);

    const tts = await bot('끔듣기');
    await h.admin('PUT', `/chatbots/${tts.id}/voice`, voice({ inputEnabled: true, ttsEnabled: true }));
    const cfg = await h.pub<{ voice?: unknown }>('GET', `/public/chatbots/${tts.slug}/config`);
    expect(cfg.body.voice).toEqual({ input: false, tts: true, autoReadToggle: true, rate: 1 });

    const overview = await h.admin<VoiceOverviewResponse>('GET', `/chatbots/${inputOnly.id}/voice`);
    expect(overview.body.server).toEqual({ enabled: false, provider: 'mock', inputAvailable: false, reason: 'SERVER_DISABLED' });
    // 서버가 꺼져 있어도 입력 켜기 저장은 허용한다(FR-VO5-2)
    expect(overview.body.settings.inputEnabled).toBe(true);
  });

  it('설정이 생기면 데이터 지도에 speech 절(serverEnabled false · 켜진 챗봇 수) — 출구 행은 여전히 없다', async () => {
    const map = await h.admin<GovernanceMapResponse>('GET', '/governance/map');
    expect(map.body.speech).toMatchObject({ serverEnabled: false, provider: 'mock', ttsLocation: 'USER_DEVICE', ttsServerEgress: false });
    expect(map.body.speech!.chatbotsInputEnabled).toBeGreaterThanOrEqual(2);
    expect(map.body.speech!.chatbotsTtsEnabled).toBeGreaterThanOrEqual(1);
    expect(map.body.egress.exits.map((e) => e.exitId)).not.toContain('SPEECH_LOCAL');
  });

  it('쿼리 수 — speech-v1을 선언해도 음성 설정이 없는 챗봇의 첫 턴은 17(음성 테이블 조회 0 · 캐시 적중)', async () => {
    // 예열 — 음성 설정 전역 색인 1회 적재 + 번들·금지어 캐시 콜드 비용을 흡수한다(No.36 가드레일 시험과 같은 방식).
    const warm = await bot('음성쿼리예열');
    await measure(warm.slug, `${warm.keyword} 문의`, ['speech-v1']);

    const target = await bot('음성쿼리측정');
    const declared = await measure(target.slug, `${target.keyword} 문의`, ['speech-v1']);
    expect(declared.queries.filter((q) => VOICE_TABLE.test(q))).toEqual([]);
    expect(declared.count).toBe(EXPECTED_TURN_QUERY_COUNT);

    const plain = await bot('음성쿼리선언없음');
    const undeclared = await measure(plain.slug, `${plain.keyword} 문의`);
    expect(undeclared.count).toBe(EXPECTED_TURN_QUERY_COUNT);
    expect(undeclared.queries.filter((q) => VOICE_TABLE.test(q))).toEqual([]);
  });

  it('공개 설정 조회도 음성을 안 쓰는 챗봇은 색인 캐시 적중 시 음성 테이블 쿼리 0', async () => {
    const b = await bot('음성설정쿼리');
    await h.pub('GET', `/public/chatbots/${b.slug}/config`); // 예열
    counter.queries.length = 0;
    const res = await h.pub<Record<string, unknown>>('GET', `/public/chatbots/${b.slug}/config`);
    expect(res.status).toBe(200);
    expect('voice' in res.body).toBe(false);
    expect(counter.queries.filter((q) => VOICE_TABLE.test(q))).toEqual([]);
  });

  it('음성 설정이 켜진 챗봇의 선언 턴도 색인 캐시 적중이면 추가 쿼리 0(speech 키는 붙는다)', async () => {
    const b = await bot('음성쿼리켜짐');
    await h.admin('PUT', `/chatbots/${b.id}/voice`, voice({ ttsEnabled: true })); // 저장 = 색인 무효화
    await measure(b.slug, `${b.keyword} 예열`, ['speech-v1']); // 색인 재적재 1회
    const hit = await measure(b.slug, `${b.keyword} 문의`, ['speech-v1']);
    expect(hit.queries.filter((q) => VOICE_TABLE.test(q))).toEqual([]);
    expect(hit.count).toBeLessThanOrEqual(EXPECTED_TURN_QUERY_COUNT); // 같은 챗봇의 둘째 턴 — 번들 캐시 적중이라 첫 턴(17)보다 늘지 않는다
  });
});
