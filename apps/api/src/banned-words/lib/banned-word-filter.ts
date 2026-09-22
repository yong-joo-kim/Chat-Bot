import { normalizeText } from '@chat-bot/shared-types';
import type { BannedWordMatchType, BannedWordPolicy } from '@chat-bot/shared-types';

export interface BannedWordEntry {
  word: string;
  wordNormalized: string;
  matchType: BannedWordMatchType;
  policy: BannedWordPolicy;
}

export type BannedWordDecision = 'PASS' | 'WARN' | 'BLOCK';

/**
 * 금지어 판정 순수 함수(DB·Nest 무의존, FR-12-43). 사전 0건이면 정규화조차 하지 않고
 * 즉시 반환한다(FR-12-46, NFR-P6). 정규식은 받지 않는다 — 리터럴 문자열/토큰 비교뿐이다(NFR-S12).
 */
export function detect(text: string, dict: readonly BannedWordEntry[]): BannedWordEntry[] {
  if (dict.length === 0) return [];
  const normalized = normalizeText(text);
  if (!normalized) return [];
  const tokens = new Set(normalized.split(' '));

  const matches: BannedWordEntry[] = [];
  for (const entry of dict) {
    if (entry.matchType === 'EXACT') {
      if (tokens.has(entry.wordNormalized)) matches.push(entry);
    } else if (normalized.includes(entry.wordNormalized)) {
      matches.push(entry);
    }
  }
  return matches;
}

/** `BLOCK` 정책 단어가 하나라도 있으면 차단, 아니면 탐지 여부로 경고/통과를 가른다. */
export function decide(matches: readonly BannedWordEntry[]): BannedWordDecision {
  if (matches.some((m) => m.policy === 'BLOCK')) return 'BLOCK';
  if (matches.length > 0) return 'WARN';
  return 'PASS';
}

/**
 * 탐지된 단어를 `***`로 치환한다. NFKC+소문자만 적용한 사본에서 위치를 찾아 원문의 같은
 * 인덱스를 치환한다(연속공백 축약을 쓰지 않으므로 인덱스가 1:1로 보존된다).
 *
 * ⚠ 알려진 한계: 공백이 삽입된 변형(`X X`)은 탐지(=차단/경고)되지만 마스킹은 이 위치 탐색
 * 방식으로는 놓칠 수 있다. 차단이 우선 적용되므로 사용자에게 원문이 도달하지는 않는다(§10.1).
 */
export function maskText(text: string, matches: readonly BannedWordEntry[]): string {
  if (matches.length === 0) return text;
  const haystack = text.normalize('NFKC').toLowerCase();
  // `indexOf`는 UTF-16 코드유닛 기준 인덱스를 반환하므로, 배열도 동일 기준(`split('')`)으로 맞춘다.
  const chars = text.split('');

  for (const match of matches) {
    const needle = match.wordNormalized;
    if (!needle) continue;
    let searchFrom = 0;
    for (;;) {
      const idx = haystack.indexOf(needle, searchFrom);
      if (idx === -1) break;
      for (let i = idx; i < idx + needle.length && i < chars.length; i += 1) chars[i] = '*';
      searchFrom = idx + needle.length;
    }
  }
  return chars.join('');
}
