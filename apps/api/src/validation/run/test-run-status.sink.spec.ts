import { TestRunStatusSink } from './test-run-status.sink';

/**
 * markFinished()가 취소 레지스트리를 정리하는지 검증 — code-reviewer 대응(Medium):
 * `TestRunCancelRegistry`에 추가된 runId가 실행 종료 후에도 지워지지 않아 프로세스 수명 동안
 * 무한히 누적되는 문제를 막는다.
 */

function buildSink() {
  const prisma = {
    testRun: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const cancelRegistry = { cancel: jest.fn(), isCancelled: jest.fn(), clear: jest.fn() };
  const sink = new TestRunStatusSink(prisma as never, cancelRegistry as never);
  return { sink, prisma, cancelRegistry };
}

describe('TestRunStatusSink.markFinished — 취소 레지스트리 정리(code-review 대응)', () => {
  it('SUCCEEDED로 종료되면 cancelRegistry.clear(runId)를 호출한다', async () => {
    const { sink, cancelRegistry } = buildSink();
    await sink.markFinished('run-1', 'SUCCEEDED', { a: {} });
    expect(cancelRegistry.clear).toHaveBeenCalledWith('run-1');
  });

  it('FAILED로 종료돼도 cancelRegistry.clear(runId)를 호출한다', async () => {
    const { sink, cancelRegistry } = buildSink();
    await sink.markFinished('run-2', 'FAILED', undefined, 'ERROR');
    expect(cancelRegistry.clear).toHaveBeenCalledWith('run-2');
  });

  it('이미 CANCELLED라 updateMany가 0건을 갱신해도(CAS 무시됨) cancelRegistry.clear(runId)는 호출된다', async () => {
    const { sink, prisma, cancelRegistry } = buildSink();
    prisma.testRun.updateMany.mockResolvedValue({ count: 0 });
    await sink.markFinished('run-3', 'SUCCEEDED', { a: {} });
    expect(cancelRegistry.clear).toHaveBeenCalledWith('run-3');
  });
});
