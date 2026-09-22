import type { MorphToken } from '../morph/morph-analyzer.port';

export type DecompositionSpanRole = 'ENTITY_CANDIDATE' | 'INTENT_SIGNAL' | 'IGNORED';

export interface GazetteerEntry {
  /** 등록된 `Keyword`에서 온 항목일 때만 채운다. 없으면(`HomonymDictionary` 표제어 등)
   * 스팬 경계를 잡는 데는 쓰이지만 `matchedKeyword`는 비운다 — 키워드가 아니기 때문이다. */
  readonly keywordId?: string;
  readonly name: string;
  readonly surface: string;
  readonly viaSynonym: boolean;
}

export interface DecomposeSpanResult {
  readonly start: number;
  readonly end: number;
  readonly text: string;
  readonly role: DecompositionSpanRole;
  readonly matchedKeyword?: { readonly id: string; readonly name: string; readonly viaSynonym: boolean };
}

export interface DecomposeDeps {
  readonly morphTokens: readonly MorphToken[];
  readonly gazetteer: readonly GazetteerEntry[];
  readonly stopwords: ReadonlySet<string>;
  readonly josaEndings: readonly string[];
}

/** 서술·종결 표현(§4.2.2 역할 자동 부여 ②) — 매칭되면 `INTENT_SIGNAL`, 아니면 기본 `ENTITY_CANDIDATE`다. */
const INTENT_SIGNAL_ENDING =
  /(나요|가요|까요|습니다|ㅂ니다|어요|아요|해요|돼요|되나요|건가요|는지|을까요|ㄹ까요|주세요|해주세요|주실|되요|하나요)$/;

/**
 * gazetteer 최장일치 스팬을 결정론적으로 찾는다(① 최우선, EX-L2-3). 긴 표제어부터 스캔해
 * 이미 덮인 구간과 겹치지 않는 첫 등장만 채택한다 — 같은 표제어가 여러 번 등장해도 전부 잡는다.
 */
function findGazetteerSpans(text: string, gazetteer: readonly GazetteerEntry[]): DecomposeSpanResult[] {
  const sorted = [...gazetteer].filter((g) => g.surface.trim().length > 0).sort((a, b) => b.surface.length - a.surface.length);
  const covered = new Array<boolean>(text.length).fill(false);
  const lowerText = text.toLowerCase();
  const spans: DecomposeSpanResult[] = [];

  for (const entry of sorted) {
    const needle = entry.surface.toLowerCase();
    if (!needle) continue;
    let searchFrom = 0;
    for (;;) {
      const idx = lowerText.indexOf(needle, searchFrom);
      if (idx === -1) break;
      const end = idx + needle.length;
      searchFrom = idx + 1;
      if (covered.slice(idx, end).some(Boolean)) continue;
      spans.push({
        start: idx,
        end,
        text: text.slice(idx, end),
        role: 'ENTITY_CANDIDATE',
        matchedKeyword: entry.keywordId ? { id: entry.keywordId, name: entry.name, viaSynonym: entry.viaSynonym } : undefined,
      });
      for (let i = idx; i < end; i++) covered[i] = true;
    }
  }

  return spans;
}

function classifyToken(surface: string, pos: string, stopwords: ReadonlySet<string>): DecompositionSpanRole {
  const trimmed = surface.trim();
  if (!trimmed) return 'IGNORED';
  if (pos === 'JX') return 'IGNORED'; // 조사(M0/M1 공통 표기)
  if (/^[0-9]+$/.test(trimmed)) return 'IGNORED';
  if (stopwords.has(trimmed)) return 'IGNORED';
  if (trimmed.length === 1 && !/[가-힣a-zA-Z0-9]/.test(trimmed)) return 'IGNORED';
  if (INTENT_SIGNAL_ENDING.test(trimmed)) return 'INTENT_SIGNAL';
  return 'ENTITY_CANDIDATE';
}

/** 최후 폴백(④) — `morphTokens`가 완전히 비었을 때만 쓴다(분석기 로드 실패 등). */
function fallbackTokenize(text: string, josaEndings: readonly string[]): MorphToken[] {
  const tokens: MorphToken[] = [];
  const pattern = /\S+/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const eojeol = match[0];
    const start = match.index;
    const josa = josaEndings.find((j) => eojeol.length > j.length && eojeol.endsWith(j));
    if (!josa) {
      tokens.push({ surface: eojeol, start, end: start + eojeol.length, pos: 'UNK' });
      continue;
    }
    const stemEnd = start + (eojeol.length - josa.length);
    tokens.push({ surface: eojeol.slice(0, eojeol.length - josa.length), start, end: stemEnd, pos: 'UNK' });
    tokens.push({ surface: josa, start: stemEnd, end: stemEnd + josa.length, pos: 'JX' });
  }
  return tokens;
}

/**
 * No.23 (A) 요소분해 순수 함수(ADR-0028 §3, DD-104) — DB·Nest·분석기 무의존. 우선순위:
 * ① gazetteer 최장일치(결정론) → ② 형태소 경계 → ③ 공백 → ④ 조사·어미 접미 절단.
 *
 * ⚠ `morphTokens`의 `start`/`end`가 **어절 단위**(같은 어절의 여러 형태소가 같은 범위를 공유)라는
 * 한계(`morph-analyzer.port.ts` 문서 참고)를 이 함수가 그대로 흡수한다 — 같은 범위가 이미
 * `covered`로 표시되면 이후 토큰은 건너뛰므로, **애매한 경우 자동으로 어절 전체가 1스팬으로
 * 유지**된다(추가 특수 처리 불필요).
 */
export function decompose(text: string, deps: DecomposeDeps): DecomposeSpanResult[] {
  if (!text) return [];

  const gazetteerSpans = findGazetteerSpans(text, deps.gazetteer);
  const covered = new Array<boolean>(text.length).fill(false);
  for (const span of gazetteerSpans) for (let i = span.start; i < span.end; i++) covered[i] = true;

  const morphTokens = deps.morphTokens.length > 0 ? deps.morphTokens : fallbackTokenize(text, deps.josaEndings);

  const morphSpans: DecomposeSpanResult[] = [];
  for (const token of morphTokens) {
    if (token.start < 0 || token.end > text.length || token.start >= token.end) continue;
    if (covered.slice(token.start, token.end).some(Boolean)) continue; // gazetteer(①) 또는 같은 어절의 앞선 형태소가 이미 잡음.
    const surface = text.slice(token.start, token.end);
    morphSpans.push({ start: token.start, end: token.end, text: surface, role: classifyToken(surface, token.pos, deps.stopwords) });
    for (let i = token.start; i < token.end; i++) covered[i] = true;
  }

  return [...gazetteerSpans, ...morphSpans].sort((a, b) => a.start - b.start);
}
