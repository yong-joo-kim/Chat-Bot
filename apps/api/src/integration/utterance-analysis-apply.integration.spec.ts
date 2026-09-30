import { randomUUID } from 'node:crypto';
import { ApiException } from '../common/api.exception';
import { IntentsService } from '../intents/intents.service';
import { LearningApplyService } from '../learning/learning-apply.service';
import { buildCsvFile, startHarness, topicSentences } from './helpers/utterance-analysis.harness';
import type { Harness } from './helpers/utterance-analysis.harness';

/**
 * 발화 묶음 분석(No.21) 통합 시험 — 선택 발화 → 의도 예문 반영(AC-DC5 · 설계서 §15 · §20.7)과 환경 모드(AC-DC4-3 ·
 * AC-DC5-5). 반영 경로 1곳(`UtteranceApplyService`)의 계획·미리보기·부분 성공·번들 무효화 요청당 1회·자동 스냅샷·
 * 감사를 HTTP 계약 수준에서 검증한다.
 */

type Any = Record<string, any>;
const BASE = (chatbotId: string) => `/chatbots/${chatbotId}/utterance-analyses`;

describe('발화 묶음 분석(No.21) 통합 시험 — 의도 예문 반영', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await startHarness();
  }, 120_000);

  afterAll(async () => {
    await h?.close();
  }, 30_000);

  async function analyze(chatbotId: string, sentences: string[], conditions: Any = { targetClusterCount: 2, minClusterSize: 3 }): Promise<{ analysis: Any; idOf: (text: string) => string }> {
    const res = await h.startAnalysis(chatbotId, { name: 'apply.csv', content: buildCsvFile(sentences.map((s) => [s])) }, conditions);
    if (res.status !== 202) throw new Error(`요청 실패 ${res.status} ${JSON.stringify(res.body)}`);
    const analysis = await h.waitForTerminal(chatbotId, res.body.analysisId);
    expect(analysis.status).toBe('SUCCEEDED');
    const items: Any[] = [];
    for (let page = 1; ; page += 1) {
      const list = await h.api<Any>('GET', `${BASE(chatbotId)}/${analysis.id}/utterances?page=${page}&pageSize=100`);
      items.push(...list.body.items);
      if (items.length >= list.body.total) break;
    }
    const idByText = new Map(items.map((u) => [u.text as string, u.id as string]));
    return {
      analysis,
      idOf: (text) => {
        const id = idByText.get(text);
        if (!id) throw new Error(`발화를 찾을 수 없음: ${text}`);
        return id;
      },
    };
  }

  async function createIntent(chatbotId: string, name: string, examples: string[]): Promise<string> {
    const res = await h.api<Any>('POST', `/chatbots/${chatbotId}/intents`, { json: { name, examples } });
    if (res.status !== 201) throw new Error(`의도 생성 실패 ${res.status} ${JSON.stringify(res.body)}`);
    return res.body.intent.id as string;
  }

  async function intentExamples(intentId: string): Promise<string[]> {
    const row = await h.prisma.intent.findUniqueOrThrow({ where: { id: intentId } });
    return JSON.parse(row.examples) as string[];
  }

  describe('계획 · 미리보기 · 반영(AC-DC5-1)', () => {
    let bot: string;
    let intentId: string;
    let analysisId: string;
    let selected: string[];
    let ordinaryIds: string[];
    let idOf: (t: string) => string;
    const LONG = `환불 ${'가'.repeat(200)}`;
    const BANNED = '나쁜말 환불 요청합니다';
    const BANNED_MASKED = '*** 환불 요청합니다'; // 저장은 마스킹본뿐이다
    const DUP_IN_TARGET = '환불 신청은 어떻게 하나요';

    beforeAll(async () => {
      bot = await h.createChatbot('반영 시험봇');
      intentId = await createIntent(bot, '환불 문의', [DUP_IN_TARGET]);
      await createIntent(bot, '배송 문의', ['배송 관련해서 문의드립니다']);
      const bw = await h.api('POST', '/banned-words', { json: { word: '나쁜말', matchType: 'CONTAINS', policy: 'WARN' } });
      expect([200, 201]).toContain(bw.status);
      const out = await analyze(bot, [...topicSentences('환불'), LONG, BANNED, ...topicSentences('배송'), ...topicSentences('로그인')], { targetClusterCount: 3, minClusterSize: 5 });
      analysisId = out.analysis.id;
      idOf = out.idOf;
      ordinaryIds = topicSentences('환불')
        .filter((t) => t !== DUP_IN_TARGET)
        .map(idOf);
      selected = [...ordinaryIds, idOf(DUP_IN_TARGET), idOf(LONG), idOf(BANNED_MASKED)];
      expect(selected).toHaveLength(10);
    }, 120_000);

    it('미리보기 — 7건 포함 · 3건 제외(중복·201자 이상·금지어) · DB 변경 0 · 감사 0', async () => {
      const before = { examples: await intentExamples(intentId), audits: await h.prisma.auditLog.count(), versions: await h.prisma.chatbotVersion.count({ where: { chatbotId: bot } }) };
      const res = await h.api<Any>('POST', `${BASE(bot)}/${analysisId}/apply/preview`, { json: { utteranceIds: selected, target: { kind: 'EXISTING', intentId } } });
      expect(res.status).toBe(200);
      expect(res.body.target).toEqual({ resolution: 'EXISTING', intentId, intentName: '환불 문의' });
      expect(res.body.included).toHaveLength(7);
      expect(res.body.excluded.map((e: Any) => e.reason).sort()).toEqual(['BANNED_WORD', 'DUPLICATE_IN_TARGET', 'TOO_LONG']);
      expect(res.body.resultingExampleCount).toBe(1 + 7);
      expect(res.body.linkedNodeCount).toBe(0);
      expect(res.body.draftOnly).toBe(false);
      for (const i of res.body.included) expect(i.warnings).toEqual([]);
      expect({ examples: await intentExamples(intentId), audits: await h.prisma.auditLog.count(), versions: await h.prisma.chatbotVersion.count({ where: { chatbotId: bot } }) }).toEqual(before);
    });

    it('다른 의도에 같은 문장이 있으면 그 의도 이름과 함께 제외한다(R-5 — 기존 서비스는 경고, 이 경로는 제외)', async () => {
      const res = await h.api<Any>('POST', `${BASE(bot)}/${analysisId}/apply/preview`, { json: { utteranceIds: [idOf('배송 관련해서 문의드립니다')], target: { kind: 'EXISTING', intentId } } });
      expect(res.body.included).toHaveLength(0);
      expect(res.body.excluded).toEqual([{ utteranceId: idOf('배송 관련해서 문의드립니다'), reason: 'DUPLICATE_IN_OTHER_INTENT', conflictIntentName: '배송 문의' }]);
    });

    it('반영 — 예문이 7건 늘고 학습 반영 서비스는 요청당 정확히 1회 · 자동 스냅샷 · 감사 · 표시(AC-DC5-1)', async () => {
      const spy = jest.spyOn(LearningApplyService.prototype, 'applyLearning');
      try {
        const res = await h.api<Any>('POST', `${BASE(bot)}/${analysisId}/apply`, { json: { utteranceIds: selected, target: { kind: 'EXISTING', intentId } } });
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ succeeded: 7, intentId, intentName: '환불 문의', created: false, appliedImmediately: true, draftOnly: false });
        expect(res.body.failed).toEqual([]);
        expect(res.body.excluded.map((e: Any) => e.reason).sort()).toEqual(['BANNED_WORD', 'DUPLICATE_IN_TARGET', 'TOO_LONG']);
        expect(res.body.autoSnapshot?.status).toBe('CREATED');

        expect(spy).toHaveBeenCalledTimes(1);
        expect(spy.mock.calls[0][0]).toMatchObject({ chatbotId: bot, reason: 'UTTERANCE_ANALYSIS_APPLY', resolvedCount: 7, intentIds: [intentId] });
      } finally {
        spy.mockRestore();
      }

      const examples = await intentExamples(intentId);
      expect(examples).toHaveLength(8);
      expect(examples).toEqual(expect.arrayContaining(topicSentences('환불')));
      // 금지어 마스킹 문장·201자 문장은 예문에 들어가지 않는다
      expect(examples.some((e) => e.includes('***') || e.length > 200)).toBe(false);

      const version = await h.prisma.chatbotVersion.findFirst({ where: { chatbotId: bot, trigger: 'BEFORE_UTTERANCE_APPLY' } });
      expect(version).not.toBeNull();

      const rows = await h.prisma.analyzedUtterance.findMany({ where: { id: { in: ordinaryIds } } });
      expect(rows.every((r) => r.appliedAt !== null && r.appliedIntentId === intentId && r.appliedIntentName === '환불 문의' && r.appliedByEmail?.includes('integration-test-admin'))).toBe(true);
      const analysis = await h.prisma.utteranceAnalysis.findUniqueOrThrow({ where: { id: analysisId } });
      expect(analysis.appliedCount).toBe(7);
      const clusterApplied = (await h.prisma.utteranceCluster.findMany({ where: { analysisId } })).reduce((s, c) => s + c.appliedCount, 0);
      expect(clusterApplied).toBe(7);

      // 표 필터 "반영 안 된 것만" · 표식
      const unapplied = await h.api<Any>('GET', `${BASE(bot)}/${analysisId}/utterances?unappliedOnly=true`);
      expect(unapplied.body.total).toBe(26 - 7);
      const appliedItem = (await h.api<Any>('GET', `${BASE(bot)}/${analysisId}/utterances?q=${encodeURIComponent('진행 상태')}`)).body.items[0];
      expect(appliedItem.applied).toMatchObject({ intentId, intentName: '환불 문의' });

      // 감사 — 분석 UPDATE + 의도 UPDATE(기존 감사 체인)
      const updates = await h.prisma.auditLog.findMany({ where: { action: 'UPDATE', targetType: 'UtteranceAnalysis', targetId: analysisId } });
      expect(updates).toHaveLength(1);
      expect(updates[0].summary).toBe('발화 묶음 분석 예문 반영(7건)');
      expect(updates[0].afterValue).toContain('"created":false');
      const intentAudit = await h.prisma.auditLog.findMany({ where: { action: 'UPDATE', targetType: 'Intent', targetId: intentId } });
      expect(intentAudit.some((a) => a.summary === '발화 묶음 분석 예문 반영 (7건)')).toBe(true);
    });

    it('이미 반영한 발화를 다시 넣으면 ALREADY_APPLIED로 제외되고 학습 반영 서비스는 호출되지 않는다(AC-DC5-4)', async () => {
      const spy = jest.spyOn(LearningApplyService.prototype, 'applyLearning');
      const before = await intentExamples(intentId);
      try {
        const res = await h.api<Any>('POST', `${BASE(bot)}/${analysisId}/apply`, { json: { utteranceIds: ordinaryIds, target: { kind: 'EXISTING', intentId } } });
        expect(res.status).toBe(200);
        expect(res.body.succeeded).toBe(0);
        expect(res.body.excluded.every((e: Any) => e.reason === 'ALREADY_APPLIED')).toBe(true);
        expect(res.body.excluded).toHaveLength(7);
        expect(spy).not.toHaveBeenCalled();
      } finally {
        spy.mockRestore();
      }
      expect(await intentExamples(intentId)).toEqual(before);
    });

    it('요청 검증 — 0건·51건·uuid 아님·알 수 없는 키·완료 전 분석은 거부한다', async () => {
      const target = { kind: 'EXISTING', intentId };
      expect((await h.api('POST', `${BASE(bot)}/${analysisId}/apply`, { json: { utteranceIds: [], target } })).status).toBe(400);
      expect((await h.api('POST', `${BASE(bot)}/${analysisId}/apply`, { json: { utteranceIds: Array.from({ length: 51 }, () => randomUUID()), target } })).status).toBe(400);
      expect((await h.api('POST', `${BASE(bot)}/${analysisId}/apply`, { json: { utteranceIds: ['not-a-uuid'], target } })).status).toBe(400);
      expect((await h.api('POST', `${BASE(bot)}/${analysisId}/apply`, { json: { utteranceIds: [randomUUID()], target, extra: true } })).status).toBe(400);
      expect((await h.api('POST', `${BASE(bot)}/${analysisId}/apply/preview`, { json: { utteranceIds: [randomUUID()], target: { kind: 'NEW', intentName: '' } } })).status).toBe(400);
      // 없는 발화 id = NOT_FOUND 사유로 제외(오류 아님)
      const missing = await h.api<Any>('POST', `${BASE(bot)}/${analysisId}/apply/preview`, { json: { utteranceIds: [randomUUID()], target } });
      expect(missing.status).toBe(200);
      expect(missing.body.excluded[0].reason).toBe('NOT_FOUND');
      // 없는 의도 = 404(EX-DC-10) · 다른 챗봇의 의도도 404
      const otherBot = await h.createChatbot('다른 반영봇');
      const foreignIntent = await createIntent(otherBot, '남의 의도', ['남의 예문입니다']);
      for (const missingIntent of [randomUUID(), foreignIntent]) {
        const res = await h.api<Any>('POST', `${BASE(bot)}/${analysisId}/apply`, { json: { utteranceIds: [idOf(topicSentences('배송')[0])], target: { kind: 'EXISTING', intentId: missingIntent } } });
        expect({ status: res.status, code: res.body.code }).toEqual({ status: 404, code: 'NOT_FOUND' });
      }
      // 완료 전(실패) 분석은 반영 불가
      h.embedding.setFailing(true);
      let failed: Any;
      try {
        const started = await h.startAnalysis(bot, { name: 'f.csv', content: buildCsvFile(topicSentences('배송').map((s) => [s])) }, { minClusterSize: 3, targetClusterCount: 2 });
        failed = await h.waitForTerminal(bot, started.body.analysisId);
      } finally {
        h.embedding.setFailing(false);
      }
      expect(failed.status).toBe('FAILED');
      const notReady = await h.api<Any>('POST', `${BASE(bot)}/${failed.id}/apply`, { json: { utteranceIds: [randomUUID()], target } });
      expect({ status: notReady.status, code: notReady.body.code }).toEqual({ status: 409, code: 'INVALID_STATUS_TRANSITION' });
    }, 60_000);

    it('새 의도 생성(NEW) — 공통(토픽 없음)으로 만들어지고 두 번째 요청은 같은 이름 의도에 넣는다(EXISTING_BY_NAME)', async () => {
      const first = topicSentences('배송').slice(0, 3);
      const spy = jest.spyOn(LearningApplyService.prototype, 'applyLearning');
      let created: Any;
      try {
        created = await h.api<Any>('POST', `${BASE(bot)}/${analysisId}/apply`, { json: { utteranceIds: first.map(idOf), target: { kind: 'NEW', intentName: '  신규 배송 의도  ' } } });
        expect(created.status).toBe(200);
        expect(spy).toHaveBeenCalledTimes(1); // 새 의도 1건 + 예문 3건이어도 무효화 요청은 1회
      } finally {
        spy.mockRestore();
      }
      expect(created.body).toMatchObject({ succeeded: 3, created: true, intentName: '신규 배송 의도' });
      const intent = await h.prisma.intent.findFirstOrThrow({ where: { chatbotId: bot, name: '신규 배송 의도' } });
      expect(intent.topicId).toBeNull();
      expect(await intentExamples(intent.id)).toHaveLength(3);
      // 첫 호출이 만든 의도에 나머지 예문이 모인다(중복 생성 0)
      expect(await h.prisma.intent.count({ where: { chatbotId: bot, name: '신규 배송 의도' } })).toBe(1);

      const rest = topicSentences('배송').slice(4, 6); // 3번(관련해서 문의드립니다)은 '배송 문의' 의도에 이미 있어 제외 대상이다
      const preview = await h.api<Any>('POST', `${BASE(bot)}/${analysisId}/apply/preview`, { json: { utteranceIds: rest.map(idOf), target: { kind: 'NEW', intentName: '신규 배송 의도' } } });
      expect(preview.body.target).toMatchObject({ resolution: 'EXISTING_BY_NAME', intentId: intent.id });
      const second = await h.api<Any>('POST', `${BASE(bot)}/${analysisId}/apply`, { json: { utteranceIds: rest.map(idOf), target: { kind: 'NEW', intentName: '신규 배송 의도' } } });
      expect(second.body).toMatchObject({ succeeded: 2, created: false, intentId: intent.id });
      expect(await intentExamples(intent.id)).toHaveLength(5);
    });

    it('부분 성공 — 한 건이 실패해도 나머지는 들어가고 실패는 코드와 함께 알린다 · 학습 반영은 1회', async () => {
      const rest = topicSentences('로그인').slice(0, 3);
      const target = await createIntent(bot, '부분 성공 의도', ['기존 예문 하나']);
      const original = IntentsService.prototype.applyLearningExample;
      let calls = 0;
      const failing = jest.spyOn(IntentsService.prototype, 'applyLearningExample').mockImplementation(async function (this: IntentsService, ...args: Parameters<typeof original>) {
        calls += 1;
        if (calls === 2) throw new ApiException('LIMIT_EXCEEDED', 400, '예문은 최대 500개까지 등록할 수 있습니다(현재 500개).');
        return original.apply(this, args);
      });
      const learning = jest.spyOn(LearningApplyService.prototype, 'applyLearning');
      let failedUtteranceId = '';
      try {
        const res = await h.api<Any>('POST', `${BASE(bot)}/${analysisId}/apply`, { json: { utteranceIds: rest.map(idOf), target: { kind: 'EXISTING', intentId: target } } });
        expect(res.status).toBe(200);
        failedUtteranceId = res.body.failed[0]?.utteranceId;
        expect(res.body.succeeded).toBe(2);
        expect(res.body.failed).toHaveLength(1);
        expect(res.body.failed[0]).toMatchObject({ code: 'LIMIT_EXCEEDED' });
        expect(res.body.failed[0].message).not.toContain('배송');
        expect(learning).toHaveBeenCalledTimes(1);
        expect(learning.mock.calls[0][0]).toMatchObject({ resolvedCount: 2 });
      } finally {
        failing.mockRestore();
        learning.mockRestore();
      }
      expect(await intentExamples(target)).toHaveLength(1 + 2);
      // 실패한 발화는 반영 표시가 없다(다시 시도할 수 있다)
      const failedRow = await h.prisma.analyzedUtterance.findUniqueOrThrow({ where: { id: failedUtteranceId } });
      expect(failedRow.appliedAt).toBeNull();
      expect(rest.map(idOf)).toContain(failedUtteranceId);
    });

    it('동시에 같은 발화를 반영해도 예문은 하나뿐이고 발화는 한 번만 성공으로 센다(EX-DC 동시 반영)', async () => {
      const target = await createIntent(bot, '동시 반영 의도', ['기존 예문 둘']);
      const out = await analyze(bot, [...topicSentences('결제'), ...topicSentences('로그인')], { targetClusterCount: 2, minClusterSize: 5 });
      const pick = topicSentences('결제').slice(0, 4).map(out.idOf);
      const body = { utteranceIds: pick, target: { kind: 'EXISTING', intentId: target } };
      const [a, b] = await Promise.all([h.api<Any>('POST', `${BASE(bot)}/${out.analysis.id}/apply`, { json: body }), h.api<Any>('POST', `${BASE(bot)}/${out.analysis.id}/apply`, { json: body })]);
      expect(a.status).toBe(200);
      expect(b.status).toBe(200);
      expect(a.body.succeeded + b.body.succeeded).toBe(4);
      expect(await intentExamples(target)).toHaveLength(1 + 4);
      const rows = await h.prisma.analyzedUtterance.findMany({ where: { id: { in: pick } } });
      expect(rows.every((r) => r.appliedAt !== null)).toBe(true);
      expect((await h.prisma.utteranceAnalysis.findUniqueOrThrow({ where: { id: out.analysis.id } })).appliedCount).toBe(4);
    });

    it('보관된 챗봇은 조회만 되고 반영·요청·수정·취소·삭제는 409 CHATBOT_ARCHIVED(EX-DC-9)', async () => {
      const archivedBot = await h.createChatbot('보관 시험봇');
      const iid = await createIntent(archivedBot, '보관 의도', ['보관 예문입니다']);
      const out = await analyze(archivedBot, [...topicSentences('환불'), ...topicSentences('배송')], { targetClusterCount: 2, minClusterSize: 5 });
      const archive = await h.api('DELETE', `/chatbots/${archivedBot}`);
      expect(archive.status).toBe(204);

      expect((await h.api('GET', `${BASE(archivedBot)}/${out.analysis.id}`)).status).toBe(200);
      expect((await h.api('GET', `${BASE(archivedBot)}/${out.analysis.id}/export`)).status).toBe(200);
      expect((await h.api('GET', `${BASE(archivedBot)}/${out.analysis.id}/utterances`)).status).toBe(200);
      const writes: Array<[string, string, Any | undefined]> = [
        ['POST', `${BASE(archivedBot)}/${out.analysis.id}/apply`, { utteranceIds: [out.idOf(topicSentences('환불')[0])], target: { kind: 'EXISTING', intentId: iid } }],
        ['POST', `${BASE(archivedBot)}/${out.analysis.id}/apply/preview`, { utteranceIds: [out.idOf(topicSentences('환불')[0])], target: { kind: 'EXISTING', intentId: iid } }],
        ['PATCH', `${BASE(archivedBot)}/${out.analysis.id}/clusters/${out.analysis.clusters[0].id}`, { customName: '이름' }],
        ['POST', `${BASE(archivedBot)}/${out.analysis.id}/cancel`, undefined],
        ['DELETE', `${BASE(archivedBot)}/${out.analysis.id}`, undefined],
      ];
      for (const [method, path, json] of writes) {
        const res = await h.api<Any>(method, path, json ? { json } : {});
        expect({ path, status: res.status, code: res.body.code }).toEqual({ path, status: 409, code: 'CHATBOT_ARCHIVED' });
      }
      const create = await h.startAnalysis(archivedBot, { name: 'a.csv', content: buildCsvFile(topicSentences('환불').map((s) => [s])) }, {});
      expect({ status: create.status, code: (create.body as Any).code }).toEqual({ status: 409, code: 'CHATBOT_ARCHIVED' });
      expect(await h.prisma.analyzedUtterance.count({ where: { analysisId: out.analysis.id, appliedAt: { not: null } } })).toBe(0);
    });

    it('조회·다운로드만으로는 자산 행과 updatedAt이 바뀌지 않는다(AC-DC5-2)', async () => {
      const snapshot = async () => ({
        intents: (await h.prisma.intent.findMany({ where: { chatbotId: bot }, orderBy: { id: 'asc' }, select: { id: true, updatedAt: true, examples: true } })).map((r) => ({ ...r, updatedAt: r.updatedAt.getTime() })),
        keywords: await h.prisma.keyword.count({ where: { chatbotId: bot } }),
        faqs: await h.prisma.faqEntry.count({ where: { chatbotId: bot } }),
        nodes: await h.prisma.dialogNode.count({ where: { chatbotId: bot } }),
      });
      const before = await snapshot();
      await h.api('GET', `${BASE(bot)}/${analysisId}`);
      await h.api('GET', `${BASE(bot)}/${analysisId}/utterances`);
      await h.api('GET', `${BASE(bot)}/${analysisId}/export`);
      await h.api('POST', `${BASE(bot)}/${analysisId}/apply/preview`, { json: { utteranceIds: [randomUUID()], target: { kind: 'EXISTING', intentId } } });
      expect(await snapshot()).toEqual(before);
    });
  });

  describe('환경 모드(AC-DC4-3 · AC-DC5-5)', () => {
    let bot: string;
    let intentId: string;
    let prodVersionId: string;
    const FAQ_PROD = '환불 신청은 어떻게 하나요';
    const FAQ_DRAFT = '배송 조회는 어디서 하나요';

    beforeAll(async () => {
      bot = await h.createChatbot('환경 시험봇');
      intentId = await createIntent(bot, '환불 문의', ['환불 문의 예문 하나']);
      expect((await h.api('POST', `/chatbots/${bot}/faqs`, { json: { category: 'FAQ', question: FAQ_PROD, answer: '마이페이지에서 신청합니다.' } })).status).toBe(201);
      const preview = await h.api<Any>('POST', `/chatbots/${bot}/environment/enable/preview`);
      const enable = await h.api<Any>('POST', `/chatbots/${bot}/environment/enable`, { json: { expectedDraftHash: preview.body.draftContentHash } });
      expect([200, 201]).toContain(enable.status);
      prodVersionId = (await h.prisma.chatbot.findUniqueOrThrow({ where: { id: bot } })).prodVersionId as string;
      expect(prodVersionId).toBeTruthy();
      // 운영 전환 이후 초안에만 FAQ 하나를 더한다
      expect((await h.api('POST', `/chatbots/${bot}/faqs`, { json: { category: 'FAQ', question: FAQ_DRAFT, answer: '주문 내역에서 확인합니다.' } })).status).toBe(201);
    }, 60_000);

    it('capability가 환경 모드를 알리고, "운영 중" 대조는 운영 버전 번들로 · "초안" 대조는 라이브 번들로 판정한다', async () => {
      const cap = await h.api<Any>('GET', `${BASE(bot)}/capability`);
      expect(cap.body.envModeEnabled).toBe(true);
      const filler = [...topicSentences('로그인').slice(0, 5), ...topicSentences('결제').slice(0, 5)];
      const utterances = [FAQ_PROD, FAQ_DRAFT, ...filler];
      const conditions = (target: string) => ({ targetClusterCount: 2, minClusterSize: 2, probe: { enabled: true, target, scoreThreshold: null } });

      const serving = await analyze(bot, utterances, conditions('SERVING'));
      expect(serving.analysis.probe).toMatchObject({ status: 'DONE', targetKind: 'PROD', versionNo: expect.any(Number) });
      const versionRow = await h.prisma.chatbotVersion.findUniqueOrThrow({ where: { id: prodVersionId } });
      expect(serving.analysis.probe.versionNo).toBe(versionRow.versionNo);
      const rowServing = await h.prisma.utteranceAnalysis.findUniqueOrThrow({ where: { id: serving.analysis.id } });
      expect(rowServing).toMatchObject({ probeVersionId: prodVersionId, probeContentHash: versionRow.contentHash, probeTargetKind: 'PROD' });
      const servingItems = (await h.api<Any>('GET', `${BASE(bot)}/${serving.analysis.id}/utterances?pageSize=100`)).body.items as Any[];
      expect(servingItems.find((u) => u.text === FAQ_PROD)?.probe).toMatchObject({ answered: true, matchKind: 'FAQ' });
      expect(servingItems.find((u) => u.text === FAQ_DRAFT)?.probe).toMatchObject({ answered: false });

      const draft = await analyze(bot, utterances, conditions('DRAFT'));
      expect(draft.analysis.probe).toMatchObject({ status: 'DONE', targetKind: 'LIVE', versionNo: null });
      const draftItems = (await h.api<Any>('GET', `${BASE(bot)}/${draft.analysis.id}/utterances?pageSize=100`)).body.items as Any[];
      expect(draftItems.find((u) => u.text === FAQ_DRAFT)?.probe).toMatchObject({ answered: true, matchKind: 'FAQ' });
    }, 60_000);

    it('반영은 초안에만 들어가고 운영 버전은 바뀌지 않는다 · draftOnly=true(AC-DC5-5)', async () => {
      const out = await analyze(bot, [...topicSentences('환불'), ...topicSentences('배송')], { targetClusterCount: 2, minClusterSize: 5 });
      const versionBefore = await h.prisma.chatbotVersion.findUniqueOrThrow({ where: { id: prodVersionId } });
      const pick = topicSentences('환불').slice(1, 4).map(out.idOf);
      const preview = await h.api<Any>('POST', `${BASE(bot)}/${out.analysis.id}/apply/preview`, { json: { utteranceIds: pick, target: { kind: 'EXISTING', intentId } } });
      expect(preview.body.draftOnly).toBe(true);
      const res = await h.api<Any>('POST', `${BASE(bot)}/${out.analysis.id}/apply`, { json: { utteranceIds: pick, target: { kind: 'EXISTING', intentId } } });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ succeeded: 3, draftOnly: true });
      expect(await intentExamples(intentId)).toHaveLength(1 + 3); // 초안(라이브) 의도에는 들어간다
      // 운영 버전 본문·해시·포인터는 그대로다
      const versionAfter = await h.prisma.chatbotVersion.findUniqueOrThrow({ where: { id: prodVersionId } });
      expect(versionAfter.contentHash).toBe(versionBefore.contentHash);
      expect((await h.prisma.chatbot.findUniqueOrThrow({ where: { id: bot } })).prodVersionId).toBe(prodVersionId);
      // 운영 번들로 다시 대조해도 방금 넣은 예문은 아직 운영에 없다(스테이징 승격 · 운영 전환을 거쳐야 한다)
      const { VersionBundleService } = await import('../environment/serving/version-bundle.service');
      const served = await h.moduleRef.get(VersionBundleService).get(bot, prodVersionId, { topics: 'ACTIVE_ONLY' });
      const prodIntent = served.bundle.intents.find((i) => i.id === intentId);
      expect(prodIntent?.examples).toEqual(['환불 문의 예문 하나']);
    }, 60_000);
  });
});
