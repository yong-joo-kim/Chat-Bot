import type { DialogOutput } from '@chat-bot/shared-types';
import { findLegacyApiOutputIndexes } from '@chat-bot/shared-types';

/**
 * ★ [신규 No.45] v1(레거시) `API_CONDITION` 평문 헤더 잔존 판정 — 순수. 기존 v1 판정 함수
 * (`findLegacyApiOutputIndexes`, ADR-0034 §7)를 재사용해 헤더 값이 있는 v1 아웃풋만 "위험"으로 센다.
 */
export function nodeHasV1PlainHeader(outputs: readonly DialogOutput[]): boolean {
  const legacyIdx = findLegacyApiOutputIndexes(outputs as DialogOutput[]);
  return legacyIdx.some((i) => {
    const o = outputs[i];
    if (!o || o.type !== 'API_CONDITION') return false;
    const headers = (o.payload as { headers?: Record<string, string> }).headers;
    return !!headers && Object.keys(headers).length > 0;
  });
}
