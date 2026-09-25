import { UnansweredQuestionsService } from './unanswered-questions.service';

/**
 * [신규 No.40 — §15.1/15.2] 학습 큐 "운영 미반영"(prodReflection) · 상세 "초안에서 삭제됨"
 * (deletedInDraft/nameFromVersion) 단위 시험. 수집기(§15.1 "봉인 — F-9 3파일 집합 불변")는
 * 건드리지 않는다 — 표시 단계 판정만 검증한다.
 */
function baseRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'q-1',
    chatbotId: 'bot-1',
    questionText: '배송 조회',
    questionNormalized: '배송조회',
    variants: '[]',
    occurredCount: 1,
    lastOccurredAt: new Date('2026-01-05T00:00:00Z'),
    status: 'PENDING',
    recurredCount: 0,
    recurredAfterAt: null,
    source: 'UNANSWERED',
    channelType: null,
    resolvedIntentId: null,
    resolvedAt: null,
    resolvedById: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    lastFeedbackLogId: null,
    ...overrides,
  };
}

function makeDeps() {
  const prisma = {
    unansweredQuestion: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      findFirst: jest.fn(),
      findUnique: jest.fn().mockResolvedValue(null), // counterpart 조회 기본값
      updateMany: jest.fn(),
    },
    intent: { findMany: jest.fn().mockResolvedValue([]) },
    conversationLog: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn(), groupBy: jest.fn().mockResolvedValue([]) },
    faqEntry: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn().mockResolvedValue(null) },
    dialogNode: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn().mockResolvedValue(null) },
    messageFeedback: { groupBy: jest.fn().mockResolvedValue([]) },
  };
  const scope = { assertReadable: jest.fn(), assertWritable: jest.fn() };
  const intentsService = {};
  const learningApply = {};
  const config = { get: jest.fn().mockReturnValue(undefined) };
  const classifierPredict = { predictBatch: jest.fn().mockResolvedValue(null) };
  const versionCapture = {};
  const environmentRead = { getProdHistoryDesc: jest.fn().mockResolvedValue([]) };
  const versionBundles = { getCore: jest.fn(), get: jest.fn(), warm: jest.fn() };

  const service = new UnansweredQuestionsService(
    prisma as never,
    scope as never,
    intentsService as never,
    learningApply as never,
    config as never,
    classifierPredict as never,
    versionCapture as never,
    environmentRead as never,
    versionBundles as never,
  );
  return { service, prisma, scope, environmentRead, versionBundles, classifierPredict };
}

const BASE_QUERY = {
  page: 1,
  pageSize: 20,
  status: ['PENDING', 'RESOLVED'] as ('PENDING' | 'RESOLVED' | 'IGNORED')[],
  recurredOnly: false,
  sort: 'occurredCount' as const,
  order: 'desc' as const,
};

describe('UnansweredQuestionsService — 목록 prodReflection(§15.1)', () => {
  it('모드 꺼짐이면 PROD 이력을 조회하지 않고 모든 행에 prodReflection을 싣지 않는다', async () => {
    const { service, prisma, scope, environmentRead } = makeDeps();
    scope.assertReadable.mockResolvedValue({ prodVersionId: null });
    prisma.unansweredQuestion.findMany.mockResolvedValue([
      baseRow({ id: 'r-1', status: 'RESOLVED', resolvedAt: new Date('2026-01-02T00:00:00Z') }),
    ]);
    prisma.unansweredQuestion.count.mockResolvedValue(1);

    const result = await service.list('bot-1', BASE_QUERY);

    expect(environmentRead.getProdHistoryDesc).not.toHaveBeenCalled();
    expect(result.items[0].prodReflection).toBeUndefined();
  });

  it('모드 켜짐 + RESOLVED 행이 있으면 PROD 이력 1쿼리로 judgeProdReflection 결과를 싣는다(PENDING 행은 제외)', async () => {
    const { service, prisma, scope, environmentRead } = makeDeps();
    scope.assertReadable.mockResolvedValue({ prodVersionId: 'v-current' });
    // resolvedAt(2026-01-10) 시점에 아직 운영이 그 이전 버전이었다 — PENDING_SWITCH(운영 미반영).
    environmentRead.getProdHistoryDesc.mockResolvedValue([
      { id: 'log-2', fromVersionId: 'v-1', toVersionId: 'v-current', toVersionCapturedAt: new Date('2026-01-05T00:00:00Z'), createdAt: new Date('2026-01-06T00:00:00Z') },
    ]);
    prisma.unansweredQuestion.findMany.mockResolvedValue([
      baseRow({ id: 'r-pending', status: 'PENDING' }),
      baseRow({ id: 'r-resolved', status: 'RESOLVED', resolvedAt: new Date('2026-01-10T00:00:00Z') }),
    ]);
    prisma.unansweredQuestion.count.mockResolvedValue(2);

    const result = await service.list('bot-1', BASE_QUERY);

    expect(environmentRead.getProdHistoryDesc).toHaveBeenCalledTimes(1);
    const pending = result.items.find((i) => i.id === 'r-pending');
    const resolved = result.items.find((i) => i.id === 'r-resolved');
    expect(pending?.prodReflection).toBeUndefined();
    // toVersionCapturedAt(01-05) < resolvedAt(01-10) → 아직 반영되지 않았다.
    expect(resolved?.prodReflection).toEqual({ status: 'PENDING_SWITCH' });
  });

  it('모드 켜짐 + toVersionCapturedAt ≥ resolvedAt이면 REFLECTED와 reflectedAt을 싣는다', async () => {
    const { service, prisma, scope, environmentRead } = makeDeps();
    scope.assertReadable.mockResolvedValue({ prodVersionId: 'v-current' });
    environmentRead.getProdHistoryDesc.mockResolvedValue([
      { id: 'log-2', fromVersionId: 'v-1', toVersionId: 'v-current', toVersionCapturedAt: new Date('2026-01-12T00:00:00Z'), createdAt: new Date('2026-01-12T00:00:00Z') },
    ]);
    prisma.unansweredQuestion.findMany.mockResolvedValue([
      baseRow({ id: 'r-resolved', status: 'RESOLVED', resolvedAt: new Date('2026-01-10T00:00:00Z') }),
    ]);
    prisma.unansweredQuestion.count.mockResolvedValue(1);

    const result = await service.list('bot-1', BASE_QUERY);

    expect(result.items[0].prodReflection).toEqual({ status: 'REFLECTED', reflectedAt: new Date('2026-01-12T00:00:00Z') });
  });
});

describe('UnansweredQuestionsService — 상세 "초안에서 삭제됨"(§15.2)', () => {
  it('초안에서 대상 이름을 못 찾고 servedVersionId가 있으면 버전 코어에서 이름을 찾아 deletedInDraft·nameFromVersion을 싣는다', async () => {
    const { service, prisma, scope, versionBundles } = makeDeps();
    scope.assertReadable.mockResolvedValue({ prodVersionId: 'v-current' });
    const row = baseRow({ id: 'r-1', status: 'PENDING', source: 'NEGATIVE_FEEDBACK', lastFeedbackLogId: 'log-1' });
    prisma.unansweredQuestion.findFirst.mockResolvedValue(row);
    prisma.conversationLog.findUnique.mockResolvedValue({
      botResponse: '안내드립니다',
      createdAt: new Date('2026-01-08T00:00:00Z'),
      isAnswered: true,
      apiNotice: false,
      answeredByRag: false,
      matchedNodeId: 'node-1',
      matchedFaqId: null,
      matchedIntentId: null,
      servedVersionId: 'v-9',
    });
    prisma.dialogNode.findUnique.mockResolvedValue(null); // 초안에 없음(삭제됨)
    versionBundles.getCore.mockResolvedValue({
      bundle: { dialogNodes: [{ id: 'node-1', name: '예전 배송 안내 노드' }], faqs: [], intents: [] },
    });

    const detail = await service.detail('bot-1', 'r-1');

    expect(versionBundles.getCore).toHaveBeenCalledWith('v-9', 'bot-1');
    expect(detail.lastFeedback?.target).toMatchObject({
      kind: 'NODE',
      deleted: true,
      deletedInDraft: true,
      nameFromVersion: '예전 배송 안내 노드',
    });
  });

  it('servedVersionId가 없으면 버전 코어를 조회하지 않고 기존 "삭제됨"만 유지한다', async () => {
    const { service, prisma, versionBundles, scope } = makeDeps();
    scope.assertReadable.mockResolvedValue({ prodVersionId: 'v-current' });
    const row = baseRow({ id: 'r-2', status: 'PENDING', source: 'NEGATIVE_FEEDBACK', lastFeedbackLogId: 'log-2' });
    prisma.unansweredQuestion.findFirst.mockResolvedValue(row);
    prisma.conversationLog.findUnique.mockResolvedValue({
      botResponse: '안내드립니다',
      createdAt: new Date('2026-01-08T00:00:00Z'),
      isAnswered: true,
      apiNotice: false,
      answeredByRag: false,
      matchedNodeId: 'node-2',
      matchedFaqId: null,
      matchedIntentId: null,
      servedVersionId: null, // 모드 꺼짐 상태에서 서빙된 턴 — 버전 정보 없음
    });
    prisma.dialogNode.findUnique.mockResolvedValue(null);

    const detail = await service.detail('bot-1', 'r-2');

    expect(versionBundles.getCore).not.toHaveBeenCalled();
    expect(detail.lastFeedback?.target).toMatchObject({ kind: 'NODE', deleted: true });
    expect(detail.lastFeedback?.target.deletedInDraft).toBeUndefined();
  });
});
