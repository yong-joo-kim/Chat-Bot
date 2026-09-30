import type { QueryCountingPrismaClient } from './helpers/ai-guardrails.harness';
import { bootHarness, eventually } from './helpers/ai-guardrails.harness';
import type { Harness } from './helpers/ai-guardrails.harness';

/**
 * 가드레일(No.36) — 공개 대화 경로 Prisma 쿼리 수 계측(`ai-guardrails-설계.md` §4.4 · §16 · C-3 · FR-AG2-6).
 * - 규칙이 없는 챗봇의 첫 턴 쿼리 수 = 도입 전 고정값(`data-governance-query-count-*` · `environment-query-count`와 같은 17 —
 *   "신규 챗봇의 첫 턴" 측정, 예열 턴이 프로세스 전역 색인 적재 1회를 흡수한다) · 가드레일 테이블 조회 0.
 * - 규칙이 있는 챗봇: 콜드 첫 턴만 규칙 프로필 쿼리가 더해지고, 캐시 적중 턴은 추가 쿼리 0.
 */
const EXPECTED_TURN_QUERY_COUNT = 17;
const GUARDRAIL_TABLE = /guardrail_(rules|events)|chatbot_guardrail_settings/i;

describe('가드레일(No.36) — 공개 대화 Prisma 쿼리 수', () => {
  let h: Harness;
  let counter: QueryCountingPrismaClient;

  beforeAll(async () => {
    h = await bootHarness({ tmpPrefix: 'ai-guardrails-qc-', countingPrisma: true, env: { RAG_BASE_URL: '' } });
    counter = h.prisma as unknown as QueryCountingPrismaClient;
  }, 90_000);

  afterAll(async () => {
    await h?.close();
  }, 20_000);

  async function bot(prefix: string): Promise<{ id: string; slug: string; keyword: string }> {
    const created = await h.createChatbot(prefix);
    const keyword = `쿼리수-${created.id.slice(0, 6)}`;
    const kw = await h.admin<{ id: string }>('POST', `/chatbots/${created.id}/keywords`, { name: keyword, synonyms: [] });
    await h.admin('POST', `/chatbots/${created.id}/dialog-nodes`, { name: '응답노드', nodeType: 'NORMAL', keywordIds: [kw.body.id], outputs: [{ type: 'TEXT', payload: { text: '응답-A' } }] });
    return { ...created, keyword };
  }

  async function measure(slug: string, message: string): Promise<{ count: number; queries: string[] }> {
    counter.queries.length = 0;
    const res = await h.pub('POST', `/public/chatbots/${slug}/messages`, { sessionId: h.sessionUuid(), message });
    expect(res.status).toBe(200);
    const logged = await eventually(async () => counter.queries.some((q) => /insert into[\s\S]*conversation_logs/i.test(q)));
    expect(logged).toBe(true);
    // 로그 적재 뒤 이어지는 비동기 잔여 작업(미응답 수집 등)이 끝나도록 잠깐 기다린다.
    await new Promise((r) => setTimeout(r, 150));
    return { count: counter.queries.length, queries: [...counter.queries] };
  }

  it('규칙이 없는 챗봇의 첫 턴은 도입 전 고정값(17)이고 가드레일 테이블을 한 번도 조회하지 않는다', async () => {
    // 예열 — 프로세스 전역 색인 1회 적재(금지어 전역 캐시와 같은 성질)와 번들·금지어 캐시 콜드 비용을 흡수한다.
    const warm = await bot('쿼리수예열');
    await measure(warm.slug, `${warm.keyword} 문의`);

    const target = await bot('쿼리수측정');
    const { count, queries } = await measure(target.slug, `${target.keyword} 문의`);
    expect(queries.filter((q) => GUARDRAIL_TABLE.test(q))).toEqual([]);
    expect(count).toBe(EXPECTED_TURN_QUERY_COUNT);

    // 같은 챗봇의 둘째 턴도 가드레일 쿼리 0(색인 캐시 적중 — 쿼리 0 · 정규화 0).
    const second = await measure(target.slug, `${target.keyword} 또 문의`);
    expect(second.queries.filter((q) => GUARDRAIL_TABLE.test(q))).toEqual([]);
  });

  it('규칙이 있는 챗봇 — 콜드 첫 턴은 색인 재적재 + 규칙 프로필 조회, 캐시 적중 턴은 추가 쿼리 0, 적중 턴은 이벤트 INSERT 1건', async () => {
    const withRules = await bot('쿼리수규칙');
    const created = await h.admin('POST', `/chatbots/${withRules.id}/guardrails/rules`, { name: '기록', category: 'OTHER', expressions: ['위험표현'], appliesTo: 'INBOUND' });
    expect(created.status).toBe(201); // 저장 = 전역 색인·이 챗봇 프로필 즉시 무효화.

    const cold = await measure(withRules.slug, `${withRules.keyword} 문의`);
    const coldGuardrail = cold.queries.filter((q) => GUARDRAIL_TABLE.test(q));
    expect(coldGuardrail.length).toBe(2); // ① 전역 색인(distinct chatbotId) ② 이 챗봇의 켜진 규칙 — TTL당 1회씩.
    expect(coldGuardrail.every((q) => /select/i.test(q))).toBe(true);

    const warm = await measure(withRules.slug, `${withRules.keyword} 두번째 문의`);
    expect(warm.queries.filter((q) => GUARDRAIL_TABLE.test(q))).toEqual([]);

    // 기록만 규칙에 걸리는 턴 — 이벤트 적재는 `createMany` 1회(응답 대기 0).
    const hit = await measure(withRules.slug, `${withRules.keyword} 위험표현`);
    const inserts = hit.queries.filter((q) => /insert into[\s\S]*guardrail_events/i.test(q));
    expect(inserts).toHaveLength(1);
    expect(hit.queries.filter((q) => GUARDRAIL_TABLE.test(q) && /select/i.test(q))).toEqual([]);
  });
});
