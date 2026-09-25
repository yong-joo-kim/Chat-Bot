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
  });
});
