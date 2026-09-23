import { ApiException } from '../../common/api.exception';
import { PostRunTestStarter } from './post-run-test.starter';

/**
 * 새 테스트 — 구현·리뷰 단계 공백 보강(2026-09-24, No.28 시험 회차). G3(실행 직후 TC, §11)의
 * STARTED/SKIPPED/REJECTED 분기는 이전까지 전용 시험이 없었다(통합 시험에도 없음). "실패는 예약
 * 결과를 바꾸지 않는다 — 절대 throw하지 않는다"는 설계 원칙을 직접 검증한다.
 */
describe('PostRunTestStarter(§11 G3)', () => {
  function makeDeps(overrides: { testCaseSet?: unknown; caseCount?: number; startResult?: unknown; startError?: unknown } = {}) {
    const testCaseSet = 'testCaseSet' in overrides ? overrides.testCaseSet : { id: 'set-1', chatbotId: 'bot-1' };
    const prisma = {
      testCaseSet: { findUnique: jest.fn().mockResolvedValue(testCaseSet) },
      testCase: { count: jest.fn().mockResolvedValue(overrides.caseCount ?? 3) },
    };
    const testRunService = {
      start: overrides.startError
        ? jest.fn().mockRejectedValue(overrides.startError)
        : jest.fn().mockResolvedValue(overrides.startResult ?? { runId: 'run-1' }),
    };
    return { prisma, testRunService };
  }

  it('권한(simulation:write)이 있고 세트가 유효하면 STARTED와 testRunId를 반환한다', async () => {
    const { prisma, testRunService } = makeDeps();
    const starter = new PostRunTestStarter(prisma as never, testRunService as never);

    const result = await starter.start('bot-1', 'set-1', 'EDITOR');

    expect(result).toEqual({ status: 'STARTED', testRunId: 'run-1' });
    expect(testRunService.start).toHaveBeenCalledWith('bot-1', 'set-1', { overlaySource: 'NONE', useRag: false });
  });

  it('예약자 역할이 simulation:write를 잃었으면 SKIPPED(CREATOR_NOT_AUTHORIZED)다(TestRunService를 호출하지 않는다)', async () => {
    const { prisma, testRunService } = makeDeps();
    const starter = new PostRunTestStarter(prisma as never, testRunService as never);

    const result = await starter.start('bot-1', 'set-1', 'VIEWER');

    expect(result).toEqual({ status: 'SKIPPED', reason: 'CREATOR_NOT_AUTHORIZED' });
    expect(testRunService.start).not.toHaveBeenCalled();
  });

  it('세트가 삭제됐으면 SKIPPED(TEST_SET_MISSING)다', async () => {
    const { prisma, testRunService } = makeDeps({ testCaseSet: null });
    const starter = new PostRunTestStarter(prisma as never, testRunService as never);

    expect(await starter.start('bot-1', 'set-1', 'EDITOR')).toEqual({ status: 'SKIPPED', reason: 'TEST_SET_MISSING' });
    expect(testRunService.start).not.toHaveBeenCalled();
  });

  it('세트가 다른 챗봇 소속이면 SKIPPED(TEST_SET_MISSING)다(교차 챗봇 방어)', async () => {
    const { prisma, testRunService } = makeDeps({ testCaseSet: { id: 'set-1', chatbotId: 'other-bot' } });
    const starter = new PostRunTestStarter(prisma as never, testRunService as never);

    expect(await starter.start('bot-1', 'set-1', 'EDITOR')).toEqual({ status: 'SKIPPED', reason: 'TEST_SET_MISSING' });
    expect(testRunService.start).not.toHaveBeenCalled();
  });

  it('세트에 활성화된 TC가 0건이면 SKIPPED(TEST_SET_EMPTY)다', async () => {
    const { prisma, testRunService } = makeDeps({ caseCount: 0 });
    const starter = new PostRunTestStarter(prisma as never, testRunService as never);

    expect(await starter.start('bot-1', 'set-1', 'EDITOR')).toEqual({ status: 'SKIPPED', reason: 'TEST_SET_EMPTY' });
    expect(testRunService.start).not.toHaveBeenCalled();
  });

  it('동시 실행 1건 규약 위반(TEST_RUN_IN_PROGRESS)은 REJECTED(TEST_RUN_IN_PROGRESS)로 삼켜진다(throw 없음)', async () => {
    const { prisma, testRunService } = makeDeps({ startError: new ApiException('TEST_RUN_IN_PROGRESS', 409, '이미 실행 중입니다.') });
    const starter = new PostRunTestStarter(prisma as never, testRunService as never);

    await expect(starter.start('bot-1', 'set-1', 'EDITOR')).resolves.toEqual({ status: 'REJECTED', reason: 'TEST_RUN_IN_PROGRESS' });
  });

  it('분류되지 않은 오류는 reason 없이 REJECTED로 삼켜진다(예약 결과를 바꾸지 않는다)', async () => {
    const { prisma, testRunService } = makeDeps({ startError: new Error('unexpected') });
    const starter = new PostRunTestStarter(prisma as never, testRunService as never);

    await expect(starter.start('bot-1', 'set-1', 'EDITOR')).resolves.toEqual({ status: 'REJECTED' });
  });
});
