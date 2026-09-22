import { ConfigService } from '@nestjs/config';
import { RagGateService } from './rag-gate.service';
import { RagHttpClient } from './rag-http.client';

function makeGate(overrides: Record<string, number> = {}): RagGateService {
  const config = {
    get: (key: string) => (key in overrides ? overrides[key] : undefined),
  } as unknown as ConfigService;
  const ragHttpClient = {} as RagHttpClient;
  return new RagGateService(config, ragHttpClient);
}

describe('RagGateService — FR-N2-28/29/30, AC-N2-12/13', () => {
  it('AC-N2-13: 동시 호출 상한을 초과하면 tryAcquire가 false다(대기하지 않는다)', () => {
    const gate = makeGate({ RAG_MAX_CONCURRENCY: 2, RAG_RATE_LIMIT_PER_MIN: 60 });
    expect(gate.tryAcquire()).toBe(true);
    expect(gate.tryAcquire()).toBe(true);
    expect(gate.tryAcquire()).toBe(false); // 3번째 — 상한 초과
  });

  it('release 후에는 다시 acquire할 수 있다', () => {
    const gate = makeGate({ RAG_MAX_CONCURRENCY: 1, RAG_RATE_LIMIT_PER_MIN: 60 });
    expect(gate.tryAcquire()).toBe(true);
    expect(gate.tryAcquire()).toBe(false);
    gate.release();
    expect(gate.tryAcquire()).toBe(true);
  });

  it('레이트리밋 초과 시 tryAcquire가 false다', () => {
    const gate = makeGate({ RAG_MAX_CONCURRENCY: 100, RAG_RATE_LIMIT_PER_MIN: 1 });
    expect(gate.tryAcquire()).toBe(true);
    gate.release();
    expect(gate.tryAcquire()).toBe(false); // 분당 1회 상한 소진
  });

  it('AC-N2-12: 연속 실패가 임계값에 도달하면 회로가 열려 이후 tryAcquire가 false다', () => {
    const gate = makeGate({ RAG_CIRCUIT_FAILURE_THRESHOLD: 3, RAG_CIRCUIT_OPEN_MS: 60_000, RAG_MAX_CONCURRENCY: 100, RAG_RATE_LIMIT_PER_MIN: 100 });
    expect(gate.isCircuitOpen()).toBe(false);
    gate.recordFailure();
    gate.recordFailure();
    expect(gate.isCircuitOpen()).toBe(false);
    gate.recordFailure();
    expect(gate.isCircuitOpen()).toBe(true);
    expect(gate.tryAcquire()).toBe(false);
  });

  it('recordSuccess는 연속 실패 카운트를 초기화한다', () => {
    const gate = makeGate({ RAG_CIRCUIT_FAILURE_THRESHOLD: 2, RAG_CIRCUIT_OPEN_MS: 60_000, RAG_MAX_CONCURRENCY: 100, RAG_RATE_LIMIT_PER_MIN: 100 });
    gate.recordFailure();
    gate.recordSuccess();
    gate.recordFailure();
    expect(gate.isCircuitOpen()).toBe(false); // 초기화됐으므로 아직 임계값 미도달
  });
});
