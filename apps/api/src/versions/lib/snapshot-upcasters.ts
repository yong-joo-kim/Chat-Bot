import { MIN_RESTORABLE_SCHEMA_VERSION, SNAPSHOT_SCHEMA_VERSION } from '@chat-bot/shared-types';
import type { SnapshotEnvelope } from './snapshot-envelope';

/**
 * `schemaVersion` 체인(§5.4, FR-H1-12/13) — 순수 함수, 입력을 변형하지 않고 새 객체를 반환한다.
 * 키 `n`은 "`n` → `n+1`" 변환. 1차는 빈 맵(v1이 현재 형식). `schemaVersion`을 올릴 때 이 맵에
 * `n: (payload) => {...}`을 추가하고 `lib/__fixtures__/snapshot-v{n}.json`을 추가한다(기존 픽스처 유지).
 */
export const UPCASTERS: Record<number, (payload: unknown) => unknown> = {};

/** 목록/상세에서 payload를 열지 않고 `schemaVersion`만으로 복원 가능 여부를 판정한다(§16 V-7). */
export function isSchemaSupported(schemaVersion: number): boolean {
  if (schemaVersion > SNAPSHOT_SCHEMA_VERSION || schemaVersion < MIN_RESTORABLE_SCHEMA_VERSION) return false;
  for (let v = schemaVersion; v < SNAPSHOT_SCHEMA_VERSION; v += 1) {
    if (!UPCASTERS[v]) return false;
  }
  return true;
}

export type UpcastOutcome =
  | { ok: true; envelope: SnapshotEnvelope; upcastedFrom?: number }
  | { ok: false; reason: 'SCHEMA_TOO_OLD' | 'SCHEMA_TOO_NEW' | 'CHAIN_MISSING'; schemaVersion: number };

/**
 * 로드 순서(§5.4 ③): `MIN ≤ v < 현재`면 체인 적용 → `v < MIN` 또는 `v > 현재` 또는 체인 누락이면 거부.
 * `v === 현재`면 그대로 반환한다(해시 재검증은 호출자의 책임 — `version-payload.reader.ts`).
 */
export function upcastSnapshot(raw: unknown, schemaVersion: number): UpcastOutcome {
  if (schemaVersion === SNAPSHOT_SCHEMA_VERSION) {
    return { ok: true, envelope: raw as SnapshotEnvelope };
  }
  if (schemaVersion > SNAPSHOT_SCHEMA_VERSION) {
    return { ok: false, reason: 'SCHEMA_TOO_NEW', schemaVersion };
  }
  if (schemaVersion < MIN_RESTORABLE_SCHEMA_VERSION) {
    return { ok: false, reason: 'SCHEMA_TOO_OLD', schemaVersion };
  }

  let current = raw;
  for (let v = schemaVersion; v < SNAPSHOT_SCHEMA_VERSION; v += 1) {
    const upcaster = UPCASTERS[v];
    if (!upcaster) {
      return { ok: false, reason: 'CHAIN_MISSING', schemaVersion };
    }
    current = upcaster(current);
  }
  return { ok: true, envelope: current as SnapshotEnvelope, upcastedFrom: schemaVersion };
}
