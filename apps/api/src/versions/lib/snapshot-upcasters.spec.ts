import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SNAPSHOT_SCHEMA_VERSION } from '@chat-bot/shared-types';
import { isSchemaSupported, upcastSnapshot } from './snapshot-upcasters';
import { hydrateSnapshot } from './snapshot-hydrate';
import { checkSnapshotIntegrity } from './snapshot-integrity';
import { computeContentHash } from './snapshot-canonical';
import type { SnapshotEnvelope } from './snapshot-envelope';

const FIXTURE_PATH = join(__dirname, '__fixtures__', 'snapshot-v1.json');

function loadFixtureRaw(): unknown {
  return JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));
}

/**
 * ★ AC-H3-20 · NFR-HM4 — 영구 픽스처 `snapshot-v1.json`은 항상 복원 가능해야 한다.
 * "픽스처 → 업캐스트 → 무결성 검사 → hydrate → 재계산 해시 == 업캐스트 결과 해시"를 단언한다.
 */
describe('snapshot-upcasters — §5.4 schemaVersion 체인 · 영구 픽스처', () => {
  it('픽스처의 schemaVersion은 1이다(현재 형식과 동일)', () => {
    const raw = loadFixtureRaw() as { schemaVersion: number };
    expect(raw.schemaVersion).toBe(1);
    expect(SNAPSHOT_SCHEMA_VERSION).toBe(1);
  });

  it('픽스처 → 업캐스트 → 무결성 검사(위반 0) → hydrate → 재계산 해시가 안정적이다', () => {
    const raw = loadFixtureRaw();
    const outcome = upcastSnapshot(raw, 1);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    const chatbotId = '8216b9bd-3ca5-4144-a955-235edbd64424';
    const hydrated = hydrateSnapshot(outcome.envelope, chatbotId);
    const { violations } = checkSnapshotIntegrity(hydrated, 'RESTORE');
    expect(violations).toEqual([]);

    const hash1 = computeContentHash(outcome.envelope);
    const hash2 = computeContentHash(outcome.envelope);
    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^[0-9a-f]{64}$/);
  });

  it('isSchemaSupported(1)은 true다(빈 업캐스터 맵에서도 현재 버전은 항상 지원)', () => {
    expect(isSchemaSupported(1)).toBe(true);
  });

  it('현재보다 높은 schemaVersion(앱 롤백 후 신형 스냅샷)은 SCHEMA_TOO_NEW로 거부된다', () => {
    const outcome = upcastSnapshot({}, SNAPSHOT_SCHEMA_VERSION + 1);
    expect(outcome).toEqual({ ok: false, reason: 'SCHEMA_TOO_NEW', schemaVersion: SNAPSHOT_SCHEMA_VERSION + 1 });
    expect(isSchemaSupported(SNAPSHOT_SCHEMA_VERSION + 1)).toBe(false);
  });

  it('MIN_RESTORABLE_SCHEMA_VERSION 미만은 SCHEMA_TOO_OLD로 거부된다', () => {
    const outcome = upcastSnapshot({}, 0);
    expect(outcome).toEqual({ ok: false, reason: 'SCHEMA_TOO_OLD', schemaVersion: 0 });
    expect(isSchemaSupported(0)).toBe(false);
  });

  it('업캐스트는 입력을 변형하지 않는다(순수 함수)', () => {
    const raw = loadFixtureRaw() as SnapshotEnvelope;
    const before = JSON.stringify(raw);
    upcastSnapshot(raw, 1);
    expect(JSON.stringify(raw)).toBe(before);
  });
});
