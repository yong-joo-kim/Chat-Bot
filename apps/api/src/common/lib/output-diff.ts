import type { CompareDiff, DialogOutput } from '@chat-bot/shared-types';

/**
 * 아웃풋 직렬화·차이 판정 순수 함수(FR-10-27, FR-0-62) — 원래 `simulation/lib/compare-diff.ts`에
 * 있었으나 검증/품질 고도화(No.19/20)의 실행기도 같은 판정이 필요해져 **소비자가 2곳**이 됐다
 * (`packages/pii-mask` 승격과 동일한 규약). `simulation/lib/compare-diff.ts`는 이 파일의
 * re-export만 남기며 동작 변경은 0건이다 — 기존 테스트는 무수정으로 통과한다.
 */
function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) {
      if (obj[key] === undefined) continue;
      sorted[key] = normalize(obj[key]);
    }
    return sorted;
  }
  return value;
}

export function serializeOutputsForDiff(outputs: DialogOutput[]): string {
  return JSON.stringify(outputs.map(normalize));
}

export interface DiffableTurn {
  outputs: DialogOutput[];
  matchedNodeId?: string;
  matchedFaqId?: string;
  matchedIntentId?: string;
}

/**
 * A/B 비교 실행의 차이 판정(FR-10-27). 순수 함수 — `trace`는 판정에 쓰지 않는다(같은 응답이어도
 * 경유 경로 차이로 노이즈가 될 수 있어서다, §8.8).
 */
export function compareDiff(a: DiffableTurn, b: DiffableTurn): CompareDiff {
  const outputsChanged = serializeOutputsForDiff(a.outputs) !== serializeOutputsForDiff(b.outputs);
  const matchChanged = a.matchedNodeId !== b.matchedNodeId || a.matchedFaqId !== b.matchedFaqId || a.matchedIntentId !== b.matchedIntentId;
  return { status: outputsChanged || matchChanged ? 'DIFFERENT' : 'SAME', outputsChanged, matchChanged };
}
