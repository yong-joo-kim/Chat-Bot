import type { MorphAnalyzerPort } from '../../learning/morph/morph-analyzer.port';
import { DEFAULT_STOPWORDS } from '../../learning/lib/stopwords';
import { JOSA_ENDINGS } from '../../learning/lib/josa-endings';
import { hasMaskResidue, stripMaskTokens } from './mask-tokens';

/**
 * 형태소 토큰 → 키워드 후보(No.21 — 설계서 §6.1, FR-DC4). DB·Nest 무의존 순수 함수(분석기는 포트로 받는다 —
 * 시험은 가짜 분석기를 넣는다).
 *
 * 품사 집합은 `garu-ko@0.9.18` 실제 출력 태그로 확인했다(설계서 §27 I-n):
 *  - 명사만(기본): `NNG`(일반명사) · `NNP`(고유명사) · `SL`(외국어 — "ATM"·"VIP")
 *  - 명사만 끔: 위 + `VV`·`VA`(동사·형용사 **어간** — "받"·"복잡하") + `XR`(어근 — "간편")
 *  - `UNK`(휴리스틱 M0 분석기의 어간 태그 · 미등록어)는 두 모드 모두 후보로 인정한다 — 그렇지 않으면 기본 분석기
 *    폴백 시 키워드가 0개가 된다.
 * garu는 `NNB`(의존명사)·`NP`(대명사)·`NR`(수사)·`MAG`·`MM`·조사·어미·`SN`(숫자)·기호를 모두 별도 태그로
 * 내므로 위 집합에 들지 않아 자연히 제외된다.
 */
export const NOUN_TAGS: ReadonlySet<string> = new Set(['NNG', 'NNP', 'SL', 'UNK']);
export const PREDICATE_TAGS: ReadonlySet<string> = new Set(['VV', 'VA', 'XR']);

export interface KeywordTokenOptions {
  /** true(기본) = 명사만. */
  readonly nounsOnly?: boolean;
}

const HANGUL_ONE = /^[ㄱ-ㆎ가-힣]$/;
const JOSA_SET: ReadonlySet<string> = new Set(JOSA_ENDINGS);

function cleanTerm(surface: string): string {
  // 앞뒤 기호 제거 · 영문 소문자 · NFC
  return surface
    .normalize('NFC')
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
    .toLowerCase();
}

/** §6.1 ④ 제외 판정. */
export function isExcludedTerm(term: string): boolean {
  if (term.length === 0) return true;
  if (hasMaskResidue(term)) return true;
  if (/^[\p{N}]+$/u.test(term)) return true; // 숫자만
  if (HANGUL_ONE.test(term)) return true; // 한글 한 글자(자모 포함)
  if (DEFAULT_STOPWORDS.has(term)) return true;
  if (JOSA_SET.has(term)) return true; // 조사·어미 단독
  return false;
}

/**
 * 발화 1개의 키워드 후보 — **발화 안 중복은 1회**(있음/없음 · §6.1 ⑤). 첫 등장 순서를 유지한다.
 */
export function extractKeywordTerms(
  maskedText: string,
  analyzer: Pick<MorphAnalyzerPort, 'analyze'>,
  options: KeywordTokenOptions = {},
): string[] {
  const nounsOnly = options.nounsOnly ?? true;
  const cleaned = stripMaskTokens(maskedText);
  if (!cleaned) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const token of analyzer.analyze(cleaned)) {
    const isCandidate = NOUN_TAGS.has(token.pos) || (!nounsOnly && PREDICATE_TAGS.has(token.pos));
    if (!isCandidate) continue;
    const term = cleanTerm(token.surface);
    if (isExcludedTerm(term) || seen.has(term)) continue;
    seen.add(term);
    out.push(term);
  }
  return out;
}
