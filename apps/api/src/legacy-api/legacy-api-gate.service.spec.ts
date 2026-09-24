import { ConfigService } from '@nestjs/config';
import { LegacyApiGateService } from './legacy-api-gate.service';

function buildGate(overrides: Record<string, unknown> = {}): LegacyApiGateService {
  const values: Record<string, unknown> = { LEGACY_API_CIRCUIT_FAILURE_THRESHOLD: 5, LEGACY_API_CIRCUIT_OPEN_MS: 60_000, ...overrides };
  const config = { get: (key: string) => values[key] } as unknown as ConfigService;
  return new LegacyApiGateService(config);
}

describe('LegacyApiGateService — 탄력성(§7.6, AC-L3-4)', () => {
  it('연속 인프라 실패 5회 이후 6번째 시도는 CIRCUIT_OPEN이다', () => {
    const gate = buildGate();
    for (let i = 0; i < 5; i++) {
      const acquired = gate.tryAcquire('conn-1', 120);
      expect(acquired.ok).toBe(true);
      gate.release('conn-1', 'INFRA_FAILURE');
    }
    const sixth = gate.tryAcquire('conn-1', 120);
    expect(sixth).toEqual({ ok: false, outcome: 'CIRCUIT_OPEN' });
  });

  it('4xx(ALIVE로 분류)는 연속 실패로 세지 않아 회로를 열지 않는다(§21 D-19)', () => {
    const gate = buildGate();
    for (let i = 0; i < 10; i++) {
      const acquired = gate.tryAcquire('conn-2', 120);
      expect(acquired.ok).toBe(true);
      gate.release('conn-2', 'ALIVE');
    }
    expect(gate.isCircuitOpen('conn-2')).toBe(false);
  });

  it('half-open 상태에서 탐침 1건만 통과하고 성공하면 회로가 닫힌다', () => {
    const gate = buildGate({ LEGACY_API_CIRCUIT_OPEN_MS: 1 });
    for (let i = 0; i < 5; i++) {
      gate.tryAcquire('conn-3', 120);
      gate.release('conn-3', 'INFRA_FAILURE');
    }
    expect(gate.isCircuitOpen('conn-3')).toBe(true);

    // 개방 시간이 지나면 탐침 1건 통과
    return new Promise((resolve) => {
      setTimeout(() => {
        const probe = gate.tryAcquire('conn-3', 120);
        expect(probe.ok).toBe(true);
        gate.release('conn-3', 'ALIVE');
        expect(gate.isCircuitOpen('conn-3')).toBe(false);
        resolve(undefined);
      }, 5);
    });
  });

  it('연결당 동시 상한(10)을 넘으면 RATE_LIMITED다', () => {
    const gate = buildGate();
    for (let i = 0; i < 10; i++) {
      expect(gate.tryAcquire('conn-4', 1000).ok).toBe(true);
    }
    expect(gate.tryAcquire('conn-4', 1000)).toEqual({ ok: false, outcome: 'RATE_LIMITED' });
  });

  it('연결 테스트(bypass)는 회로가 열려 있어도 통과하고 카운터를 바꾸지 않는다(§21 D-14)', () => {
    const gate = buildGate();
    for (let i = 0; i < 5; i++) {
      gate.tryAcquire('conn-5', 120);
      gate.release('conn-5', 'INFRA_FAILURE');
    }
    expect(gate.isCircuitOpen('conn-5')).toBe(true);

    const bypassed = gate.tryAcquire('conn-5', 120, { bypass: true });
    expect(bypassed.ok).toBe(true);
    gate.release('conn-5', 'INFRA_FAILURE', { bypass: true });
    // 카운터 불변 — 여전히 회로가 열려 있는 상태(연장되지 않음, half-open 소모 없음)
    expect(gate.isCircuitOpen('conn-5')).toBe(true);
  });
});
