import type { AugmentationFailureCause } from '../augmentation-provider.port';

/**
 * 증강 회로차단 상태(K-1c, ADR-0050 §2 · 설계 `followup-defects-2026-10-01-설계.md` §5.3). Nest·Prisma 무의존 순수 클래스 —
 * 팩토리(모듈 싱글턴)가 공급자별로 1개씩 소유하고, Job마다 새로 만들어지는 Provider에 주입한다(상태만 공유 · 인스턴스는 공유하지 않는다).
 *
 * 상태: 닫힘 → (인프라 실패 연속 `threshold`회) → 개방(`openMs`) → half-open(탐침 1건만 통과) → 성공이면 닫힘 · 인프라 실패면 재개방 · 중립이면 임대만 풀고 상태 유지.
 * 개방 전에 시작된 호출의 결과가 늦게 와도 개방 시간을 연장하지 않는다(허가증 세대 `epoch`로 구분 — 레거시 게이트와 같은 규칙).
 */

/** 호출 결과 분류 — `success` = 연속 실패 0, `infra` = 인프라 실패(+1), `neutral` = 장애가 아님(변화 없음). */
export type CircuitOutcome = 'success' | 'infra' | 'neutral';

/** `tryAcquire()`가 통과시킨 호출 1건의 허가증. `record()`에 그대로 돌려준다. */
export interface CircuitPermit {
  readonly probe: boolean;
  readonly epoch: number;
}

export type CircuitTransition = 'OPENED' | 'CLOSED' | 'PROBE_FAILED';

export interface AugmentationCircuitOptions {
  /** 연속 인프라 실패가 이 값 이상이면 개방한다. */
  readonly threshold: number;
  /** 개방 유지 시간(ms). */
  readonly openMs: number;
  /** 탐침 임대(ms) — 탐침이 기록 없이 사라진 경우 이 시간 뒤에 다음 호출을 새 탐침으로 허용한다. 기본 = `openMs`. */
  readonly probeLeaseMs?: number;
  /** 시계 주입(시험용). 기본 `Date.now`. */
  readonly now?: () => number;
  /** 상태 전이 때만 호출된다(로그용 — 문장·URL·키를 싣지 않는다). */
  readonly onTransition?: (event: CircuitTransition, info: { failures: number; openMs: number }) => void;
}

export class AugmentationCircuit {
  private readonly threshold: number;
  private readonly openMs: number;
  private readonly probeLeaseMs: number;
  private readonly now: () => number;
  private readonly onTransition?: AugmentationCircuitOptions['onTransition'];

  private failures = 0;
  /** 0 = 한 번도 열리지 않았거나 닫힘. 양수이고 `now >= openUntil`이면 half-open. */
  private openUntil = 0;
  private epoch = 0;
  private probe: CircuitPermit | null = null;
  private probeStartedAt = 0;

  constructor(options: AugmentationCircuitOptions) {
    this.threshold = Math.max(1, options.threshold);
    this.openMs = options.openMs;
    this.probeLeaseMs = options.probeLeaseMs ?? options.openMs;
    this.now = options.now ?? Date.now;
    this.onTransition = options.onTransition;
  }

  /** 읽기 전용 — 개방 시간 안인가(탐침을 소모하지 않는다. capability 보고용). half-open은 "열려 있지 않음"으로 본다. */
  isOpen(): boolean {
    return this.now() < this.openUntil;
  }

  /** 호출 전 확인. `null`이면 거부(호출하지 않고 `CIRCUIT_OPEN`). 통과하면 허가증을 돌려주며 호출 뒤 반드시 `record()`한다. */
  tryAcquire(): CircuitPermit | null {
    const now = this.now();
    if (now < this.openUntil) return null;
    if (this.openUntil > 0) {
      // half-open — 탐침 1건만 통과시킨다(임대가 끝나면 새 탐침 허용).
      if (this.probe && now - this.probeStartedAt < this.probeLeaseMs) return null;
      const permit: CircuitPermit = { probe: true, epoch: this.epoch };
      this.probe = permit;
      this.probeStartedAt = now;
      return permit;
    }
    return { probe: false, epoch: this.epoch };
  }

  /** 호출 결과 기록. 옛 세대(개방·닫힘 전에 시작된) 허가증의 결과는 무시한다. */
  record(permit: CircuitPermit, outcome: CircuitOutcome): void {
    if (permit.probe) {
      if (this.probe !== permit) return; // 임대가 끝나 새 탐침으로 교체됨
      this.probe = null;
      // 탐침 중립(4xx·형식 오류·출구 차단)은 회복 근거가 아니다 — 임대만 풀고 상태는 그대로 둔다(다음 호출이 다시 탐침이 된다).
      if (outcome === 'neutral') return;
      if (outcome === 'infra') {
        this.openUntil = this.now() + this.openMs;
        this.epoch += 1;
        this.onTransition?.('PROBE_FAILED', { failures: this.failures, openMs: this.openMs });
      } else {
        this.failures = 0;
        this.openUntil = 0;
        this.epoch += 1;
        this.onTransition?.('CLOSED', { failures: 0, openMs: this.openMs });
      }
      return;
    }
    if (permit.epoch !== this.epoch) return;
    if (outcome === 'success') {
      this.failures = 0;
    } else if (outcome === 'infra') {
      this.failures += 1;
      if (this.failures >= this.threshold) {
        this.openUntil = this.now() + this.openMs;
        this.epoch += 1;
        this.onTransition?.('OPENED', { failures: this.failures, openMs: this.openMs });
      }
    }
  }
}

/**
 * 호출 결과의 원인 코드·HTTP 상태를 회로 분류로 바꾼다(설계 §5.3 — 공급자 공통).
 * 인프라 실패: TIMEOUT·NETWORK·HTTP_5XX·HTTP 429. 중립: 그 밖의 HTTP_4XX·INVALID_RESPONSE·EGRESS_BLOCKED(정책·계약 오류).
 * 성공(원인 없음)은 호출부가 `'success'`로 직접 기록한다. 호출 자체가 없는 원인(NOT_CONFIGURED·SEED_BLOCKED·CIRCUIT_OPEN)은 회로를 건드리지 않는다.
 */
export function classifyCircuitFailure(cause: AugmentationFailureCause, httpStatus?: number): CircuitOutcome {
  if (cause === 'TIMEOUT' || cause === 'NETWORK' || cause === 'HTTP_5XX') return 'infra';
  if (cause === 'HTTP_4XX') return httpStatus === 429 ? 'infra' : 'neutral';
  return 'neutral';
}
