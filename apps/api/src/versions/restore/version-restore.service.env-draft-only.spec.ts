import { VersionRestoreService } from './version-restore.service';
import type { SnapshotEnvelope } from '../lib/snapshot-envelope';

/**
 * [신규 No.40 — §13.1] 복원 미리보기 `ENV_DRAFT_ONLY` 경고 단위 시험. 모드 켜짐(`chatbot.prodVersionId`
 * 있음)일 때만 `{ code:'ENV_DRAFT_ONLY', prodVersionNo, stagingVersionNo }`를 싣는다 — 복원은
 * 초안에만 적용되고 운영은 바뀌지 않는다는 안내다(P-7).
 */
jest.mock('../lib/snapshot-hydrate', () => ({ hydrateSnapshot: jest.fn().mockReturnValue({}) }));
jest.mock('../lib/snapshot-integrity', () => ({ checkSnapshotIntegrity: jest.fn().mockReturnValue({ violations: [], violationsTotal: 0 }) }));
jest.mock('./cross-chatbot-check', () => ({ findCrossChatbotIdConflicts: jest.fn().mockResolvedValue([]) }));

const NOW = new Date('2026-01-01T00:00:00.000Z');

function buildEnvelope(): SnapshotEnvelope {
  return {
    schemaVersion: 1,
    capturedAt: NOW.toISOString(),
    chatbotId: 'chatbot-1',
    assets: { intents: [], keywords: [], homonyms: [], dialogNodes: [], contexts: [], faqs: [] },
    answerSetting: null,
    profile: { name: '챗봇', avatarUrl: null, description: null, skin: { primaryColor: '#4F46E5', headerTitle: '챗봇 상담' } },
  } as unknown as SnapshotEnvelope;
}

function buildDeps(prodVersionId: string | null, stagingVersionId: string | null = null) {
  const CURRENT_ENVELOPE = buildEnvelope();
  const TARGET_ENVELOPE = buildEnvelope();
  const prisma = {
    chatbot: { findUnique: jest.fn().mockResolvedValue({ id: 'chatbot-1', name: '챗봇', status: 'DRAFT', prodVersionId }) },
    chatbotVersion: {
      findUnique: jest.fn().mockImplementation(({ where }: { where: { id: string } }) => {
        if (where.id === 'version-1') return Promise.resolve({ id: 'version-1', chatbotId: 'chatbot-1', contentHash: 'target-hash', versionNo: 3, trigger: 'MANUAL', createdAt: NOW, schemaVersion: 1, integrityWarningCount: 0 });
        if (where.id === prodVersionId) return Promise.resolve({ versionNo: 5 });
        if (where.id === stagingVersionId) return Promise.resolve({ versionNo: 7 });
        return Promise.resolve(null);
      }),
      count: jest.fn().mockResolvedValue(0),
    },
    chatbotEnvironment: { findUnique: jest.fn().mockResolvedValue(stagingVersionId ? { stagingVersionId } : { stagingVersionId: null }) },
    topic: { findMany: jest.fn().mockResolvedValue([]) },
    trainingJob: { findMany: jest.fn().mockResolvedValue([]) },
    testRun: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const versionCapture = {
    captureSnapshotData: jest.fn().mockResolvedValue({ envelope: CURRENT_ENVELOPE, contentHash: 'current-hash', integrityWarningCount: 0 }),
  };
  const payloadReader = { loadStrict: jest.fn().mockResolvedValue({ envelope: TARGET_ENVELOPE, upcastedFrom: undefined }) };
  const warningsService = { computeWarnings: jest.fn().mockResolvedValue([]) };
  const applier = {};
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
  return { service };
}

describe('VersionRestoreService.preview — ENV_DRAFT_ONLY 경고(§13.1)', () => {
  it('모드 꺼짐(prodVersionId 없음)이면 ENV_DRAFT_ONLY 경고가 없다', async () => {
    const { service } = buildDeps(null);
    const result = await service.preview('chatbot-1', 'version-1');
    expect(result.warnings.some((w) => w.code === 'ENV_DRAFT_ONLY')).toBe(false);
  });

  it('모드 켜짐이면 ENV_DRAFT_ONLY 경고에 prodVersionNo·stagingVersionNo(null)를 싣는다(스테이징 없음)', async () => {
    const { service } = buildDeps('prod-version-x');
    const result = await service.preview('chatbot-1', 'version-1');
    expect(result.warnings).toContainEqual({ code: 'ENV_DRAFT_ONLY', prodVersionNo: 5, stagingVersionNo: null });
  });

  it('모드 켜짐 + 스테이징 있음이면 stagingVersionNo도 채운다', async () => {
    const { service } = buildDeps('prod-version-x', 'staging-version-y');
    const result = await service.preview('chatbot-1', 'version-1');
    expect(result.warnings).toContainEqual({ code: 'ENV_DRAFT_ONLY', prodVersionNo: 5, stagingVersionNo: 7 });
  });
});
