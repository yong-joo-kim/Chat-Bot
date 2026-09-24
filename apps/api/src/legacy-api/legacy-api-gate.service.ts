import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { API_CONNECTION_LIMITS } from '@chat-bot/shared-types';
import type { CircuitClass } from './lib/outcome-class';

interface ConnectionGateState {
  consecutiveInfraFailures: number;
  openUntil: number;
  halfOpenProbeInFlight: boolean;
  windowStart: number;
  count: number;
  inFlight: number;
}

export type AcquireResult = { ok: true } | { ok: false; outcome: 'CIRCUIT_OPEN' | 'RATE_LIMITED' };

/**
 * [No.26] 탄력성 — 연결 단위 회로차단·레이트·동시성(인스턴스 로컬, §7.6). 인터페이스 1곳(`ApiConnectionGateStore`
 * 역할을 이 클래스가 직접 담당 — 다중 인스턴스 확장 시 이 파일만 교체하면 된다, ADR-0034 §11 K-2).
 * 연결 테스트는 `bypass: true`로 회로·레이트를 우회하고 동시성만 점유한다(§21 D-14).
 */
@Injectable()
export class LegacyApiGateService {
  private readonly states = new Map<string, ConnectionGateState>();
  private globalInFlight = 0;

  constructor(private readonly config: ConfigService) {}

  private stateFor(connectionId: string): ConnectionGateState {
    let s = this.states.get(connectionId);
    if (!s) {
      s = { consecutiveInfraFailures: 0, openUntil: 0, halfOpenProbeInFlight: false, windowStart: Date.now(), count: 0, inFlight: 0 };
      this.states.set(connectionId, s);
    }
    return s;
  }

  isCircuitOpen(connectionId: string): boolean {
    const s = this.states.get(connectionId);
    if (!s) return false;
    return Date.now() < s.openUntil;
  }

  tryAcquire(connectionId: string, rateLimitPerMin: number, opts: { bypass?: boolean } = {}): AcquireResult {
    const s = this.stateFor(connectionId);
    const now = Date.now();

    if (!opts.bypass) {
      if (s.openUntil > 0) {
        if (now < s.openUntil) {
          // 개방 시간이 아직 남아 있다 — 전부 거부(half-open 탐침은 개방 시간이 지난 뒤에만 나간다).
          return { ok: false, outcome: 'CIRCUIT_OPEN' };
        }
        if (s.halfOpenProbeInFlight) {
          // 이미 탐침 1건이 나가 있다 — 결과가 오기 전까지 다른 요청은 대기 없이 거부한다.
          return { ok: false, outcome: 'CIRCUIT_OPEN' };
        }
        s.halfOpenProbeInFlight = true; // 개방 시간이 지난 뒤 첫 요청만 탐침으로 통과시킨다.
      }

      if (now - s.windowStart >= 60_000) {
        s.windowStart = now;
        s.count = 0;
      }
      if (s.count >= rateLimitPerMin) return { ok: false, outcome: 'RATE_LIMITED' };
    }

    if (s.inFlight >= API_CONNECTION_LIMITS.concurrencyPerConnection) return { ok: false, outcome: 'RATE_LIMITED' };
    if (this.globalInFlight >= API_CONNECTION_LIMITS.concurrencyGlobal) return { ok: false, outcome: 'RATE_LIMITED' };

    if (!opts.bypass) s.count += 1;
    s.inFlight += 1;
    this.globalInFlight += 1;
    return { ok: true };
  }

  release(connectionId: string, classification: CircuitClass, opts: { bypass?: boolean } = {}): void {
    const s = this.stateFor(connectionId);
    s.inFlight = Math.max(0, s.inFlight - 1);
    this.globalInFlight = Math.max(0, this.globalInFlight - 1);
    if (opts.bypass) return;

    const openMs = this.config.get<number>('LEGACY_API_CIRCUIT_OPEN_MS') ?? 60_000;
    const threshold = this.config.get<number>('LEGACY_API_CIRCUIT_FAILURE_THRESHOLD') ?? 5;

    if (s.halfOpenProbeInFlight) {
      s.halfOpenProbeInFlight = false;
      if (classification === 'ALIVE') {
        s.consecutiveInfraFailures = 0;
        s.openUntil = 0;
      } else if (classification === 'INFRA_FAILURE') {
        s.openUntil = Date.now() + openMs;
      }
      return;
    }

    if (classification === 'ALIVE') {
      s.consecutiveInfraFailures = 0;
    } else if (classification === 'INFRA_FAILURE') {
      s.consecutiveInfraFailures += 1;
      if (s.consecutiveInfraFailures >= threshold) {
        s.openUntil = Date.now() + openMs;
      }
    }
    // NEUTRAL — 변화 없음
  }
}
