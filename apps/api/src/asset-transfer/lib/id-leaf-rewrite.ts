import { isUuidLike } from '../../dialogue-common/lib/asset-ref-graph';

/**
 * `json` 안의 문자열 잎 중 `sourceIdSet`(원본 챗봇의 전 자산·설문 id)에 속한 값만 `remap`으로 바꾼다
 * (topic-system-설계.md §9.5). `connectionId`(전역)·자유 텍스트·v1 설문 키는 `sourceIdSet`에 없어
 * 그대로 남는다. 맵에 없는 원본 id 잎을 만나면 원본 그대로 두고 `transfer-verify.ts`가 위반으로 잡는다.
 */
export function rewriteIdLeaves(value: unknown, remap: ReadonlyMap<string, string>, sourceIdSet: ReadonlySet<string>): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map((v) => rewriteIdLeaves(v, remap, sourceIdSet));
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(obj)) out[key] = rewriteIdLeaves(obj[key], remap, sourceIdSet);
    return out;
  }
  if (isUuidLike(value) && sourceIdSet.has(value)) {
    return remap.get(value) ?? value;
  }
  return value;
}
