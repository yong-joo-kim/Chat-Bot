import { buildDialogueIndex } from '@chat-bot/dialogue-engine';
import type { ChatbotAnswerSetting, DialogOutput, DialogueBundle } from '@chat-bot/shared-types';
import { UtteranceProbeService } from './utterance-probe.service';
import { AnalysisCancelledError } from './analysis-cancelled.error';

/**
 * 챗봇 대조 서비스 단위 시험(설계서 §9) — 서비스 통합 시험이 다루지 못하는 경계: API 노드는 외부 호출 없이 "매칭된
 * 노드를 답한 것으로 본다"(R-21) · 운영 버전을 못 읽으면 대조만 실패(R-20) · 취소 관측 · 결정론.
 */

const NOW = new Date('2026-09-30T00:00:00Z');
const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function setting(over: Partial<ChatbotAnswerSetting> = {}): ChatbotAnswerSetting {
  return {
    chatbotId: ID(1),
    semanticEnabled: false,
    acceptThreshold: 0.8,
    lowThreshold: 0.6,
    marginThreshold: 0.05,
    ragEnabled: false,
    ragCompany: null,
    ragCategory: null,
    ragSubcategory: null,
    ragSimilarityThreshold: null,
    fallbackPolicy: 'RAG_FIRST',
    showSources: true,
    ragTimeoutMs: 120_000,
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  } as ChatbotAnswerSetting;
}

function textOutput(text: string): DialogOutput {
  return { type: 'TEXT', payload: { text } } as DialogOutput;
}

function bundleWithApiNode(): DialogueBundle {
  const keyword = { id: ID(10), chatbotId: ID(1), name: '주문조회', synonyms: [], createdAt: NOW, updatedAt: NOW };
  const apiOutput = {
    type: 'API_CONDITION',
    payload: { version: 2, connectionId: ID(20), method: 'GET', path: '/orders/1', pathParams: [], query: [], body: [], responseMappings: [], conditions: [] },
  } as unknown as DialogOutput;
  const apiNode = { id: ID(30), chatbotId: ID(1), name: '주문 조회 노드', nodeType: 'NORMAL', matchMode: 'ANY', enabled: true, priority: 100, intentIds: [], keywordIds: [ID(10)], outputs: [apiOutput], createdAt: NOW, updatedAt: NOW };
  const textNode = { id: ID(31), chatbotId: ID(1), name: '환불 노드', nodeType: 'NORMAL', matchMode: 'ANY', enabled: true, priority: 100, intentIds: [], keywordIds: [ID(11)], outputs: [textOutput('환불 안내')], createdAt: NOW, updatedAt: NOW };
  const refundKeyword = { id: ID(11), chatbotId: ID(1), name: '환불', synonyms: [], createdAt: NOW, updatedAt: NOW };
  return { intents: [], keywords: [keyword, refundKeyword], homonyms: [], dialogNodes: [apiNode, textNode], contexts: [], faqs: [] } as unknown as DialogueBundle;
}

function build(opts: { bundle?: DialogueBundle; prodVersionId?: string | null; versionsGet?: jest.Mock; settings?: ChatbotAnswerSetting } = {}) {
  const bundle = opts.bundle ?? bundleWithApiNode();
  const prisma = { chatbot: { findUnique: jest.fn().mockResolvedValue({ prodVersionId: opts.prodVersionId ?? null }) } };
  const bundleService = { getCached: jest.fn().mockResolvedValue({ bundle, index: buildDialogueIndex(bundle) }) };
  const answerSettings = { get: jest.fn().mockResolvedValue(opts.settings ?? setting()) };
  const vectorCache = { get: jest.fn().mockResolvedValue({ entries: [] }) };
  const versions = { get: opts.versionsGet ?? jest.fn() };
  const config = { get: jest.fn().mockReturnValue(undefined) };
  const service = new UtteranceProbeService(prisma as never, bundleService as never, answerSettings as never, vectorCache as never, versions as never, config as never);
  return { service, prisma, bundleService, versions };
}

const vec = new Float32Array([1, 0, 0]);
const items = (texts: string[]) => texts.map((text) => ({ text, vector: vec }));

describe('UtteranceProbeService — 챗봇 대조(설계서 §9)', () => {
  it('API 노드가 매칭되면 외부 호출 없이 매칭된 노드를 답한 것으로 본다(R-21)', async () => {
    const { service } = build();
    const out = await service.probe({ chatbotId: ID(1), target: 'SERVING', scoreThreshold: null, modelId: 'm', items: items(['주문조회 부탁드려요']), now: NOW, isCancelled: () => false });
    expect(out.status).toBe('DONE');
    if (out.status !== 'DONE') return;
    expect(out.items[0]).toMatchObject({ answered: true, matchKind: 'NODE', matchId: ID(30), matchName: '주문 조회 노드', learningCandidate: false });
  });

  it('일반 노드 매칭은 답함 · 매칭 없음은 답하지 못함(학습 후보)', async () => {
    const { service } = build();
    const out = await service.probe({ chatbotId: ID(1), target: 'SERVING', scoreThreshold: null, modelId: 'm', items: items(['환불 문의합니다', '오늘 날씨 어때요']), now: NOW, isCancelled: () => false });
    if (out.status !== 'DONE') throw new Error('DONE 기대');
    expect(out.items[0]).toMatchObject({ answered: true, matchKind: 'NODE', matchName: '환불 노드', band: 'SKIPPED', score: null });
    expect(out.items[1]).toMatchObject({ answered: false, matchKind: null, learningCandidate: true });
    expect(out.threshold).toBe(0.8);
  });

  it('같은 입력·같은 now는 결과가 같다(결정론)', async () => {
    const { service } = build();
    const run = () => service.probe({ chatbotId: ID(1), target: 'SERVING', scoreThreshold: 0.5, modelId: 'm', items: items(['환불 문의', '주문조회', '무관한 말']), now: NOW, isCancelled: () => false });
    expect(await run()).toEqual(await run());
    const out = await run();
    if (out.status === 'DONE') expect(out.threshold).toBe(0.5);
  });

  it('운영 버전을 읽지 못하면 대조만 실패한다 — 초안으로 대체하지 않는다(R-20)', async () => {
    const versionsGet = jest.fn().mockRejectedValue(new Error('버전 손상'));
    const { service, bundleService } = build({ prodVersionId: ID(99), versionsGet });
    const out = await service.probe({ chatbotId: ID(1), target: 'SERVING', scoreThreshold: null, modelId: 'm', items: items(['환불 문의']), now: NOW, isCancelled: () => false });
    expect(out).toMatchObject({ status: 'FAILED', failureReason: 'TARGET_VERSION_UNREADABLE', targetKind: 'PROD', versionId: ID(99) });
    expect(bundleService.getCached).not.toHaveBeenCalled(); // 라이브 번들로 조용히 바꾸지 않는다
  });

  it('DRAFT를 고르면 환경 모드가 켜져 있어도 라이브 번들을 쓴다', async () => {
    const versionsGet = jest.fn();
    const { service, bundleService } = build({ prodVersionId: ID(99), versionsGet });
    const out = await service.probe({ chatbotId: ID(1), target: 'DRAFT', scoreThreshold: null, modelId: 'm', items: items(['환불 문의']), now: NOW, isCancelled: () => false });
    expect(out.status).toBe('DONE');
    expect(out.targetKind).toBe('LIVE');
    expect(versionsGet).not.toHaveBeenCalled();
    expect(bundleService.getCached).toHaveBeenCalledTimes(1);
  });

  it('SERVING + 환경 모드는 운영 버전 번들과 버전 정보를 기록한다', async () => {
    const bundle = bundleWithApiNode();
    const versionsGet = jest.fn().mockResolvedValue({
      bundle,
      index: buildDialogueIndex(bundle),
      settings: setting(),
      semanticSource: undefined,
      version: { id: ID(99), versionNo: 7, contentHash: 'abc' },
    });
    const { service } = build({ prodVersionId: ID(99), versionsGet });
    const out = await service.probe({ chatbotId: ID(1), target: 'SERVING', scoreThreshold: null, modelId: 'm', items: items(['환불 문의']), now: NOW, isCancelled: () => false });
    expect(out).toMatchObject({ status: 'DONE', targetKind: 'PROD', versionId: ID(99), versionNo: 7, contentHash: 'abc' });
    expect(versionsGet).toHaveBeenCalledWith(ID(1), ID(99), { topics: 'ACTIVE_ONLY' });
  });

  it('취소가 관측되면 AnalysisCancelledError(50문장 조각 경계)', async () => {
    const { service } = build();
    let calls = 0;
    const many = items(Array.from({ length: 120 }, (_, i) => `무관한 문장 ${i}`));
    await expect(
      service.probe({ chatbotId: ID(1), target: 'SERVING', scoreThreshold: null, modelId: 'm', items: many, now: NOW, isCancelled: () => (calls += 1) >= 2 }),
    ).rejects.toBeInstanceOf(AnalysisCancelledError);
  });

  it('긴 입력에서도 조각(50문장)마다 이벤트 루프에 양보하며 진행률을 알린다', async () => {
    const { service } = build();
    const progress: number[] = [];
    const many = items(Array.from({ length: 120 }, (_, i) => `무관한 문장 ${i}`));
    const out = await service.probe({ chatbotId: ID(1), target: 'SERVING', scoreThreshold: null, modelId: 'm', items: many, now: NOW, isCancelled: () => false, onProgress: (f) => progress.push(f) });
    expect(out.status).toBe('DONE');
    expect(progress).toEqual([50 / 120, 100 / 120]);
  });
});
