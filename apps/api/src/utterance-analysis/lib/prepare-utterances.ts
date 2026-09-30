import { normalizeText } from '@chat-bot/shared-types';
import type { UtteranceAnalysisCounts, UtteranceExclusionReason } from '@chat-bot/shared-types';
import { MASK_TOKEN_PATTERNS, stripMaskTokens } from './mask-tokens';

/**
 * 발화 행 정리 · 병합 · 제외 · 마스킹(No.21 — 설계서 §7.2). DB·Nest 무의존 순수 함수(마스킹 부품은 인자로 받는다).
 *
 * ★ DC-7 — **`MaskedUtteranceText` 브랜드를 만드는 곳은 이 파일의 `maskUtterance()` 1개뿐이다**(`ValidatedLegacyRequest`
 * 선례). 저장 코드(`AnalyzedUtterance.text`·`sourceMemo`)는 `MaskedUtteranceText`만 받으므로 마스킹을 건너뛴 저장 코드는
 * 컴파일되지 않는다(정적 검사 UA-7이 `as MaskedUtteranceText` 위치를 단언한다).
 */

/** 금지어 → PII 마스킹을 모두 거친 문자열. 이 브랜드를 만드는 함수는 `maskUtterance()` 하나뿐이다. */
export type MaskedUtteranceText = string & { readonly __brand: 'MaskedUtteranceText' };

export interface MaskDeps {
  /** 금지어 마스킹(전역 사전 — `BannedWordFilterService.maskPlainText`). */
  readonly maskBanned: (text: string) => Promise<string>;
  /** PII 마스킹(`maskPii(text).maskedText` — 설치 모드 따름). */
  readonly maskPii: (text: string) => string;
}

export interface MaskOutcome {
  readonly text: MaskedUtteranceText;
  /** 금지어 마스킹으로 문자열이 바뀜. */
  readonly hasBannedWord: boolean;
  /** PII 마스킹으로 문자열이 바뀜. */
  readonly piiMasked: boolean;
}

/** §7.2 1단계 — 앞뒤 공백 제거 · 줄바꿈·탭 → 공백 · 제어문자 제거 · NFC. */
export function cleanCell(value: string): string {
  return value
    .replace(/[\r\n\t]+/g, ' ')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, '')
    .normalize('NFC')
    .trim();
}

/**
 * ★ `MaskedUtteranceText` 발급 유일 지점 — 금지어 마스킹 → PII 마스킹 순서(대화 로그 `record()`와 같은 부품·같은 순서, FR-12-45).
 * 입력은 이미 `cleanCell()`을 거친 문자열이어야 한다.
 */
export async function maskUtterance(cleaned: string, deps: MaskDeps): Promise<MaskOutcome> {
  const afterBanned = await deps.maskBanned(cleaned);
  const afterPii = deps.maskPii(afterBanned);
  return { text: afterPii as MaskedUtteranceText, hasBannedWord: afterBanned !== cleaned, piiMasked: afterPii !== afterBanned };
}

/** 마스킹본을 앞에서 자른다 — 마스킹은 이미 끝났으므로 브랜드가 유지된다(길이만 줄어든다). */
export function truncateMasked(text: MaskedUtteranceText, max: number): MaskedUtteranceText {
  return text.slice(0, max) as MaskedUtteranceText;
}

export interface RawUtteranceRow {
  /** 1-기반 파일 행 번호(머리글 포함) — 진단용, 저장하지 않는다. */
  readonly rowNumber: number;
  readonly utterance: string;
  readonly countCell: string;
  readonly memoCell: string;
}

export interface PrepareOptions {
  /** 발화 길이 상한(마스킹 후). */
  readonly maxChars: number;
  /** 메모 길이 상한(기본 100). */
  readonly memoMaxChars?: number;
  /** 긴 입력에서 이벤트 루프를 양보하는 훅(행 500개마다). */
  readonly yieldEvery?: () => Promise<void>;
}

export interface PreparedUtterance {
  readonly text: MaskedUtteranceText;
  /** `normalizeText(마스킹본)` — 병합·정렬 키. */
  readonly normalized: string;
  readonly count: number;
  readonly memo: MaskedUtteranceText | null;
  readonly hasBannedWord: boolean;
  /** 마스킹 표식(`[전화번호]`·`***` 등)이 문장에 남아 있다. */
  readonly hasMaskToken: boolean;
}

export interface PrepareResult {
  /** 병합 후 고유 발화(입력 행 순서 — 호출부가 정규화 문자열 오름차순으로 다시 정렬한다). */
  readonly utterances: readonly PreparedUtterance[];
  readonly counts: UtteranceAnalysisCounts;
}

const COUNT_MIN = 1;
const COUNT_MAX = 1_000_000;

/** 마스킹 표식이 문장에 있는가(패턴은 `g` 플래그를 떼어 상태 없이 검사). */
export function containsMaskToken(text: string): boolean {
  return MASK_TOKEN_PATTERNS.some((re) => new RegExp(re.source).test(text));
}

/** §7.2 5단계 — 표식·기호·숫자를 뺀 "내용 글자"(문자 카테고리 L)가 1개 이상인가. */
function hasContentLetters(masked: string): boolean {
  return /\p{L}/u.test(stripMaskTokens(masked));
}

function parseCount(cell: string): { value: number; invalid: boolean } {
  const trimmed = cell.trim();
  if (trimmed === '') return { value: 1, invalid: false }; // 빈 셀 = 기본 1(오류 아님)
  if (!/^\d+$/.test(trimmed)) return { value: 1, invalid: true };
  const n = Number(trimmed);
  if (!Number.isSafeInteger(n) || n < COUNT_MIN || n > COUNT_MAX) return { value: 1, invalid: true };
  return { value: n, invalid: false };
}

/**
 * §7.2 순서 1~9. `validCount`는 **병합 후 고유 발화 수**(군집 대상), `mergedCount`는 병합으로 사라진 행 수,
 * `occurrenceTotal`은 유효 행의 발생 횟수 합이다.
 */
export async function prepareUtterances(rows: readonly RawUtteranceRow[], deps: MaskDeps, options: PrepareOptions): Promise<PrepareResult> {
  const memoMax = options.memoMaxChars ?? 100;
  const excluded: Record<UtteranceExclusionReason, number> = { EMPTY: 0, TOO_LONG: 0, TOO_SHORT: 0, NO_CONTENT: 0 };
  const byKey = new Map<string, { item: PreparedUtterance; order: number }>();
  let maskedRowCount = 0;
  let bannedRowCount = 0;
  let invalidCountRows = 0;
  let occurrenceTotal = 0;
  let validRows = 0;

  let index = 0;
  for (const row of rows) {
    index += 1;
    if (options.yieldEvery && index % 500 === 0) await options.yieldEvery();

    // 1
    const cleaned = cleanCell(row.utterance);
    if (cleaned === '') {
      excluded.EMPTY += 1;
      continue;
    }
    // 2·3
    const masked = await maskUtterance(cleaned, deps);
    // 4
    if (masked.text.length > options.maxChars) {
      excluded.TOO_LONG += 1;
      continue;
    }
    // 5
    if (!hasContentLetters(masked.text)) {
      excluded.NO_CONTENT += 1;
      continue;
    }
    // 6
    const normalized = normalizeText(masked.text);
    if (normalized.length < 2) {
      excluded.TOO_SHORT += 1;
      continue;
    }
    // 7
    const { value: count, invalid } = parseCount(row.countCell);
    if (invalid) invalidCountRows += 1;
    // 8 — 메모도 1·2·3을 같게 적용 후 절단
    let memo: MaskedUtteranceText | null = null;
    const memoCleaned = cleanCell(row.memoCell);
    if (memoCleaned !== '') {
      const memoMasked = await maskUtterance(memoCleaned, deps);
      const truncated = memoMasked.text.slice(0, memoMax);
      // 절단은 마스킹 이후이므로 브랜드가 유지된다(길이만 줄어든다).
      memo = truncated === '' ? null : (truncated as MaskedUtteranceText);
    }

    validRows += 1;
    occurrenceTotal += count;
    if (masked.piiMasked) maskedRowCount += 1;
    if (masked.hasBannedWord) bannedRowCount += 1;

    // 9 — 병합(대표 표기 = 먼저 나온 행 · 메모 = 먼저 나온 비어 있지 않은 메모 · 플래그 OR)
    const hasMaskToken = containsMaskToken(masked.text);
    const existing = byKey.get(normalized);
    if (existing) {
      const prev = existing.item;
      existing.item = {
        text: prev.text,
        normalized,
        count: prev.count + count,
        memo: prev.memo ?? memo,
        hasBannedWord: prev.hasBannedWord || masked.hasBannedWord,
        hasMaskToken: prev.hasMaskToken || hasMaskToken,
      };
    } else {
      byKey.set(normalized, {
        order: byKey.size,
        item: { text: masked.text, normalized, count, memo, hasBannedWord: masked.hasBannedWord, hasMaskToken },
      });
    }
  }

  const utterances = [...byKey.values()].sort((a, b) => a.order - b.order).map((v) => v.item);
  return {
    utterances,
    counts: {
      totalRows: rows.length,
      validCount: utterances.length,
      mergedCount: validRows - utterances.length,
      excluded,
      maskedRowCount,
      bannedRowCount,
      invalidCountRows,
      occurrenceTotal,
    },
  };
}

/**
 * 업로드 파일 이름 마스킹(§7.2 끝) — 경로 제거 → 제어문자 제거 → 금지어·PII 마스킹 → 120자 절단.
 * 결과는 `MaskedUtteranceText`가 아니라 일반 문자열로 돌려준다(이름은 문장이 아니므로 브랜드 범위 밖 — DB `fileName`은 string).
 */
export async function maskFileName(original: string, deps: MaskDeps): Promise<string> {
  const base = original.replace(/\\/g, '/').split('/').pop() ?? '';
  const cleaned = cleanCell(base);
  const masked = await maskUtterance(cleaned === '' ? 'upload' : cleaned, deps);
  return masked.text.slice(0, 120);
}
