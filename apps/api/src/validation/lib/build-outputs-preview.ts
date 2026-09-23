import type { DialogOutput } from '@chat-bot/shared-types';

const PREVIEW_LENGTH = 120;

/** 화면 미리보기 전용 120자 선두 텍스트(FR-V1-28) — 판정에 쓰이지 않는다. */
export function buildOutputsPreview(outputs: readonly DialogOutput[]): string {
  const first = outputs[0];
  if (!first) return '';
  const text = first.type === 'TEXT' ? first.payload.text : JSON.stringify(first.payload ?? {});
  return text.slice(0, PREVIEW_LENGTH);
}
