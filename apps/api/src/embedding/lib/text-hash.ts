import { createHash } from 'node:crypto';
import { normalizeText } from '@chat-bot/dialogue-engine';

/** 정규화 텍스트의 sha256 — 재임베딩 회피 키(FR-N1-19). 값이 같으면 재임베딩하지 않는다. */
export function textHashOf(rawText: string): string {
  return createHash('sha256').update(normalizeText(rawText), 'utf8').digest('hex');
}
