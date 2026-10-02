// [DT-2] 음성 확인 판정(설계 §9.8 · FR-DX4-6 · H-T23) — 정확도 판정이 아니라 "동작 확인"이다.
//   통과 = (일치율 ≥ 0.8 ∨ (핵심어 전부 포함 ∧ 일치율 ≥ 0.5)) ∧ 전송 시 기대 의도 답 — 핵심어 한 단어만 들려도 통과하는 것을 막는다(L-4)
// 정규화: NFC → 소문자 → 공백·문장부호·기호·제로폭 등 보이지 않는 서식 문자(Cf) 제거(띄어쓰기·마침표 차이를 흡수 — K0 정정 DX-3: "알려 주세요" ↔ "알려주세요.").

export const MATCH_RATIO_THRESHOLD = 0.8;
/** 핵심어 경로의 일치율 하한 — 핵심어만 맞고 나머지가 크게 다른 전사를 걸러 낸다. */
export const KEYWORD_PATH_MIN_RATIO = 0.5;

export function normalizeForMatch(s: string): string {
  return s.normalize('NFC').toLowerCase().replace(/[\p{P}\p{S}\p{Cf}\s]/gu, '');
}

/** 레벤슈타인 편집 거리(글자 단위 — 유니코드 코드 포인트). */
export function levenshtein(a: string, b: string): number {
  const x = [...a];
  const y = [...b];
  if (x.length === 0) return y.length;
  if (y.length === 0) return x.length;
  let prev = Array.from({ length: y.length + 1 }, (_, i) => i);
  for (let i = 1; i <= x.length; i++) {
    const cur = [i];
    for (let j = 1; j <= y.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[y.length];
}

/** `1 − 편집거리 / 최대 길이`(정규화 뒤) — 둘 다 비면 1. */
export function matchRatio(expected: string, actual: string): number {
  const e = normalizeForMatch(expected);
  const a = normalizeForMatch(actual);
  const max = Math.max([...e].length, [...a].length);
  if (max === 0) return 1;
  return 1 - levenshtein(e, a) / max;
}

export function keywordsAllIn(actual: string, keywords: readonly string[]): boolean {
  const a = normalizeForMatch(actual);
  return keywords.every((k) => a.includes(normalizeForMatch(k)));
}

export interface MatchJudgement {
  ratio: number;
  keywordsOk: boolean;
  /** 인식 글자 판정(일치율 또는 핵심어) — 의도 확인(intentOk)은 호출자가 더한다. */
  textOk: boolean;
}

export function judgeTranscript(expected: string, actual: string, keywords: readonly string[]): MatchJudgement {
  const ratio = matchRatio(expected, actual);
  const keywordsOk = keywords.length > 0 && keywordsAllIn(actual, keywords);
  return { ratio, keywordsOk, textOk: ratio >= MATCH_RATIO_THRESHOLD || (keywordsOk && ratio >= KEYWORD_PATH_MIN_RATIO) };
}
