import { z } from 'zod';

/**
 * [신규 2026-09-23 No.28] `z.coerce.boolean()`의 함정(§15 ⚠) — `Boolean("false") === true`라서
 * `=false`를 명시해도 `true`가 된다. 이 헬퍼는 `'true'|'false'|'1'|'0'`만 허용하는 명시 파서다.
 * 새 boolean 환경변수는 전부 이 헬퍼를 쓴다(기존 `TRUST_PROXY`·`CLASSIFIER_ENABLED`·
 * `VERSION_AUTO_SNAPSHOT_ENABLED`의 `z.coerce.boolean()` 교체는 이 그룹 범위 밖 — 별도 수정 건으로 권고).
 */
export function envBoolean(defaultValue: boolean) {
  return z.preprocess((v) => {
    if (v === undefined) return undefined;
    if (typeof v === 'boolean') return v;
    if (v === 'true' || v === '1') return true;
    if (v === 'false' || v === '0') return false;
    return v;
  }, z.boolean().default(defaultValue));
}
