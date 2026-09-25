import { TopicSplitService } from './topic-split.service';
import { ApiException } from '../common/api.exception';

/**
 * 자동시험 결함 수정(자동시험_전략.md §14.5) — 분리(split)·미리보기(preview)가 무거운 캡처
 * (`AssetTransferCaptureService` → `DialogueBundleService.build()`)·트랜잭션 진입 **전에** 선택
 * 범위 사전 검사(count() 6회)로 상한 초과를 먼저 걸러내는지 확인한다. 상한을 넘는 챗봇에서
 * 캡처 서비스가 호출되지 않고 즉시 422가 나와야 한다(목/스파이로 확인).
 */

function buildService(overrides: { contextCount?: number } = {}) {
  const prisma = {
    chatbot: { findUnique: jest.fn().mockResolvedValue({ id: 'chatbot-1', name: '챗봇', slug: 'chatbot-1', groupId: 'group-1', status: 'DRAFT', avatarUrl: null, description: null, skin: '{}' }) },
    topic: { findMany: jest.fn().mockResolvedValue([{ id: 'topic-1', name: '대량토픽', description: null, sortOrder: 1, enabled: true }]) },
    intent: { count: jest.fn().mockResolvedValue(0) },
    keyword: { count: jest.fn().mockResolvedValue(0) },
    homonymDictionary: { count: jest.fn().mockResolvedValue(0) },
    contextVariable: { count: jest.fn().mockResolvedValue(overrides.contextCount ?? 0) },
    faqEntry: { count: jest.fn().mockResolvedValue(0) },
    dialogNode: { count: jest.fn().mockResolvedValue(0) },
    $transaction: jest.fn().mockRejectedValue(new Error('마커: 트랜잭션에 진입했다')),
  };
  const auditLogService = { record: jest.fn() };
  const bundleService = { build: jest.fn().mockResolvedValue({ intents: [], keywords: [], homonyms: [], dialogNodes: [], contexts: [], faqs: [], surveys: [] }), invalidate: jest.fn() };
  const copyTarget = { resolve: jest.fn().mockResolvedValue({ name: '챗봇 (분리)', slug: 'chatbot-1-split', groupId: 'group-1' }) };
  const capture = { captureTransferSource: jest.fn() };
  const loader = { load: jest.fn() };

  const service = new TopicSplitService(prisma as never, auditLogService as never, bundleService as never, copyTarget as never, capture as never, loader as never);
  return { service, prisma, bundleService, copyTarget, capture, loader };
}

async function captureApiExceptionCode(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (e) {
    if (e instanceof ApiException) return (e.getResponse() as { code: string }).code;
    throw e;
  }
  throw new Error('예상한 예외가 던져지지 않았습니다.');
}

describe('TopicSplitService — 캡처 전 선택 범위 사전 검사(자동시험 결함 수정)', () => {
  describe('split()', () => {
    it('선택 범위가 상한을 넘으면 캡처를 호출하지 않고 즉시 422 TOPIC_SPLIT_TOO_LARGE를 던진다', async () => {
      const { service, capture, prisma } = buildService({ contextCount: 201 }); // TOPIC_SPLIT_LIMITS.contexts = 200

      const code = await captureApiExceptionCode(service.split('chatbot-1', { topicIds: ['topic-1'], includeCommon: false, systemNodeLinks: 'TRIM' }));

      expect(code).toBe('TOPIC_SPLIT_TOO_LARGE');
      expect(capture.captureTransferSource).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('선택 범위가 상한 이내면 사전 검사를 통과해 트랜잭션(캡처) 단계까지 진행한다', async () => {
      const { service, prisma } = buildService({ contextCount: 5 });

      // $transaction이 마커 오류로 실패하도록 목을 구성했다 — "사전 검사를 통과해 트랜잭션에
      // 진입했다"는 것만 확인하면 되므로 이후 단계(캡처·적재)까지 전부 성공시킬 필요는 없다.
      await expect(service.split('chatbot-1', { topicIds: ['topic-1'], includeCommon: false, systemNodeLinks: 'TRIM' })).rejects.toThrow(
        '마커: 트랜잭션에 진입했다',
      );
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });
  });

  describe('preview()', () => {
    it('선택 범위가 상한을 넘으면 build()를 호출하지 않고 즉시 422 TOPIC_SPLIT_TOO_LARGE를 던진다', async () => {
      const { service, bundleService } = buildService({ contextCount: 500 });

      const code = await captureApiExceptionCode(service.preview('chatbot-1', { topicIds: ['topic-1'], includeCommon: false, systemNodeLinks: 'TRIM' }));

      expect(code).toBe('TOPIC_SPLIT_TOO_LARGE');
      expect(bundleService.build).not.toHaveBeenCalled();
    });

    it('선택 범위가 상한 이내면 build()까지 정상 진행한다', async () => {
      const { service, bundleService } = buildService({ contextCount: 5 });

      const preview = await service.preview('chatbot-1', { topicIds: ['topic-1'], includeCommon: false, systemNodeLinks: 'TRIM' });

      expect(bundleService.build).toHaveBeenCalledTimes(1);
      expect(preview.exceeded).toEqual([]);
    });
  });
});
