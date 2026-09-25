import { VersionRestoreService } from './version-restore.service';
import { computeContentHash } from '../lib/snapshot-canonical';
import type { SnapshotEnvelope } from '../lib/snapshot-envelope';
import { ApiException } from '../../common/api.exception';

/**
 * M-3 코드리뷰 대응 — 복원 노출 게이트의 TOCTOU 재확인(§11.2). 트랜잭션 진입 직전(확인 시점)과
 * 트랜잭션 안(적용 시점) 사이에 토픽 활성 상태가 바뀌면(경합), 두 시점의 노출 계산값이 달라진다.
 * `dto.expectedCurrentHash`(자산 내용 해시)는 토픽 **활성 상태**를 반영하지 않으므로(토픽 활성은
 * 자산 내용이 아니다) 기존 `RESTORE_PREVIEW_STALE` 판정만으로는 이 경합을 잡지 못한다 — 그래서
 * 노출 값 자체를 재확인하는 별도 게이트가 필요하다.
 *
 * `hydrateSnapshot`·`checkSnapshotIntegrity`·`findCrossChatbotIdConflicts`는 이 시험의 관심사가
 * 아니므로(전부 트랜잭션 밖에서 무관하게 통과해야 하는 전제조건) 모듈 목으로 항상 통과시킨다.
 */
jest.mock('../lib/snapshot-hydrate', () => ({ hydrateSnapshot: jest.fn().mockReturnValue({}) }));
jest.mock('../lib/snapshot-integrity', () => ({ checkSnapshotIntegrity: jest.fn().mockReturnValue({ violations: [], violationsTotal: 0 }) }));
jest.mock('./cross-chatbot-check', () => ({ findCrossChatbotIdConflicts: jest.fn().mockResolvedValue([]) }));

const NOW = new Date('2026-01-01T00:00:00.000Z');

function buildEnvelope(nodeTopicId: string | undefined): SnapshotEnvelope {
  return {
    schemaVersion: 1,
    capturedAt: NOW.toISOString(),
    chatbotId: 'chatbot-1',
    assets: {
      intents: [],
      keywords: [],
      homonyms: [],
      dialogNodes: [
        {
          id: 'node-1',
          name: '노드',
          nodeType: 'NORMAL',
          matchMode: 'ANY',
          enabled: true,
          priority: 100,
          intentIds: [],
          keywordIds: [],
          outputs: [],
          topicId: nodeTopicId,
          createdAt: NOW,
        },
      ],
      contexts: [],
      faqs: [],
    },
    answerSetting: null,
    profile: { name: '챗봇', avatarUrl: null, description: null, skin: { primaryColor: '#4F46E5', headerTitle: '챗봇 상담' } },
  } as unknown as SnapshotEnvelope;
}

// 현재: 노드가 "t1"(비활성 예정) 토픽 소속 · 대상(복원본): 노드가 공통(topicId 없음) — 복원하면 노출된다.
const CURRENT_ENVELOPE = buildEnvelope('t1');
const TARGET_ENVELOPE = buildEnvelope(undefined);
const CURRENT_HASH = computeContentHash(CURRENT_ENVELOPE);
const TARGET_HASH = computeContentHash(TARGET_ENVELOPE);

/** `ApiException`은 `HttpException.getResponse()`로 `{code, message, details?}`를 공개한다. */
async function captureApiExceptionCode(promise: Promise<unknown>): Promise<{ code: string; details?: Array<{ field: string }> }> {
  try {
    await promise;
  } catch (e) {
    if (e instanceof ApiException) {
      return e.getResponse() as { code: string; details?: Array<{ field: string }> };
    }
    throw e;
  }
  throw new Error('예상한 ApiException이 던져지지 않았습니다.');
}

function buildDeps(topicRowsPre: Array<{ id: string; enabled: boolean }>, topicRowsInTx: Array<{ id: string; enabled: boolean }>) {
  const txMock = {
    chatbot: { findUnique: jest.fn().mockResolvedValue({ status: 'DRAFT' }) },
    trainingJob: { count: jest.fn().mockResolvedValue(0) },
    testRun: { count: jest.fn().mockResolvedValue(0) },
    topic: { findMany: jest.fn().mockResolvedValue(topicRowsInTx) },
  };
  const prisma = {
    chatbot: { findUnique: jest.fn().mockResolvedValue({ id: 'chatbot-1', name: '챗봇', status: 'DRAFT' }) },
    chatbotVersion: {
      findUnique: jest.fn().mockResolvedValue({ id: 'version-1', chatbotId: 'chatbot-1', contentHash: TARGET_HASH, versionNo: 1, schemaVersion: 1, integrityWarningCount: 0 }),
    },
    topic: { findMany: jest.fn().mockResolvedValue(topicRowsPre) },
    $transaction: jest.fn((cb: (tx: unknown) => Promise<unknown>) => cb(txMock)),
  };
  const versionCapture = {
    txTimeoutMs: jest.fn().mockReturnValue(30000),
    captureSnapshotData: jest.fn().mockResolvedValue({ envelope: CURRENT_ENVELOPE, contentHash: CURRENT_HASH, integrityWarningCount: 0 }),
    readConsistent: jest.fn().mockResolvedValue({}),
    computeFromCaptured: jest
      .fn()
      .mockReturnValueOnce({ envelope: CURRENT_ENVELOPE, contentHash: CURRENT_HASH, integrityWarningCount: 0 }) // currentData
      .mockReturnValueOnce({ envelope: TARGET_ENVELOPE, contentHash: TARGET_HASH, integrityWarningCount: 0 }), // afterData(적용 후)
    persistWithin: jest.fn().mockResolvedValue({ id: 'backup-1', versionNo: 2 }),
  };
  const payloadReader = { loadStrict: jest.fn().mockResolvedValue({ envelope: TARGET_ENVELOPE, upcastedFrom: undefined }) };
  const warningsService = {};
  const applier = { apply: jest.fn().mockResolvedValue({ classifierDeletedCount: 0 }) };
  const restoreLock = { tryAcquire: jest.fn().mockReturnValue(true), release: jest.fn(), isLocked: jest.fn().mockReturnValue(false) };
  const bundleService = { invalidate: jest.fn() };
  const answerSettingsCache = { invalidate: jest.fn() };
  const reindexQueue = { isRunning: jest.fn().mockReturnValue(false) };
  const auditLogService = { record: jest.fn().mockResolvedValue(undefined) };
  const retention = { pruneBestEffort: jest.fn().mockResolvedValue(undefined) };

  const service = new VersionRestoreService(
    prisma as never,
    versionCapture as never,
    payloadReader as never,
    warningsService as never,
    applier as never,
    restoreLock as never,
    bundleService as never,
    answerSettingsCache as never,
    reindexQueue as never,
    auditLogService as never,
    retention as never,
  );
  return { service, prisma, txMock, applier, auditLogService };
}

describe('VersionRestoreService.restore — 토픽 노출 게이트 TOCTOU 재확인(M-3)', () => {
  it('확인 시점(가입 전)에는 토픽이 비활성이라 노출 변화가 있었지만, 트랜잭션 진입 직전 다른 요청이 그 토픽을 활성화해 놓으면 노출 계산값이 달라져 RESTORE_PREVIEW_STALE로 거부한다(롤백)', async () => {
    // 확인 시점: t1 비활성 → exposureForGate = {exposed:1, hidden:0}. 트랜잭션 시점: t1이 이미 활성화됨
    // (경합) → exposureInTx = {exposed:0, hidden:0}. 두 값이 달라 재확인이 필요하다.
    const { service, applier } = buildDeps([{ id: 't1', enabled: false }], [{ id: 't1', enabled: true }]);

    const body = await captureApiExceptionCode(
      service.restore('chatbot-1', 'version-1', { expectedCurrentHash: CURRENT_HASH, acknowledgeTopicExposure: true }),
    );
    expect(body.code).toBe('RESTORE_PREVIEW_STALE');

    // 롤백되어 실제 적재(applier.apply)는 절대 호출되지 않는다.
    expect(applier.apply).not.toHaveBeenCalled();
  });

  it('경합이 없으면(확인 시점과 트랜잭션 시점의 토픽 상태가 같음) 정상적으로 복원이 진행된다', async () => {
    const { service, applier, auditLogService } = buildDeps([{ id: 't1', enabled: false }], [{ id: 't1', enabled: false }]);

    const result = await service.restore('chatbot-1', 'version-1', { expectedCurrentHash: CURRENT_HASH, acknowledgeTopicExposure: true });

    expect(result.contentHash).toBe(TARGET_HASH);
    expect(applier.apply).toHaveBeenCalledTimes(1);
    expect(auditLogService.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'RESTORE' }));
  });

  it('경합이 없고 노출 변화가 있는데 확인 체크를 하지 않으면 트랜잭션 진입 전(사전 게이트)에 이미 400으로 거부된다', async () => {
    const { service, applier } = buildDeps([{ id: 't1', enabled: false }], [{ id: 't1', enabled: false }]);

    const body = await captureApiExceptionCode(service.restore('chatbot-1', 'version-1', { expectedCurrentHash: CURRENT_HASH }));
    expect(body.code).toBe('VALIDATION_FAILED');
    expect(body.details?.[0]?.field).toBe('acknowledgeTopicExposure');
    expect(applier.apply).not.toHaveBeenCalled();
  });
});
