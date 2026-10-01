import { SPEECH_LIMITS } from '@chat-bot/shared-types';
import { KOREAN_DIGIT_SYLLABLES, normalizeKoreanDigits } from './korean-digits';

/**
 * [신규 No.32] 인식 글자 후처리(voice-ai-설계.md §7.4 · DD-131) — 공급자 무관(API 쪽 1벌). 순수 — DB·Nest·시계 무의존.
 * ① 앞뒤·연속 공백·제어 문자 정리 ② 반복 고리 축약(같은 구절 2~30자 연속 3회 이상 → 1회) ③ 상투 문장(환각) 전체 일치 → 빈 글자
 * ④ 한글 숫자 정규화 ⑤ 2,000자 상한. **금지어·개인정보 처리는 하지 않는다**(FR-VO2-9 — 전송 시 기존 대화 경로가 한다).
 */

/**
 * 상투 문장(무음 환각) 목록 — **1차 비어 있다**(K-7). ml-engineer가 3050 동작 확인 결과로 제안하면 코드 상수로 넣는다
 * (모델 교체 시 재검토). 구조만 마련: 전사 **전체**가 목록 문장과 정규화 일치할 때만 빈 글자로 바꾼다.
 */
export const HALLUCINATION_PHRASES: readonly string[] = [];

const REPEAT_MIN_UNIT = 2;
const REPEAT_MAX_UNIT = 30;
const REPEAT_MIN_TIMES = 3;
/** 반복 검사 입력 상한 — 비정상적으로 긴 전사가 와도 검사 비용이 입력 길이에 선형으로 묶이게 한다. */
const REPEAT_SCAN_MAX_CHARS = 20_000;

function normalizeForPhraseMatch(text: string): string {
  return text.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
}

export function isHallucinatedPhrase(text: string, phrases: readonly string[] = HALLUCINATION_PHRASES): boolean {
  if (phrases.length === 0) return false;
  const normalized = normalizeForPhraseMatch(text);
  if (normalized.length === 0) return false;
  return phrases.some((p) => normalizeForPhraseMatch(p) === normalized);
}

/** 반복 단위가 아라비아 숫자·한글 숫자 음절·공백·하이픈뿐이면 true — 축약 제외 대상. */
function isNumericUnit(phrase: string): boolean {
  for (const ch of phrase) {
    if (!(ch in KOREAN_DIGIT_SYLLABLES) && !/[0-9\s-]/.test(ch)) return false;
  }
  return true;
}

/** 같은 구절(2~30자)이 연속 3회 이상 반복되면 1회로 줄인다. 한 번의 왼쪽→오른쪽 주사 + 안정될 때까지 최대 3회 반복. */
export function collapseRepetitions(input: string): string {
  let current = input.length > REPEAT_SCAN_MAX_CHARS ? input.slice(0, REPEAT_SCAN_MAX_CHARS) : input;
  for (let pass = 0; pass < 3; pass += 1) {
    let out = '';
    let i = 0;
    let changed = false;
    while (i < current.length) {
      let collapsed = false;
      const maxUnit = Math.min(REPEAT_MAX_UNIT, Math.floor((current.length - i) / REPEAT_MIN_TIMES));
      for (let unit = REPEAT_MIN_UNIT; unit <= maxUnit; unit += 1) {
        const phrase = current.slice(i, i + unit);
        if (phrase.trim().length === 0) continue;
        if (isNumericUnit(phrase)) continue; // 숫자열("일일일일 …"·"0000 0000")은 반복 고리가 아니라 실제 번호일 수 있다(M-2)
        let times = 1;
        while (current.startsWith(phrase, i + times * unit)) times += 1;
        if (times >= REPEAT_MIN_TIMES) {
          out += phrase;
          i += times * unit;
          collapsed = true;
          changed = true;
          break;
        }
      }
      if (!collapsed) {
        out += current[i];
        i += 1;
      }
    }
    current = out;
    if (!changed) break;
  }
  return current;
}

export interface CleanedTranscript {
  /** 정리 결과 — 빈 글자면 호출자가 `EMPTY`로 취급한다. */
  readonly text: string;
}

export function cleanupTranscript(raw: string, hallucinations: readonly string[] = HALLUCINATION_PHRASES): CleanedTranscript {
  // eslint-disable-next-line no-control-regex
  let text = raw.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/[ \u00a0]+/g, ' ').trim();
  if (text.length === 0) return { text: '' };

  text = collapseRepetitions(text).replace(/ {2,}/g, ' ').trim();
  if (isHallucinatedPhrase(text, hallucinations)) return { text: '' };

  text = normalizeKoreanDigits(text);
  if (text.length > SPEECH_LIMITS.transcriptMaxChars) text = text.slice(0, SPEECH_LIMITS.transcriptMaxChars).trim();
  return { text };
}
