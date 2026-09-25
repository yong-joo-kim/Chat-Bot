import { DialogueBundleService } from './dialogue-bundle.service';

/**
 * K-1(topic-system-설계.md §12) — 번들 조회 결정적 정렬 단위 시험. 7개 `findMany` 호출 인자에
 * 같은 `orderBy`가 있음을 Prisma 목으로 단언한다(tx·비tx 두 경로).
 */
function emptyFindManyMock() {
  return jest.fn().mockResolvedValue([]);
}

function buildPrismaMock() {
  return {
    intent: { findMany: emptyFindManyMock() },
    keyword: { findMany: emptyFindManyMock() },
    homonymDictionary: { findMany: emptyFindManyMock() },
    dialogNode: { findMany: emptyFindManyMock() },
    contextVariable: { findMany: emptyFindManyMock() },
    faqEntry: { findMany: emptyFindManyMock() },
    survey: { findMany: emptyFindManyMock() },
    topic: { findMany: emptyFindManyMock() },
  };
}

const EXPECTED_ORDER_BY = [{ createdAt: 'asc' }, { id: 'asc' }];

describe('K-1: DialogueBundleService.build() 결정적 정렬', () => {
  it('비tx 경로(Promise.all) — 7개 findMany 모두 orderBy: [{createdAt:asc},{id:asc}]로 호출된다', async () => {
    const prisma = buildPrismaMock();
    const service = new DialogueBundleService(prisma as never);
    await service.build('chatbot-1');

    expect(prisma.intent.findMany).toHaveBeenCalledWith(expect.objectContaining({ orderBy: EXPECTED_ORDER_BY }));
    expect(prisma.keyword.findMany).toHaveBeenCalledWith(expect.objectContaining({ orderBy: EXPECTED_ORDER_BY }));
    expect(prisma.homonymDictionary.findMany).toHaveBeenCalledWith(expect.objectContaining({ orderBy: EXPECTED_ORDER_BY }));
    expect(prisma.dialogNode.findMany).toHaveBeenCalledWith(expect.objectContaining({ orderBy: EXPECTED_ORDER_BY }));
    expect(prisma.contextVariable.findMany).toHaveBeenCalledWith(expect.objectContaining({ orderBy: EXPECTED_ORDER_BY }));
    expect(prisma.faqEntry.findMany).toHaveBeenCalledWith(expect.objectContaining({ orderBy: EXPECTED_ORDER_BY }));
    expect(prisma.survey.findMany).toHaveBeenCalledWith(expect.objectContaining({ orderBy: EXPECTED_ORDER_BY }));
  });

  it('tx 경로(순차 await) — 7개 findMany 모두 같은 orderBy로 호출된다', async () => {
    const prisma = buildPrismaMock();
    const tx = buildPrismaMock();
    const service = new DialogueBundleService(prisma as never);
    await service.build('chatbot-1', tx as never);

    expect(tx.intent.findMany).toHaveBeenCalledWith(expect.objectContaining({ orderBy: EXPECTED_ORDER_BY }));
    expect(tx.keyword.findMany).toHaveBeenCalledWith(expect.objectContaining({ orderBy: EXPECTED_ORDER_BY }));
    expect(tx.homonymDictionary.findMany).toHaveBeenCalledWith(expect.objectContaining({ orderBy: EXPECTED_ORDER_BY }));
    expect(tx.dialogNode.findMany).toHaveBeenCalledWith(expect.objectContaining({ orderBy: EXPECTED_ORDER_BY }));
    expect(tx.contextVariable.findMany).toHaveBeenCalledWith(expect.objectContaining({ orderBy: EXPECTED_ORDER_BY }));
    expect(tx.faqEntry.findMany).toHaveBeenCalledWith(expect.objectContaining({ orderBy: EXPECTED_ORDER_BY }));
    expect(tx.survey.findMany).toHaveBeenCalledWith(expect.objectContaining({ orderBy: EXPECTED_ORDER_BY }));
    // tx 경로는 필터를 쓸 수 없다 — 8번째(topic) 조회가 없다.
    expect(tx.topic.findMany).not.toHaveBeenCalled();
    expect(prisma.topic.findMany).not.toHaveBeenCalled();
  });

  it('excludeInactiveTopics=true + tx 클라이언트 조합은 프로그래밍 오류로 throw한다(§6.1, §17 T-2 런타임 가드)', async () => {
    const prisma = buildPrismaMock();
    const tx = buildPrismaMock();
    const service = new DialogueBundleService(prisma as never);
    await expect(service.build('chatbot-1', tx as never, { excludeInactiveTopics: true })).rejects.toThrow();
  });

  it('excludeInactiveTopics=true(비tx) — 8번째 topic.findMany가 나머지 7개와 함께 병렬 호출된다', async () => {
    const prisma = buildPrismaMock();
    const service = new DialogueBundleService(prisma as never);
    await service.build('chatbot-1', undefined, { excludeInactiveTopics: true });
    expect(prisma.topic.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { chatbotId: 'chatbot-1', enabled: false } }));
  });
});

/**
 * [신규 No.40 — §7.3 AC-EN2-3/4] `invalidate()` 1곳이 버전 서빙 L2 합성 캐시도 함께 비운다 —
 * 토픽·설문 편집이 이 지점을 호출하는 기존 배선(코드 변경 0)을 그대로 타면서, 운영 서빙 L2도 즉시
 * 무효화된다.
 */
describe('DialogueBundleService.invalidate() — 버전 서빙 L2 공유 무효화(§7.3)', () => {
  it('versionServingCache가 주입돼 있으면 invalidate(chatbotId) 호출 시 invalidateChatbot(chatbotId)도 호출한다', () => {
    const prisma = buildPrismaMock();
    const cache = { get: jest.fn(), set: jest.fn(), invalidate: jest.fn() };
    const versionServingCache = { get: jest.fn(), set: jest.fn(), invalidateChatbot: jest.fn() };
    const service = new DialogueBundleService(prisma as never, cache as never, undefined, undefined, undefined, versionServingCache as never);

    service.invalidate('chatbot-1');

    expect(versionServingCache.invalidateChatbot).toHaveBeenCalledWith('chatbot-1');
    expect(cache.invalidate).toHaveBeenCalledWith('chatbot-1');
  });

  it('versionServingCache가 주입되지 않았으면(선택 의존성) invalidate()가 예외 없이 동작한다(모드 꺼진 배포 — 응답 바이트·쿼리 수 불변)', () => {
    const prisma = buildPrismaMock();
    const service = new DialogueBundleService(prisma as never);
    expect(() => service.invalidate('chatbot-1')).not.toThrow();
  });
});
