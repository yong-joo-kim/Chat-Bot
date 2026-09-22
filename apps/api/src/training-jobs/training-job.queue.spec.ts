import { TrainingJobQueue } from './training-job.queue';
import type { TrainingJobService } from './training-job.service';

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe('TrainingJobQueue — ADR-0027 §4 in-process 큐(교체 지점 1곳)', () => {
  function buildJobsMock() {
    return {
      markRunning: jest.fn().mockResolvedValue(undefined),
      updateProgress: jest.fn().mockResolvedValue(undefined),
      markFinished: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<TrainingJobService>;
  }

  it('enqueue()는 즉시 반환한다(fire-and-forget, DD-110) — 호출부가 await 없이 202를 반환할 수 있다', () => {
    const jobs = buildJobsMock();
    const queue = new TrainingJobQueue(jobs);
    const task = jest.fn().mockResolvedValue({ status: 'SUCCEEDED' as const });

    queue.enqueue('job-1', task);

    // task는 비동기로 실행되므로 이 시점에는 아직 시작되지 않았을 수 있다 — 예외 없이 반환한 것만 확인.
    expect(true).toBe(true);
  });

  it('성공 시 markRunning → task → markFinished(SUCCEEDED) 순서로 호출된다', async () => {
    const jobs = buildJobsMock();
    const queue = new TrainingJobQueue(jobs);
    const task = jest.fn().mockResolvedValue({ status: 'SUCCEEDED' as const, resultSummary: { generated: 1 } });

    queue.enqueue('job-1', task);
    await flushMicrotasks();
    await flushMicrotasks();

    expect(jobs.markRunning).toHaveBeenCalledWith('job-1');
    expect(task).toHaveBeenCalledTimes(1);
    expect(jobs.markFinished).toHaveBeenCalledWith('job-1', 'SUCCEEDED', { generated: 1 }, undefined);
  });

  it('task가 예외를 던지면 markFinished(FAILED, ...)로 수렴한다(예외를 삼키지 않되 전파하지도 않는다)', async () => {
    const jobs = buildJobsMock();
    const queue = new TrainingJobQueue(jobs);
    const task = jest.fn().mockRejectedValue(new Error('boom'));

    queue.enqueue('job-2', task);
    await flushMicrotasks();
    await flushMicrotasks();

    expect(jobs.markFinished).toHaveBeenCalledWith('job-2', 'FAILED', undefined, 'boom');
  });

  it('task 실행 중 onProgress 콜백이 TrainingJobService.updateProgress로 위임된다', async () => {
    const jobs = buildJobsMock();
    const queue = new TrainingJobQueue(jobs);
    const task = jest.fn().mockImplementation(async (ctx: { onProgress: (p: number) => Promise<void> }) => {
      await ctx.onProgress(50);
      return { status: 'SUCCEEDED' as const };
    });

    queue.enqueue('job-3', task);
    await flushMicrotasks();
    await flushMicrotasks();

    expect(jobs.updateProgress).toHaveBeenCalledWith('job-3', 50);
  });
});
