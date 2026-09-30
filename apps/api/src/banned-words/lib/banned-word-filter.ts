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
 * 보이지 않는(서식·삽입용) 문자 — 글자 사이에 끼워 탐지를 피하는 회피(N36-2)를 막기 위해 탐지 전에 제거한다.
 * `\p{Cf}`(U+200B-200F·202A-202E·2060-2064·FEFF·00AD 등) + U+034F + 변형 선택자(FE00-FE0F) + 한글 채움 문자(115F·1160·3164).
 * 한글 자모 결합 표시(Mn)는 건드리지 않는다.
 *
 * ⚠ 공유 `normalizeText`(shared-types)는 고치지 않는다 — 그 결과는 DB 정규화 컬럼·임베딩 해시·스냅샷 무결성의
 * 입력이라 바꾸면 재색인이 필요하다. 이 제거는 **탐지·마스킹 경로에서만** 로컬로 적용한다(저장값 영향 0).
 */
// \uC81C\uAC70 \uC9D1\uD569\uC758 \uB2E8\uC77C \uC6D0\uCC9C \u2014 detect(normalizeForDetect)\uC640 maskText\uAC00 \uAC19\uC740 \uC9D1\uD569\uC744 \uC4F4\uB2E4. U+FFA0(\uBC18\uAC01 \uD55C\uAE00 \uCC44\uC6C0)\uC740 NFKC\uAC00
// U+1160\uC744 \uB9CC\uB4E4\uC5B4, NFKC \uC804\uC5D0\uB9CC \uC81C\uAC70\uD558\uB358 \uB9C8\uC2A4\uD0B9\uC5D0\uC11C \uB0A8\uC544 \uAE08\uC9C0\uC5B4\uAC00 \uB178\uCD9C\uB418\uB358 \uBE44\uB300\uCE6D(N36-2 \uB9AC\uBDF0 \uBCF4\uD1B5-2)\uC744 \uB9C9\uAE30 \uC704\uD574 \uD3EC\uD568\uD55C\uB2E4.
const INVISIBLE_CLASS = '[\\p{Cf}\\u034F\\uFE00-\\uFE0F\\u115F\\u1160\\u3164\\uFFA0]';
const INVISIBLE_TEST = new RegExp(INVISIBLE_CLASS, 'u');
const INVISIBLE_ALL = new RegExp(INVISIBLE_CLASS, 'gu');

function stripInvisible(text: string): string {
  return INVISIBLE_TEST.test(text) ? text.replace(INVISIBLE_ALL, '') : text;
}

/**
 * 탐지용 정규화 — `normalizeText` 앞뒤로 보이지 않는 문자를 제거한다. **앞**에서 제거하는 이유: `normalizeText`의
 * `\s` 치환이 U+FEFF를 공백으로 바꿔 토큰을 갈라 버리기 때문이다. 뒤 제거는 NFKC가 만든 잔여분(예: U+3164→U+1160)용이다.
 * 보이지 않는 문자가 없으면 `normalizeText`와 결과가 같다.
 */
export function normalizeForDetect(text: string): string {
  return stripInvisible(normalizeText(stripInvisible(text)));
}

// 사전 항목별 탐지용 표현 캐시 — 항목 객체(캐시된 사전)당 1회만 계산한다. 저장값(wordNormalized)은 그대로 둔다.
const needleCache = new WeakMap<BannedWordEntry, string>();

/**
 * 사전 항목의 탐지용 표현. 원문 `word`에 보이지 않는 문자가 있으면 그것을 기준으로 다시 정규화하고(저장된
 * `wordNormalized`는 FEFF가 공백으로 바뀌어 있을 수 있다), 없으면 저장값을 그대로 쓴다(기존 동작과 바이트 동일).
 * 보이지 않는 문자만으로 된 항목은 빈 문자열이 되며 호출부에서 건너뛴다(빈 needle은 모든 입력에 적중하므로).
 */
function needleOf(entry: BannedWordEntry): string {
  const cached = needleCache.get(entry);
  if (cached !== undefined) return cached;
  const needle = INVISIBLE_TEST.test(entry.word) || INVISIBLE_TEST.test(entry.wordNormalized)
    ? normalizeForDetect(INVISIBLE_TEST.test(entry.word) ? entry.word : entry.wordNormalized)
    : entry.wordNormalized;
  needleCache.set(entry, needle);
  return needle;
}

/**
 * 금지어 판정 순수 함수(DB·Nest 무의존, FR-12-43). 사전 0건이면 정규화조차 하지 않고
 * 즉시 반환한다(FR-12-46, NFR-P6). 정규식은 받지 않는다 — 리터럴 문자열/토큰 비교뿐이다(NFR-S12).
 */
export function detect(text: string, dict: readonly BannedWordEntry[]): BannedWordEntry[] {
  if (dict.length === 0) return [];
  const normalized = normalizeForDetect(text);
  if (!normalized) return [];
  const tokens = new Set(normalized.split(' '));

  const matches: BannedWordEntry[] = [];
  for (const entry of dict) {
    const needle = needleOf(entry);
    if (!needle) continue; // 빈 표현(보이지 않는 문자만 남은 항목 포함)은 모든 입력에 적중하므로 건너뛴다.
    if (entry.matchType === 'EXACT') {
      if (tokens.has(needle)) matches.push(entry);
    } else if (normalized.includes(needle)) {
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

  // 보이지 않는 문자가 있으면 그것을 뺀 사본에서 위치를 찾고, `keptIndex`로 원문 인덱스에 되돌린다(N36-2).
  // 없으면 기존 경로(1:1 인덱스)를 그대로 쓴다 — 바이트 불변.
  let keptIndex: number[] | null = null;
  let base = text;
  if (INVISIBLE_TEST.test(text)) {
    keptIndex = [];
    let kept = '';
    let pos = 0;
    for (const ch of text) {
      if (!INVISIBLE_TEST.test(ch)) {
        for (let k = 0; k < ch.length; k += 1) keptIndex.push(pos + k);
        kept += ch;
      }
      pos += ch.length;
    }
    base = kept;
  }

  const haystack = base.normalize('NFKC').toLowerCase();
  // `indexOf`는 UTF-16 코드유닛 기준 인덱스를 반환하므로, 배열도 동일 기준(`split('')`)으로 맞춘다.
  const chars = text.split('');

  for (const match of matches) {
    const needle = needleOf(match);
    if (!needle) continue;
    let searchFrom = 0;
    for (;;) {
      const idx = haystack.indexOf(needle, searchFrom);
      if (idx === -1) break;
      const end = Math.min(idx + needle.length, keptIndex ? keptIndex.length : chars.length);
      if (keptIndex) {
        // 첫·끝 적중 글자의 원문 위치 사이를 가린다(사이에 끼어든 보이지 않는 문자 포함).
        if (idx < end) {
          const from = keptIndex[idx];
          const to = keptIndex[end - 1];
          for (let i = from; i <= to && i < chars.length; i += 1) chars[i] = '*';
        }
      } else {
        for (let i = idx; i < end; i += 1) chars[i] = '*';
      }
      searchFrom = idx + needle.length;
    }
  }
  return chars.join('');
}
