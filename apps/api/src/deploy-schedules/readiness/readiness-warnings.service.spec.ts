import { ReadinessWarningsService } from './readiness-warnings.service';

/**
 * 준비도 경고(§12) 단위 테스트(code-review 1라운드 M3) — `EMBEDDING_INDEX_INCOMPLETE`·
 * `LAST_TEST_RUN`/`NO_RECENT_TEST_RUN` 3종 포함 9종 전부 다룬다. 정보성 경고이므로 생성을 막지
 * 않는다는 계약(soft)을 확인하는 것이 아니라 "경고 목록에 올바른 코드가 포함되는지"만 확인한다.
 */
describe('ReadinessWarningsService(§12, code-review M3)', () => {
  const BASE_NOW = new Date('2027-01-01T00:00:00Z');

  function buildService(opts: {
    engineEnabled?: boolean;
    embeddingStatus?: { pending: number; failed: number };
    trainingJobCount?: number;
    testRunActiveCount?: number;
    lastTestRun?: { finishedAt: Date | null; summary: string | null; set: { name: string } | null } | null;
    channel?: { enabled: boolean; config: string } | null;
  }) {
    const config = { get: jest.fn().mockReturnValue(opts.engineEnabled ?? true) };
    const embeddingStatus = { getStatus: jest.fn().mockResolvedValue({ pending: 0, failed: 0, ...opts.embeddingStatus }) };
    const prisma = {
      trainingJob: { count: jest.fn().mockResolvedValue(opts.trainingJobCount ?? 0) },
      testRun: {
        count: jest.fn().mockResolvedValue(opts.testRunActiveCount ?? 0),
        findFirst: jest.fn().mockResolvedValue(opts.lastTestRun === undefined ? null : opts.lastTestRun),
      },
      channel: { findUnique: jest.fn().mockResolvedValue(opts.channel === undefined ? null : opts.channel) },
    };
    return new ReadinessWarningsService(prisma as never, config as never, embeddingStatus as never);
  }

  it('ENGINE_DISABLED_ON_THIS_INSTANCE — 엔진 비활성 인스턴스에서 경고한다', async () => {
    const service = buildService({ engineEnabled: false });
    const warnings = await service.compute({ action: 'SET_WEB_CHANNEL', chatbotId: 'bot-1', scheduledAt: BASE_NOW, now: BASE_NOW });
    expect(warnings.some((w) => w.code === 'ENGINE_DISABLED_ON_THIS_INSTANCE')).toBe(true);
  });

  it('PREDECESSOR_HELD — 앞선 HELD 예약 id가 있으면 경고한다', async () => {
    const service = buildService({});
    const warnings = await service.compute({ action: 'SET_WEB_CHANNEL', chatbotId: 'bot-1', scheduledAt: BASE_NOW, now: BASE_NOW, earlierHeldScheduleId: 'held-1' });
    expect(warnings).toContainEqual({ code: 'PREDECESSOR_HELD', heldScheduleId: 'held-1' });
  });

  it('EMBEDDING_INDEX_INCOMPLETE — pending/failed가 있으면 모든 동작에서 경고한다', async () => {
    const service = buildService({ embeddingStatus: { pending: 3, failed: 1 } });
    const warnings = await service.compute({ action: 'SET_WEB_CHANNEL', chatbotId: 'bot-1', scheduledAt: BASE_NOW, now: BASE_NOW });
    expect(warnings).toContainEqual({ code: 'EMBEDDING_INDEX_INCOMPLETE', pendingCount: 3, failedCount: 1 });
  });

  it('EMBEDDING_INDEX_INCOMPLETE — pending·failed 모두 0이면 경고하지 않는다', async () => {
    const service = buildService({ embeddingStatus: { pending: 0, failed: 0 } });
    const warnings = await service.compute({ action: 'SET_WEB_CHANNEL', chatbotId: 'bot-1', scheduledAt: BASE_NOW, now: BASE_NOW });
    expect(warnings.some((w) => w.code === 'EMBEDDING_INDEX_INCOMPLETE')).toBe(false);
  });

  it('LONG_HORIZON — RESTORE_VERSION이 30일을 넘으면 경고한다', async () => {
    const service = buildService({});
    const scheduledAt = new Date(BASE_NOW.getTime() + 31 * 86_400_000);
    const warnings = await service.compute({ action: 'RESTORE_VERSION', chatbotId: 'bot-1', scheduledAt, now: BASE_NOW });
    expect(warnings).toContainEqual({ code: 'LONG_HORIZON', days: 31 });
  });

  it('ACTIVE_JOB — RESTORE_VERSION에서 진행 중 작업이 있으면 경고한다', async () => {
    const service = buildService({ trainingJobCount: 1 });
    const warnings = await service.compute({ action: 'RESTORE_VERSION', chatbotId: 'bot-1', scheduledAt: BASE_NOW, now: BASE_NOW });
    expect(warnings).toContainEqual({ code: 'ACTIVE_JOB', jobs: [] });
  });

  describe('LAST_TEST_RUN / NO_RECENT_TEST_RUN(RESTORE·PUBLISH만)', () => {
    it('최근 성공 실행이 있으면 통과율과 함께 LAST_TEST_RUN을 반환한다', async () => {
      const ranAt = new Date('2026-12-31T00:00:00Z');
      const service = buildService({
        lastTestRun: { finishedAt: ranAt, summary: JSON.stringify({ a: { pass: 9, fail: 1, notJudged: 0, unresolved: 0 } }), set: { name: '검증세트' } },
      });
      const warnings = await service.compute({ action: 'RESTORE_VERSION', chatbotId: 'bot-1', scheduledAt: BASE_NOW, now: BASE_NOW });
      expect(warnings).toContainEqual({ code: 'LAST_TEST_RUN', setName: '검증세트', passRate: 0.9, ranAt });
    });

    it('최근 성공 실행이 없으면 NO_RECENT_TEST_RUN을 반환한다', async () => {
      const service = buildService({ lastTestRun: null });
      const warnings = await service.compute({ action: 'PUBLISH', chatbotId: 'bot-1', scheduledAt: BASE_NOW, now: BASE_NOW });
      expect(warnings).toContainEqual({ code: 'NO_RECENT_TEST_RUN' });
    });

    it('summary가 손상되면 NO_RECENT_TEST_RUN으로 안전 폴백한다', async () => {
      const service = buildService({ lastTestRun: { finishedAt: BASE_NOW, summary: 'not-json', set: { name: 'x' } } });
      const warnings = await service.compute({ action: 'PUBLISH', chatbotId: 'bot-1', scheduledAt: BASE_NOW, now: BASE_NOW });
      expect(warnings).toContainEqual({ code: 'NO_RECENT_TEST_RUN' });
    });

    it('SET_WEB_CHANNEL에는 LAST_TEST_RUN/NO_RECENT_TEST_RUN을 계산하지 않는다(적용 동작 아님)', async () => {
      const service = buildService({ lastTestRun: null });
      const warnings = await service.compute({ action: 'SET_WEB_CHANNEL', chatbotId: 'bot-1', scheduledAt: BASE_NOW, now: BASE_NOW });
      expect(warnings.some((w) => w.code === 'LAST_TEST_RUN' || w.code === 'NO_RECENT_TEST_RUN')).toBe(false);
    });
  });

  describe('WEB_CHANNEL_NOT_CONFIGURED / PUBLISHED_BUT_CHANNEL_CLOSED', () => {
    it('SET_WEB_CHANNEL에서 채널 허용 Origin이 비어 있으면 경고한다', async () => {
      const service = buildService({ channel: { enabled: false, config: JSON.stringify({ allowedOrigins: [] }) } });
      const warnings = await service.compute({ action: 'SET_WEB_CHANNEL', chatbotId: 'bot-1', scheduledAt: BASE_NOW, now: BASE_NOW });
      expect(warnings).toContainEqual({ code: 'WEB_CHANNEL_NOT_CONFIGURED' });
    });

    it('PUBLISH(enableWebChannel=false)이고 채널이 닫혀 있으면 PUBLISHED_BUT_CHANNEL_CLOSED를 경고한다', async () => {
      const service = buildService({ channel: { enabled: false, config: JSON.stringify({ allowedOrigins: ['https://x'] }) } });
      const warnings = await service.compute({ action: 'PUBLISH', chatbotId: 'bot-1', scheduledAt: BASE_NOW, now: BASE_NOW, enableWebChannel: false });
      expect(warnings).toContainEqual({ code: 'PUBLISHED_BUT_CHANNEL_CLOSED' });
    });
  });
});
