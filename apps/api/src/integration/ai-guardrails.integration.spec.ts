import { toKstDayBucket } from '@chat-bot/shared-types';
import type { GuardrailEventItem, GuardrailOverview, GuardrailRule, GuardrailRuleListResponse, GuardrailSettingsResponse, GuardrailTestResponse, Paginated } from '@chat-bot/shared-types';
import { bootHarness, eventually, startFakeRag } from './helpers/ai-guardrails.harness';
import type { FakeRag, Harness } from './helpers/ai-guardrails.harness';

/**
 * AI 거버넌스·가드레일(No.36) 통합 시험 — `ai-guardrails-설계.md` §18.2 · AC-AG1~AG5 대비.
 * 가짜 외부 RAG HTTP 서버 + `prisma migrate deploy` DB. 로그·이벤트 적재는 fire-and-forget이라 폴링으로 확인한다.
 */

const RRN = '901231-1234567';
const CARD = '1234-5678-9012-3456';
const REPLACEMENT = '지금은 안내드릴 수 없어요. 전문 상담 기관에 연락해 주세요.';

interface PublicResponse {
  messageId: string;
  outputs: Array<{ type: string; payload?: { text?: string } }>;
  state: unknown;
  stateReset: boolean;
  handoff?: unknown;
  pendingAnswer?: { id: string };
}

describe('AI 거버넌스·가드레일(No.36) 통합 시험', () => {
  let h: Harness;
  let rag: FakeRag;
  const text = (r: { body: PublicResponse }): string => r.body.outputs.map((o) => o.payload?.text ?? '').join('\n');

  beforeAll(async () => {
    rag = await startFakeRag();
    h = await bootHarness({ tmpPrefix: 'ai-guardrails-test-', env: { RAG_BASE_URL: rag.url, GUARDRAIL_MAX_RULES_PER_CHATBOT: '4', RAG_STATUS_CACHE_MS: '600000' } });
  }, 90_000);

  afterAll(async () => {
    await h?.close();
    await rag?.close();
  }, 20_000);

  async function botWithAnswer(prefix: string, opts: { rag?: boolean } = {}): Promise<{ id: string; slug: string; keyword: string }> {
    const bot = await h.createChatbot(prefix);
    const keyword = `안내키워드${bot.id.slice(0, 6)}`;
    const kw = await h.admin<{ id: string }>('POST', `/chatbots/${bot.id}/keywords`, { name: keyword, synonyms: [] });
    const node = await h.admin('POST', `/chatbots/${bot.id}/dialog-nodes`, { name: '응답노드', nodeType: 'NORMAL', keywordIds: [kw.body.id], outputs: [{ type: 'TEXT', payload: { text: '엔진 답변입니다.' } }] });
    expect(node.status).toBe(201);
    if (opts.rag) {
      const res = await h.admin('PUT', `/chatbots/${bot.id}/answer-settings`, { semanticEnabled: false, ragEnabled: true, ragCompany: '테스트회사' });
      expect(res.status).toBe(200);
    }
    return { ...bot, keyword };
  }

  const ruleBody = (overrides: Record<string, unknown> = {}) => ({
    name: `규칙-${Math.random().toString(36).slice(2, 8)}`,
    category: 'CRISIS_SELF_HARM',
    expressions: ['위험표현'],
    appliesTo: 'INBOUND',
    ...overrides,
  });

  async function createRule(chatbotId: string, overrides: Record<string, unknown> = {}): Promise<GuardrailRule> {
    const res = await h.admin<GuardrailRule>('POST', `/chatbots/${chatbotId}/guardrails/rules`, ruleBody(overrides));
    expect(res.status).toBe(201);
    return res.body;
  }

  async function send(slug: string, message: string, state?: unknown) {
    return h.pub<PublicResponse>('POST', `/public/chatbots/${slug}/messages`, { sessionId: h.sessionUuid(), message, ...(state ? { state } : {}) });
  }

  async function pollPending(slug: string, first: { body: PublicResponse }): Promise<{ status: string; outputs: Array<{ payload?: { text?: string } }> }> {
    expect(first.body.pendingAnswer).toBeDefined();
    const id = first.body.messageId;
    const done = await eventually(async () => {
      const r = await h.pub<{ status: string; outputs: Array<{ payload?: { text?: string } }> }>('GET', `/public/chatbots/${slug}/messages/${id}`);
      return r.body.status !== 'PENDING' ? r.body : null;
    }, 8000);
    expect(done).not.toBeNull();
    return done as { status: string; outputs: Array<{ payload?: { text?: string } }> };
  }

  const logOf = (messageId: string) => eventually(() => h.prisma.conversationLog.findUnique({ where: { id: messageId } }));
  const eventsOf = async (chatbotId: string, messageId: string) => {
    const rows = await eventually(async () => {
      const found = await h.prisma.guardrailEvent.findMany({ where: { chatbotId, messageId }, orderBy: { createdAt: 'asc' } });
      return found.length > 0 ? found : null;
    });
    return rows ?? [];
  };

  /* ── 관리 API ── */

  describe('규칙 관리 API', () => {
    it('AC-AG2-1: EDITOR·VIEWER는 403, ADMIN은 201 + 감사 1건(표현·대체 문구 본문 없음)', async () => {
      const bot = await h.createChatbot('규칙관리');
      expect((await h.editor('POST', `/chatbots/${bot.id}/guardrails/rules`, ruleBody())).status).toBe(403);
      expect((await h.viewer('GET', `/chatbots/${bot.id}/guardrails/rules`)).status).toBe(403);

      const created = await createRule(bot.id, { name: '감사확인', expressions: ['비밀스러운표현'], action: 'REPLACE', replacementText: '비밀스러운 대체 문구' });
      const audits = await h.admin<{ items: Array<{ action: string; targetType: string; targetId: string; summary: string | null; after: unknown }> }>('GET', '/audit-logs?targetType=GuardrailRule&pageSize=20');
      const mine = audits.body.items.filter((i) => i.targetId === created.id);
      expect(mine).toHaveLength(1);
      expect(mine[0].action).toBe('CREATE');
      expect(JSON.stringify(mine[0])).not.toContain('비밀스러운');
    });

    it('AC-AG2-2: 새 규칙의 기본 동작은 기록만(MONITOR) · 켜짐', async () => {
      const bot = await h.createChatbot('기본동작');
      const rule = await createRule(bot.id);
      expect(rule).toMatchObject({ action: 'MONITOR', matchType: 'CONTAINS', enabled: true, replacementText: null, expressionCount: 1 });
    });

    it('AC-AG2-3: 대체 문구에 금지어가 있으면 400 BANNED_WORD_BLOCKED(걸린 단어는 details)', async () => {
      const bot = await h.createChatbot('금지어대체');
      const banned = `금칙어${bot.id.slice(0, 5)}`;
      expect((await h.admin('POST', '/banned-words', { word: banned })).status).toBe(201);
      const res = await h.admin<{ code: string; details?: Array<{ field: string; message: string }> }>('POST', `/chatbots/${bot.id}/guardrails/rules`, ruleBody({ action: 'REPLACE', replacementText: `이 문구에는 ${banned} 가 있다` }));
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('BANNED_WORD_BLOCKED');
      expect(res.body.details?.[0]).toMatchObject({ field: 'replacementText', message: banned });
    });

    it('AC-AG2-4: NO_RAG는 적용 위치가 사용자 질문일 때만(BOTH·OUTBOUND는 400)', async () => {
      const bot = await h.createChatbot('노래그');
      expect((await h.admin('POST', `/chatbots/${bot.id}/guardrails/rules`, ruleBody({ action: 'NO_RAG', appliesTo: 'BOTH' }))).status).toBe(400);
      expect((await h.admin('POST', `/chatbots/${bot.id}/guardrails/rules`, ruleBody({ action: 'NO_RAG', appliesTo: 'OUTBOUND' }))).status).toBe(400);
      expect((await h.admin('POST', `/chatbots/${bot.id}/guardrails/rules`, ruleBody({ action: 'NO_RAG', appliesTo: 'INBOUND' }))).status).toBe(201);
    });

    it('표현 검증(TOO_SHORT·EXACT_MULTI_TOKEN·NOT_PLAIN_TEXT) · 중복 이름 409 · 상한 409 · 교차 챗봇 404', async () => {
      const bot = await h.createChatbot('검증');
      const short = await h.admin<{ code: string; details: Array<{ field: string; message: string }> }>('POST', `/chatbots/${bot.id}/guardrails/rules`, ruleBody({ expressions: ['정상표현', 'x'] }));
      expect(short.status).toBe(400);
      expect(short.body.details[0]).toMatchObject({ field: 'expressions.1' });
      expect(short.body.details[0].message.startsWith('TOO_SHORT')).toBe(true);

      const exact = await h.admin<{ details: Array<{ field: string; message: string }> }>('POST', `/chatbots/${bot.id}/guardrails/rules`, ruleBody({ matchType: 'EXACT', expressions: ['두 단어'] }));
      expect(exact.status).toBe(400);
      expect(exact.body.details[0].message.startsWith('EXACT_MULTI_TOKEN')).toBe(true);

      const plain = await h.admin<{ details: Array<{ field: string; message: string }> }>('POST', `/chatbots/${bot.id}/guardrails/rules`, ruleBody({ action: 'REPLACE', replacementText: '자세히는 https://example.com' }));
      expect(plain.status).toBe(400);
      expect(plain.body.details[0]).toMatchObject({ field: 'replacementText' });
      expect(plain.body.details[0].message.startsWith('NOT_PLAIN_TEXT')).toBe(true);

      const first = await createRule(bot.id, { name: '중복이름' });
      const dup = await h.admin('POST', `/chatbots/${bot.id}/guardrails/rules`, ruleBody({ name: '중복이름' }));
      expect(dup.status).toBe(409);

      // 상한 4개(이 spec의 GUARDRAIL_MAX_RULES_PER_CHATBOT).
      await createRule(bot.id);
      await createRule(bot.id);
      await createRule(bot.id);
      const over = await h.admin<{ code: string }>('POST', `/chatbots/${bot.id}/guardrails/rules`, ruleBody());
      expect(over.status).toBe(409);
      expect(over.body.code).toBe('LIMIT_EXCEEDED');

      const other = await h.createChatbot('교차');
      expect((await h.admin('GET', `/chatbots/${other.id}/guardrails/rules/${first.id}`)).status).toBe(404);
    });

    it('중복 표현은 하나로 합쳐 저장하고 제거 수를 알린다 · 켜기/끄기 멱등 · 이동 · 삭제 204(이벤트는 남는다)', async () => {
      const bot = await h.createChatbot('편집');
      const created = await h.admin<GuardrailRule & { removedDuplicateExpressions?: number }>('POST', `/chatbots/${bot.id}/guardrails/rules`, ruleBody({ expressions: ['Same Word', 'same  word', '다른표현'] }));
      expect(created.status).toBe(201);
      expect(created.body.expressionCount).toBe(2);
      expect(created.body.removedDuplicateExpressions).toBe(1);

      const second = await createRule(bot.id, { name: '두번째' });
      const moved = await h.admin<GuardrailRule[]>('POST', `/chatbots/${bot.id}/guardrails/rules/${second.id}/move`, { direction: 'UP' });
      expect(moved.body[0].id).toBe(second.id);

      const off1 = await h.admin<GuardrailRule>('POST', `/chatbots/${bot.id}/guardrails/rules/${second.id}/disable`);
      const off2 = await h.admin<GuardrailRule>('POST', `/chatbots/${bot.id}/guardrails/rules/${second.id}/disable`);
      expect([off1.body.enabled, off2.body.enabled]).toEqual([false, false]);

      const list = await h.admin<GuardrailRuleListResponse>('GET', `/chatbots/${bot.id}/guardrails/rules`);
      expect(list.body.meta).toMatchObject({ ragActive: false, serverEnabled: true, limits: { maxRules: 4, usedRules: 2, usedExpressions: 3 } });

      expect((await h.admin('DELETE', `/chatbots/${bot.id}/guardrails/rules/${second.id}`)).status).toBe(204);
      expect((await h.admin('GET', `/chatbots/${bot.id}/guardrails/rules/${second.id}`)).status).toBe(404);
    });

    it('문장으로 시험하기 — 저장 0 · 감사 0 · 이벤트 0, 편집 중 규칙(draftRule)을 저장 전에 반영한다(AC-AG2-6)', async () => {
      const bot = await h.createChatbot('시험하기');
      const beforeAudit = await h.prisma.auditLog.count();
      const res = await h.admin<GuardrailTestResponse>('POST', `/chatbots/${bot.id}/guardrails/test`, {
        text: '이 문장에는 위험표현이 있어요',
        stage: 'INBOUND',
        draftRule: { name: '초안', category: 'OTHER', expressions: ['위험표현'], appliesTo: 'INBOUND', action: 'REPLACE', replacementText: REPLACEMENT, matchType: 'CONTAINS', enabled: true },
      });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ stage: 'INBOUND', result: 'REPLACE', resultText: REPLACEMENT });
      expect(res.body.hits[0]).toMatchObject({ ruleId: null, ruleName: '초안', decisive: true });
      expect(await h.prisma.guardrailRule.count({ where: { chatbotId: bot.id } })).toBe(0);
      expect(await h.prisma.guardrailEvent.count({ where: { chatbotId: bot.id } })).toBe(0);
      expect(await h.prisma.auditLog.count()).toBe(beforeAudit);

      const outbound = await h.admin<GuardrailTestResponse>('POST', `/chatbots/${bot.id}/guardrails/test`, { text: `번호는 ${RRN} 입니다`, stage: 'OUTBOUND' });
      expect(outbound.body).toMatchObject({ result: 'MASKED', resultText: '번호는 [주민등록번호] 입니다', piiCounts: { RRN: 1 } });
    });

    it('개인정보 가림 설정 — 기본값 · 저장 · 감사(문장 0) · 시험하기 반영', async () => {
      const bot = await h.createChatbot('가림설정');
      const initial = await h.admin<GuardrailSettingsResponse>('GET', `/chatbots/${bot.id}/guardrails/settings`);
      expect(initial.body).toMatchObject({ piiExit: { kinds: ['RRN', 'CARD'], preserveDates: true }, isDefault: true, governanceFloor: [] });

      const saved = await h.admin<GuardrailSettingsResponse>('PUT', `/chatbots/${bot.id}/guardrails/settings`, { piiExit: { kinds: ['CARD', 'ACCOUNT', 'CARD'], preserveDates: true } });
      expect(saved.status).toBe(200);
      expect(saved.body).toMatchObject({ piiExit: { kinds: ['CARD', 'ACCOUNT'] }, isDefault: false });
      expect((await h.editor('PUT', `/chatbots/${bot.id}/guardrails/settings`, { piiExit: { kinds: [], preserveDates: true } })).status).toBe(403);

      const audit = await h.prisma.auditLog.findFirst({ where: { targetType: 'Chatbot', targetId: bot.id }, orderBy: { createdAt: 'desc' } });
      expect(audit?.afterValue ?? '').toContain('guardrailPiiExit');
      expect(audit?.afterValue ?? '').not.toContain(RRN);

      const tested = await h.admin<GuardrailTestResponse>('POST', `/chatbots/${bot.id}/guardrails/test`, { text: `주민 ${RRN} 계좌 110-234-567890 날짜 2026-09-30`, stage: 'OUTBOUND' });
      expect(tested.body.resultText).toBe(`주민 ${RRN} 계좌 [계좌번호] 날짜 2026-09-30`);
    });

    it('보관(ARCHIVED) 챗봇은 조회·시험하기만 허용하고 쓰기는 409 CHATBOT_ARCHIVED(EX-AG-10)', async () => {
      const bot = await h.createChatbot('보관');
      const rule = await createRule(bot.id);
      await h.admin('PATCH', `/chatbots/${bot.id}/status`, { status: 'ARCHIVED' });
      expect((await h.admin('GET', `/chatbots/${bot.id}/guardrails/rules`)).status).toBe(200);
      const write = await h.admin<{ code: string }>('POST', `/chatbots/${bot.id}/guardrails/rules`, ruleBody());
      expect(write.status).toBe(409);
      expect(write.body.code).toBe('CHATBOT_ARCHIVED');
      expect((await h.admin('DELETE', `/chatbots/${bot.id}/guardrails/rules/${rule.id}`)).status).toBe(409);
      expect((await h.admin('POST', `/chatbots/${bot.id}/guardrails/test`, { text: '위험표현', stage: 'INBOUND' })).status).toBe(200);
    });
  });

  /* ── 입구 ── */

  describe('입구 판정(공개 대화)', () => {
    it('AC-AG3-1 · AC-AG2-5: 대체 규칙은 저장 직후 1턴부터 적용 — 엔진·RAG를 부르지 않고 안전 문구, 상태 보존, 로그 표식, 이벤트 1건', async () => {
      const bot = await botWithAnswer('입구대체', { rag: true });
      const rule = await createRule(bot.id, { name: '위기', action: 'REPLACE', replacementText: REPLACEMENT });
      const beforeRagCalls = rag.queryCalls;

      // 엔진이 답할 수 있는 키워드 문장이라도 규칙이 먼저다.
      const res = await send(bot.slug, `${bot.keyword} 위험표현`);
      expect(res.status).toBe(200);
      expect(text(res)).toBe(REPLACEMENT);
      expect(res.body.stateReset).toBe(false);
      expect(res.body.state).toBeDefined();
      expect(res.body.pendingAnswer).toBeUndefined();
      expect(rag.queryCalls).toBe(beforeRagCalls);

      const log = await logOf(res.body.messageId);
      expect(log).toMatchObject({ isAnswered: false, answeredByRag: false, guardrailStage: 'INBOUND', blockedByFilter: false });
      const events = await eventsOf(bot.id, res.body.messageId);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ stage: 'INBOUND', kind: 'RULE', ruleId: rule.id, appliedAction: 'REPLACE', decisive: true, effect: 'CHANGED' });

      // 끄면 바로 엔진 답변으로 돌아온다(즉시 무효화).
      await h.admin('POST', `/chatbots/${bot.id}/guardrails/rules/${rule.id}/disable`);
      expect(text(await send(bot.slug, `${bot.keyword} 위험표현`))).toBe('엔진 답변입니다.');
    });

    it('기록만(MONITOR)은 응답을 바꾸지 않고 이벤트만 남긴다(효과 NONE)', async () => {
      const bot = await botWithAnswer('입구기록');
      await createRule(bot.id);
      const res = await send(bot.slug, `${bot.keyword} 위험표현`);
      expect(text(res)).toBe('엔진 답변입니다.');
      const events = await eventsOf(bot.id, res.body.messageId);
      expect(events[0]).toMatchObject({ appliedAction: 'MONITOR', effect: 'NONE', decisive: true });
      expect((await logOf(res.body.messageId))?.guardrailStage).toBeNull();
    });

    it('AC-AG3-2: 금지어 BLOCK이 먼저 — 가드레일 이벤트 0', async () => {
      const bot = await botWithAnswer('입구금지어');
      const banned = `차단어${bot.id.slice(0, 5)}`;
      await h.admin('POST', '/banned-words', { word: banned, policy: 'BLOCK' });
      await createRule(bot.id, { action: 'REPLACE', replacementText: REPLACEMENT });
      const res = await send(bot.slug, `${banned} 위험표현`);
      expect(text(res)).not.toBe(REPLACEMENT);
      const log = await logOf(res.body.messageId);
      expect(log).toMatchObject({ blockedByFilter: true });
      expect(await h.prisma.guardrailEvent.count({ where: { chatbotId: bot.id } })).toBe(0);
    });

    it('AC-AG3-4: "AI로 보내지 않음"은 엔진 결과는 그대로 두고 RAG 진입만 막는다(가짜 RAG 호출 0 · 대기 답변 없음)', async () => {
      const bot = await botWithAnswer('입구노래그', { rag: true });
      const rule = await createRule(bot.id, { name: '보내지않음', action: 'NO_RAG' });

      const before = rag.queryCalls;
      const blocked = await send(bot.slug, '위험표현 이 문서 어디 있나요');
      expect(blocked.body.pendingAnswer).toBeUndefined();
      expect(rag.queryCalls).toBe(before);
      const events = await eventsOf(bot.id, blocked.body.messageId);
      expect(events[0]).toMatchObject({ appliedAction: 'NO_RAG', effect: 'CHANGED', decisive: true, ruleId: rule.id });

      // 같은 챗봇의 규칙에 안 걸리는 질문은 RAG로 간다.
      const passes = await send(bot.slug, '이 문서 어디 있나요 알려줘');
      expect(passes.body.pendingAnswer).toBeDefined();
      await pollPending(bot.slug, passes);
      expect(rag.queryCalls).toBe(before + 1);
    });

    it('시뮬레이터(FR-AG3-7): 엔진 결과는 그대로 보여 주고 guardrailInbound로 "운영이면 대체된다"를 표시한다 — 이벤트·로그 0', async () => {
      const bot = await botWithAnswer('시뮬레이터');
      const rule = await createRule(bot.id, { name: '시뮬규칙', action: 'REPLACE', replacementText: REPLACEMENT });
      type Sim = { outputs: Array<{ payload?: { text?: string } }>; guardrailInbound?: { action: string; ruleNames: string[]; replacementText?: string } };

      const hit = await h.admin<Sim>('POST', `/chatbots/${bot.id}/simulate`, { message: `${bot.keyword} 위험표현` });
      expect(hit.status).toBe(200);
      expect(hit.body.outputs[0].payload?.text).toBe('엔진 답변입니다.');
      expect(hit.body.guardrailInbound).toEqual({ action: 'REPLACE', ruleNames: [rule.name], replacementText: REPLACEMENT });

      const plain = await h.admin<Sim>('POST', `/chatbots/${bot.id}/simulate`, { message: `${bot.keyword} 문의` });
      expect('guardrailInbound' in plain.body).toBe(false);
      expect(await h.prisma.guardrailEvent.count({ where: { chatbotId: bot.id } })).toBe(0);
      expect(await h.prisma.conversationLog.count({ where: { chatbotId: bot.id } })).toBe(0);
    });

    it('AC-AG3-5: NODE 버튼은 사용자 입력이 아니라 적용하지 않는다(라벨이 표현과 같아도)', async () => {
      const bot = await botWithAnswer('입구버튼');
      await createRule(bot.id, { action: 'REPLACE', replacementText: REPLACEMENT });
      const node = await h.prisma.dialogNode.findFirst({ where: { chatbotId: bot.id } });
      const res = await h.pub<PublicResponse>('POST', `/public/chatbots/${bot.slug}/messages`, {
        sessionId: h.sessionUuid(),
        buttonAction: { kind: 'NODE', nodeId: node!.id, label: '위험표현' },
      });
      expect(res.status).toBe(200);
      expect(text(res)).not.toBe(REPLACEMENT);
      expect(await h.prisma.guardrailEvent.count({ where: { chatbotId: bot.id } })).toBe(0);
    });
  });

  /* ── 출구 ── */

  describe('출구 판정(외부 RAG 답)', () => {
    async function ragTurn(bot: { slug: string }, answer: string) {
      rag.answer = answer;
      const first = await send(bot.slug, '문서에서 찾아줄 질문입니다');
      const done = await pollPending(bot.slug, first);
      return { first, done };
    }

    it('AC-AG4-4: 기본 가림 — 주민번호·카드는 가려지고 날짜·전화는 유지, 대화 기록도 가린 텍스트, 종류별 이벤트', async () => {
      const bot = await botWithAnswer('출구가림', { rag: true });
      const { first, done } = await ragTurn(bot, `주민 ${RRN}, 카드 ${CARD}, 날짜 2026-09-30, 전화 010-1234-5678 입니다.`);
      expect(done.status).toBe('READY');
      expect(done.outputs[0].payload?.text).toBe('주민 [주민등록번호], 카드 [카드번호], 날짜 2026-09-30, 전화 010-1234-5678 입니다.');

      const log = await logOf(first.body.messageId);
      expect(log).toMatchObject({ isAnswered: true, answeredByRag: true, guardrailStage: null });
      expect(log?.botResponse).not.toContain('901231');
      const events = await eventsOf(bot.id, first.body.messageId);
      expect(events.filter((e) => e.kind === 'PII').map((e) => [e.piiKind, e.piiCount, e.appliedAction]).sort()).toEqual([
        ['CARD', 1, 'MASK'],
        ['RRN', 1, 'MASK'],
      ]);
    });

    it('AC-AG4-1: 대체 규칙 — 대기 답변은 FAILED(출처 없음)로 안전 문구, 대화 기록은 미응답·OUTBOUND 표식, 호출 품질은 SUCCESS', async () => {
      const bot = await botWithAnswer('출구대체', { rag: true });
      const rule = await createRule(bot.id, { name: '의료', category: 'MEDICAL_ADVICE', appliesTo: 'OUTBOUND', expressions: ['복용하세요'], action: 'REPLACE', replacementText: REPLACEMENT });
      const { first, done } = await ragTurn(bot, '하루 세 번 약을 복용하세요.');
      expect(done.status).toBe('FAILED');
      expect(done.outputs[0].payload?.text).toBe(REPLACEMENT);
      expect((done as unknown as { sources?: unknown[] }).sources ?? []).toHaveLength(0);

      const log = await logOf(first.body.messageId);
      expect(log).toMatchObject({ isAnswered: false, answeredByRag: false, guardrailStage: 'OUTBOUND' });
      expect(log?.botResponse).toBe(REPLACEMENT);
      const callLog = await eventually(() => h.prisma.ragCallLog.findFirst({ where: { conversationLogId: first.body.messageId } }));
      expect(callLog?.outcome).toBe('SUCCESS');
      const events = await eventsOf(bot.id, first.body.messageId);
      expect(events[0]).toMatchObject({ stage: 'OUTBOUND', ruleId: rule.id, appliedAction: 'REPLACE', effect: 'CHANGED', decisive: true });
    });

    it('AC-AG4-2: 기록만 규칙은 답을 그대로 전달하고 이벤트만 남긴다', async () => {
      const bot = await botWithAnswer('출구기록', { rag: true });
      await createRule(bot.id, { appliesTo: 'OUTBOUND', expressions: ['복용하세요'] });
      const { first, done } = await ragTurn(bot, '하루 세 번 약을 복용하세요.');
      expect(done.status).toBe('READY');
      expect(done.outputs[0].payload?.text).toBe('하루 세 번 약을 복용하세요.');
      const events = await eventsOf(bot.id, first.body.messageId);
      expect(events[0]).toMatchObject({ appliedAction: 'MONITOR', effect: 'NONE' });
    });

    it('개인정보만 남는 답은 기존 폴백 문구로 수렴한다(EX-AG-8 — FAILED · OUTBOUND 표식)', async () => {
      const bot = await botWithAnswer('출구폴백', { rag: true });
      const { first, done } = await ragTurn(bot, RRN);
      expect(done.status).toBe('FAILED');
      expect(done.outputs[0].payload?.text).not.toContain('[주민등록번호]');
      expect((await logOf(first.body.messageId))?.guardrailStage).toBe('OUTBOUND');
      const events = await eventsOf(bot.id, first.body.messageId);
      expect(events[0]).toMatchObject({ kind: 'PII', appliedAction: 'FALLBACK' });
    });

    it('AC-AG4-5·6: 종류를 계좌로 바꾸면 날짜 보호가 동작하고, 종류를 비우면 현행과 같다', async () => {
      const bot = await botWithAnswer('출구설정', { rag: true });
      await h.admin('PUT', `/chatbots/${bot.id}/guardrails/settings`, { piiExit: { kinds: ['ACCOUNT'], preserveDates: true } });
      const a = await ragTurn(bot, `입금일 2026-09-30 계좌 110-234-567890 주민 ${RRN}`);
      expect(a.done.outputs[0].payload?.text).toBe(`입금일 2026-09-30 계좌 [계좌번호] 주민 ${RRN}`);

      await h.admin('PUT', `/chatbots/${bot.id}/guardrails/settings`, { piiExit: { kinds: [], preserveDates: true } });
      const b = await ragTurn(bot, `주민 ${RRN}`);
      expect(b.done.outputs[0].payload?.text).toBe(`주민 ${RRN}`);
      expect(await h.prisma.guardrailEvent.count({ where: { chatbotId: bot.id, messageId: b.first.body.messageId } })).toBe(0);
    });

    it('AC-AG4-3: 엔진(FAQ·노드) 답과 관리자가 쓴 답에는 출구 규칙이 적용되지 않는다', async () => {
      const bot = await botWithAnswer('출구범위');
      await createRule(bot.id, { appliesTo: 'OUTBOUND', expressions: ['엔진 답변'], action: 'REPLACE', replacementText: REPLACEMENT });
      const res = await send(bot.slug, `${bot.keyword} 문의`);
      expect(text(res)).toBe('엔진 답변입니다.');
      expect(await h.prisma.guardrailEvent.count({ where: { chatbotId: bot.id } })).toBe(0);
    });
  });

  /* ── 기록·현황 ── */

  describe('기록 · 현황 · 데이터 무결', () => {
    it('AC-AG5-1·2: 이벤트에 문장이 없고, 현황 합계가 이벤트 합과 같으며, 이벤트 목록은 대화 마스킹본을 싣는다', async () => {
      const bot = await botWithAnswer('현황', { rag: true });
      const replace = await createRule(bot.id, { name: '대체규칙', expressions: ['위험표현'], action: 'REPLACE', replacementText: REPLACEMENT });
      await createRule(bot.id, { name: '기록규칙', expressions: ['조심표현'] });
      await send(bot.slug, '위험표현 하나');
      await send(bot.slug, '위험표현 둘');
      const monitored = await send(bot.slug, `${bot.keyword} 조심표현`);
      rag.answer = `카드 ${CARD} 안내`;
      const ragFirst = await send(bot.slug, '문서에서 찾아줄 질문입니다');
      await pollPending(bot.slug, ragFirst);
      await eventsOf(bot.id, ragFirst.body.messageId);
      await eventsOf(bot.id, monitored.body.messageId);

      // 이벤트 행 어디에도 입력 문장·표현·대체 문구·개인정보 숫자가 없다.
      const all = await h.prisma.guardrailEvent.findMany({ where: { chatbotId: bot.id } });
      const dumped = JSON.stringify(all);
      for (const secret of ['위험표현 하나', '조심표현', REPLACEMENT, '1234-5678', '9012-3456']) expect(dumped).not.toContain(secret);

      const overview = await h.admin<GuardrailOverview>('GET', `/chatbots/${bot.id}/guardrails/overview`);
      expect(overview.status).toBe(200);
      expect(overview.body.totals).toMatchObject({ inboundHits: 3, replaced: 2, monitored: 1, maskedAnswers: 1 });
      const repl = overview.body.rules.find((r) => r.ruleId === replace.id);
      expect(repl).toMatchObject({ inboundHits: 2, changedHits: 2, currentAction: 'REPLACE', deleted: false });
      expect(overview.body.pii).toEqual([{ kind: 'CARD', answers: 1, count: 1 }]);
      expect(overview.body.hitl).toEqual({ envModeOn: false, approvalRequired: false });

      // 일 버킷은 KST 기준이라 시험도 KST 날짜로 기간을 만든다(UTC 날짜로 만들면 자정 전후에 어긋난다).
      const to = toKstDayBucket(new Date());
      const from = toKstDayBucket(new Date(Date.now() - 2 * 86_400_000));
      const events = await h.admin<Paginated<GuardrailEventItem>>('GET', `/chatbots/${bot.id}/guardrails/events?from=${from}&to=${to}&stage=INBOUND&appliedAction=REPLACE`);
      expect(events.status).toBe(200);
      expect(events.body.total).toBe(2);
      expect(events.body.items[0].conversation).toMatchObject({ textPurged: false });
      expect(events.body.items[0].conversation?.botResponse).toBe(REPLACEMENT);

      // 기간 상한 90일 · 잘못된 기간.
      const tooWide = await h.admin<{ code: string }>('GET', `/chatbots/${bot.id}/guardrails/overview?from=2024-01-01&to=2026-09-30`);
      expect(tooWide.status).toBe(400);
      expect(tooWide.body.code).toBe('STATS_RANGE_TOO_WIDE');
      expect((await h.admin<{ code: string }>('GET', `/chatbots/${bot.id}/guardrails/overview?from=2026-09-30&to=2026-09-01`)).body.code).toBe('INVALID_PERIOD');
    });

    it('AC-AG1-4 · AC-AG2-7: 규칙에 걸리는 턴이 여러 번이어도 대화 자산·답변 설정은 그대로이고, 버전 스냅샷에 규칙이 없다', async () => {
      const bot = await botWithAnswer('자산무결', { rag: true });
      await createRule(bot.id, { action: 'REPLACE', replacementText: REPLACEMENT });
      const snapshotAssets = async () =>
        JSON.stringify({
          nodes: await h.prisma.dialogNode.findMany({ where: { chatbotId: bot.id }, orderBy: { id: 'asc' } }),
          keywords: await h.prisma.keyword.findMany({ where: { chatbotId: bot.id }, orderBy: { id: 'asc' } }),
          faqs: await h.prisma.faqEntry.findMany({ where: { chatbotId: bot.id } }),
          intents: await h.prisma.intent.findMany({ where: { chatbotId: bot.id } }),
          topics: await h.prisma.topic.findMany({ where: { chatbotId: bot.id } }),
          answer: await h.prisma.chatbotAnswerSetting.findUnique({ where: { chatbotId: bot.id } }),
        });
      const before = await snapshotAssets();
      for (let i = 0; i < 5; i += 1) await send(bot.slug, `위험표현 ${i}번째`);
      expect(await snapshotAssets()).toBe(before);

      const version = await h.admin('POST', `/chatbots/${bot.id}/versions`, {});
      expect(version.status).toBe(201);
      const created = await h.prisma.chatbotVersion.findFirst({ where: { chatbotId: bot.id }, orderBy: { createdAt: 'desc' } });
      const payload = await h.prisma.chatbotVersionPayload.findUnique({ where: { versionId: created!.id } });
      expect(payload?.payload ?? '').not.toContain('위험표현');
      expect(payload?.payload ?? '').not.toContain('guardrail');
    });

    it('AC-AG5-3: 대체 턴은 미응답으로 집계된다(응답출처 FALLBACK) — 통계 정의 불변', async () => {
      const bot = await botWithAnswer('통계분류', { rag: true });
      await createRule(bot.id, { name: '입구', action: 'REPLACE', replacementText: REPLACEMENT });
      await createRule(bot.id, { name: '출구', appliesTo: 'OUTBOUND', expressions: ['복용하세요'], action: 'REPLACE', replacementText: REPLACEMENT });
      const inbound = await send(bot.slug, '위험표현 문의');
      rag.answer = '약을 복용하세요.';
      const outbound = await send(bot.slug, '문서에서 찾아줄 질문입니다');
      await pollPending(bot.slug, outbound);
      for (const id of [inbound.body.messageId, outbound.body.messageId]) {
        const log = await logOf(id);
        expect(log).toMatchObject({ isAnswered: false, answeredByRag: false, blockedByFilter: false });
        expect(log?.guardrailStage).not.toBeNull();
      }
      const today = toKstDayBucket(new Date());
      const dist = await h.admin<{ bySource: Array<{ source: string; count: number }> }>('GET', `/stats/distribution?chatbotId=${bot.id}&from=${today}&to=${today}`);
      const summary = await h.admin<{ totals: { turnCount: number; unansweredCount: number; answeredCount: number } }>('GET', `/stats/summary?chatbotId=${bot.id}&from=${today}&to=${today}`);
      expect(dist.status).toBe(200);
      expect(summary.status).toBe(200);
      // 통계 정의 불변 — 대체 턴은 FALLBACK 출처이자 미응답이라 `FALLBACK === unansweredCount` 불변식이 유지된다.
      expect(dist.body.bySource.find((s) => s.source === 'FALLBACK')?.count).toBe(2);
      expect(summary.body.totals.unansweredCount).toBe(2);
      expect(summary.body.totals.answeredCount).toBe(0);
    });
  });
});
