import { globMatchAny } from './glob-match';

/**
 * [신규 No.43] 해시 대상 본문 정규화(순수 — §8.1 J-9). 잡음 줄(글롭 "줄 전체 일치") 제거 · 연속 공백
 * 축약 · 앞뒤 공백 제거. 해시는 이 정규화 결과(마스킹 전)로 계산한다.
 */
export function normalizeForHash(text: string, noisePatterns: readonly string[] = []): string {
  const lines = text.split('\n').map((l) => l.trim());
  const filtered = noisePatterns.length > 0 ? lines.filter((l) => !globMatchAny(noisePatterns, l)) : lines;
  return filtered
    .join('\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
