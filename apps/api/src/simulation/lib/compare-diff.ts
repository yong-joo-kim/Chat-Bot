import type { CompareDiff } from '@chat-bot/shared-types';
import type { DialogOutput } from '@chat-bot/shared-types';

/** 아웃풋 배열을 키 정렬 + `undefined` 제거 형태로 정규화한다(FR-10-27). */
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
