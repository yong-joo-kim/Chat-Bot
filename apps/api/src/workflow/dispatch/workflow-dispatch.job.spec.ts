import type { ConfigService } from '@nestjs/config';
import { WorkflowDispatchJob } from './workflow-dispatch.job';
import { computeBackoffMs, parseBackoffSchedule } from './lib/backoff';
import type { PrismaService } from '../../prisma/prisma.service';
import type { WorkflowRunStore, ClaimedRun } from '../core/workflow-run.store';
import type { WorkflowHttpSender } from './workflow-http.sender';
import type { Clock } from '../../common/polling/clock';

/**
 * `WorkflowDispatchJob` 단위 시험(mock Prisma/store/sender) — 코드 리뷰 R1 M-2.
 * 백오프 지터 난수 주입 지점(`WORKFLOW_RANDOM`)이 실제로 `computeBackoffMs`에 전달되는지, 그리고
 * 같은 주입값이면 `nextAttemptAt`이 결정적으로 재현되는지 확인한다(HTTP·발송 계약은
 * `integration/workflow-automation.integration.spec.ts`가 다룬다).
 */
describe('WorkflowDispatchJob — 백오프 지터 난수 주입(M-2)', () => {
  const now = new Date('2026-09-26T00:00:00.000Z');
  const runId = '11111111-1111-4111-8111-111111111111';
  const targetId = 'target-1';

  function makeClock(): Clock {
    return { now: () => now };
  }

  function makeConfig(): ConfigService {
    return { get: () => undefined } as unknown as ConfigService; // 전부 기본값 사용(백오프 '30s,2m,10m,30m,2h').
  }

  function makePrisma(): PrismaService {
    return {
      workflowRun: {
        findMany: jest.fn().mockResolvedValue([{ id: runId, status: 'PENDING', targetId, claimToken: null, attemptCount: 0, claimedAt: null }]),
        groupBy: jest.fn().mockResolvedValue([]),
      },
      workflowTarget: {
        findMany: jest.fn().mockResolvedValue([{ id: targetId, enabled: true, pausedAt: null }]),
        findUnique: jest.fn().mockResolvedValue({
          baseUrl: 'https://wf-test.example.invalid/hook',
          authType: 'NONE',
          authHeaderName: null,
          secretRef: null,
          signingEnabled: false,
          signingSecretRef: null,
          urlSecretRef: null,
          timeoutMs: 5000,
          maxAttempts: 5,
        }),
      },
    } as unknown as PrismaService;
  }

  function makeClaimedRun(attemptCount: number): ClaimedRun {
    return { id: runId, targetId, eventType: 'NODE_ACTION', sessionRef: null, createdAt: now, attemptCount, claimToken: 'token-1', payloadJson: '{}', decryptFailed: false };
  }

  function makeStore(attemptCount: number, finalizeRetry: jest.Mock): WorkflowRunStore {
    return {
      claim: jest.fn().mockResolvedValue(makeClaimedRun(attemptCount)),
      finalizeRetry,
    } as unknown as WorkflowRunStore;
  }

  function makeSender(): WorkflowHttpSender {
    // 전송 실패(재시도 대상) — 지터 계산 분기(§7.5)를 타게 한다.
    return { send: jest.fn().mockResolvedValue({ kind: 'TRANSPORT_ERROR', outcome: 'TIMEOUT' }) } as unknown as WorkflowHttpSender;
  }

  it('주입된 random()이 0을 반환하면 지터 하한(base × 0.8)으로 재시도 시각이 결정된다', async () => {
    const finalizeRetry = jest.fn().mockResolvedValue(true);
    const attemptCount = 1; // claim()이 attemptCount를 1 증가시킨 뒤 값
    const store = makeStore(attemptCount, finalizeRetry);
    const random = () => 0;
    const job = new WorkflowDispatchJob(makePrisma(), makeConfig(), store, makeSender(), makeClock(), random);

    await job.tick();

    expect(finalizeRetry).toHaveBeenCalledTimes(1);
    const nextAttemptAt = finalizeRetry.mock.calls[0][2] as Date;
    const expectedMs = computeBackoffMs(parseBackoffSchedule('30s,2m,10m,30m,2h'), attemptCount, random);
    expect(nextAttemptAt.getTime()).toBe(now.getTime() + expectedMs);
    expect(expectedMs).toBe(Math.round(30_000 * 0.8)); // 1번째 시도 = 30초 구간 하한
  });

  it('주입된 random()이 1을 반환하면 지터 상한(base × 1.2)으로 재시도 시각이 결정된다(동일 입력 → 동일 출력)', async () => {
    const finalizeRetry = jest.fn().mockResolvedValue(true);
    const attemptCount = 1;
    const store = makeStore(attemptCount, finalizeRetry);
    const random = () => 1;
    const job = new WorkflowDispatchJob(makePrisma(), makeConfig(), store, makeSender(), makeClock(), random);

    await job.tick();

    const nextAttemptAt = finalizeRetry.mock.calls[0][2] as Date;
    const expectedMs = computeBackoffMs(parseBackoffSchedule('30s,2m,10m,30m,2h'), attemptCount, random);
    expect(nextAttemptAt.getTime()).toBe(now.getTime() + expectedMs);
    expect(expectedMs).toBe(Math.round(30_000 * 1.2)); // 1번째 시도 = 30초 구간 상한
  });

  it('random 미주입 시 기본값 Math.random을 쓴다(예외 없이 유효한 범위의 지연을 만든다)', async () => {
    const finalizeRetry = jest.fn().mockResolvedValue(true);
    const attemptCount = 1;
    const store = makeStore(attemptCount, finalizeRetry);
    // 4번째 인자(random)를 생략 — 생성자 기본값 Math.random이 쓰인다(§ 선택 주입 지점).
    const job = new WorkflowDispatchJob(makePrisma(), makeConfig(), store, makeSender(), makeClock());

    await job.tick();

    const nextAttemptAt = finalizeRetry.mock.calls[0][2] as Date;
    const deltaMs = nextAttemptAt.getTime() - now.getTime();
    expect(deltaMs).toBeGreaterThanOrEqual(Math.round(30_000 * 0.8));
    expect(deltaMs).toBeLessThanOrEqual(Math.round(30_000 * 1.2));
  });
});
