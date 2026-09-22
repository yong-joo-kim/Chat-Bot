/**
 * G1 규칙 기반 증강의 변형 규칙표(ADR-0026 §1, FR-L1-5, 설계서 §21.1-①). DB·Nest 무의존 순수 함수다.
 * 사전(동의어)은 인자로 주입받는다 — `Keyword.synonyms`·`HomonymDictionary.word`를 그대로 재사용하며
 * 이 파일은 Prisma를 알지 못한다(ADR-0020과 같은 "사전 계산 결과 주입" 패턴).
 *
 * 여섯 기법을 적용해 시드 1건당 최대 `maxPerSeed`건의 후보를 만든다. 결과는 결정론적이다(같은
 * 입력 → 같은 순서의 같은 출력) — 이 함수 자체는 검증하지 않으므로(C-3, ADR-0026) 무의미한 후보가
 * 섞여 나올 수 있고, 그것을 걸러내는 것은 `validate-candidates.ts`의 책임이다.
 */

export type RuleVariantTechnique =
  | 'ENDING' // 종결형 변형: ~나요/~습니까/~해요 등
  | 'JOSA' // 조사 교체: 은/는, 이/가, 을/를 ...
  | 'SYNONYM' // 동의어 치환(Keyword.synonyms/HomonymDictionary 주입)
  | 'SPACING' // 띄어쓰기 변형
  | 'REGISTER' // 경어 ↔ 구어 변환
  | 'ORDER'; // 어순 교체(보수적 — 명확한 구분자가 있을 때만)

export interface RuleVariantCandidate {
  readonly text: string;
  readonly technique: RuleVariantTechnique;
}

/** 표제어 → 대체어 목록. `Keyword.synonyms`·`HomonymDictionary.word`를 조립해 호출부가 채운다. */
export type SynonymDict = ReadonlyMap<string, readonly string[]>;

export interface RuleVariantDeps {
  readonly synonyms: SynonymDict;
}

// ── ① 종결형 변형 그룹 — 같은 그룹 안에서 서로 교체한다(자기 자신 제외). ────────────────
const ENDING_GROUPS: readonly (readonly string[])[] = [
  ['나요?', '나요', '까요?', '까요', '습니까?', '읍니까?'],
  ['하나요?', '하나요', '해요?', '해요', '하는가요?', '하는가요'],
  ['되나요?', '되나요', '됩니까?', '되는가요?', '되는지요'],
  ['인가요?', '인가요', '입니까?', '이에요?', '예요?'],
  ['싶어요', '싶습니다', '싶은데요', '고 싶어요'],
  ['주세요', '주시겠어요?', '부탁드립니다', '해주세요'],
  ['해주시나요?', '해주시겠어요?', '해줄 수 있나요?', '가능한가요?'],
];

// ── ② 조사 교체 그룹 — 표기상 흔히 헷갈리는 짝만 다룬다(문법적으로 완전하지 않을 수 있으나
//    검증 단계가 의미 이탈 후보를 걸러낸다). ─────────────────────────────────────────
const JOSA_GROUPS: readonly (readonly string[])[] = [
  ['은', '는'],
  ['이', '가'],
  ['을', '를'],
  ['에서', '에'],
  ['으로', '로'],
  ['와', '과'],
  ['도'],
  ['만'],
  ['까지'],
  ['부터'],
  ['의'],
  ['이나', '라도'],
];

// ── ③ 경어 ↔ 구어 변환(ENDING과 별개 기법으로 분류 — FR-L1-5 "경어/구어 변환" 요구를 명시적으로 만족) ──
const REGISTER_PAIRS: readonly [string, string][] = [
  ['습니다', '해요'],
  ['입니다', '이에요'],
  ['하십시오', '해주세요'],
  ['십니까', '나요'],
];

/** 어순 교체용 접속 구분자. 구분자 앞뒤를 맞바꾼다(의미가 뒤집히지 않는 대등 접속만 대상). */
const ORDER_DELIMITERS: readonly string[] = [' 그리고 ', ' 그리고, ', ' 및 ', ', '];

function dedupePush(list: RuleVariantCandidate[], seen: Set<string>, text: string, technique: RuleVariantTechnique): void {
  const trimmed = text.trim();
  if (!trimmed || seen.has(trimmed)) return;
  seen.add(trimmed);
  list.push({ text: trimmed, technique });
}

function applyEndingVariants(seed: string, seen: Set<string>, out: RuleVariantCandidate[]): void {
  for (const group of ENDING_GROUPS) {
    const matched = group.find((suffix) => seed.endsWith(suffix));
    if (!matched) continue;
    const stem = seed.slice(0, seed.length - matched.length);
    for (const alt of group) {
      if (alt === matched) continue;
      dedupePush(out, seen, `${stem}${alt}`, 'ENDING');
    }
    return; // 첫 매치 그룹만 적용 — 여러 그룹이 동시에 매치되는 것을 방지
  }
}

function applyRegisterVariants(seed: string, seen: Set<string>, out: RuleVariantCandidate[]): void {
  for (const [formal, casual] of REGISTER_PAIRS) {
    if (seed.endsWith(formal)) {
      dedupePush(out, seen, `${seed.slice(0, -formal.length)}${casual}`, 'REGISTER');
    } else if (seed.endsWith(casual)) {
      dedupePush(out, seen, `${seed.slice(0, -casual.length)}${formal}`, 'REGISTER');
    }
  }
}

function applyJosaVariants(seed: string, seen: Set<string>, out: RuleVariantCandidate[]): void {
  const tokens = seed.split(' ');
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    for (const group of JOSA_GROUPS) {
      const matched = group.find((josa) => token.length > josa.length && token.endsWith(josa));
      if (!matched) continue;
      const stem = token.slice(0, token.length - matched.length);
      for (const alt of group) {
        if (alt === matched) continue;
        const nextTokens = [...tokens];
        nextTokens[i] = `${stem}${alt}`;
        dedupePush(out, seen, nextTokens.join(' '), 'JOSA');
      }
      break; // 토큰당 첫 매치 그룹만
    }
  }
}

function applySynonymVariants(seed: string, deps: RuleVariantDeps, seen: Set<string>, out: RuleVariantCandidate[]): void {
  for (const [term, replacements] of deps.synonyms) {
    if (!term || !seed.includes(term)) continue;
    for (const repl of replacements) {
      if (!repl || repl === term) continue;
      // 최초 1개 위치만 치환한다 — 전역 치환은 같은 단어가 여러 번 등장할 때 부자연스러워진다.
      const idx = seed.indexOf(term);
      const replaced = `${seed.slice(0, idx)}${repl}${seed.slice(idx + term.length)}`;
      dedupePush(out, seen, replaced, 'SYNONYM');
    }
  }
}

function applySpacingVariants(seed: string, seen: Set<string>, out: RuleVariantCandidate[]): void {
  const tokens = seed.split(' ');
  // 인접 토큰 붙여쓰기(공백 제거) — 첫 두 토큰만(결정론).
  if (tokens.length >= 2) {
    const merged = [tokens[0] + tokens[1], ...tokens.slice(2)].join(' ');
    dedupePush(out, seen, merged, 'SPACING');
  }
  // 가장 긴 토큰의 중간에 공백 삽입(붙여 쓴 복합어를 흔히 관리자가 띄어 쓰기도 하는 현실 반영).
  let longestIdx = -1;
  let longestLen = 1;
  tokens.forEach((t, i) => {
    if (t.length > longestLen) {
      longestLen = t.length;
      longestIdx = i;
    }
  });
  if (longestIdx >= 0) {
    const t = tokens[longestIdx];
    const mid = Math.ceil(t.length / 2);
    const split = `${t.slice(0, mid)} ${t.slice(mid)}`;
    const nextTokens = [...tokens];
    nextTokens[longestIdx] = split;
    dedupePush(out, seen, nextTokens.join(' '), 'SPACING');
  }
}

function applyOrderVariants(seed: string, seen: Set<string>, out: RuleVariantCandidate[]): void {
  for (const delim of ORDER_DELIMITERS) {
    const idx = seed.indexOf(delim);
    if (idx <= 0) continue;
    const left = seed.slice(0, idx);
    const right = seed.slice(idx + delim.length);
    if (!left || !right) continue;
    dedupePush(out, seen, `${right}${delim}${left}`, 'ORDER');
    return; // 첫 매치 구분자만
  }
}

/**
 * 시드 문장 1건에서 최대 `maxPerSeed`건의 규칙 기반 변형 후보를 만든다.
 * 순서: ENDING → REGISTER → JOSA → SYNONYM → SPACING → ORDER (결정론 고정 순서).
 */
export function generateRuleVariants(
  seed: string,
  deps: RuleVariantDeps,
  maxPerSeed = 8,
): RuleVariantCandidate[] {
  const trimmedSeed = seed.trim();
  if (!trimmedSeed) return [];

  const seen = new Set<string>([trimmedSeed]);
  const out: RuleVariantCandidate[] = [];

  applyEndingVariants(trimmedSeed, seen, out);
  applyRegisterVariants(trimmedSeed, seen, out);
  applyJosaVariants(trimmedSeed, seen, out);
  applySynonymVariants(trimmedSeed, deps, seen, out);
  applySpacingVariants(trimmedSeed, seen, out);
  applyOrderVariants(trimmedSeed, seen, out);

  return out.slice(0, maxPerSeed);
}

/**
 * 시드 여러 건에 대해 반복 적용하고 `targetCount`(검증 탈락 감안 상한, 호출부가 이미 ×3한 값)에
 * 도달할 때까지 결정론적 순서로 모은다. 시드 순서를 라운드로빈으로 순회해 특정 시드에 결과가
 * 편중되지 않게 한다.
 */
export function generateRuleVariantsForSeeds(
  seeds: readonly string[],
  deps: RuleVariantDeps,
  targetCount: number,
  maxPerSeed = 8,
): string[] {
  const perSeed = seeds.map((s) => generateRuleVariants(s, deps, maxPerSeed));
  const seen = new Set<string>(seeds.map((s) => s.trim()));
  const out: string[] = [];

  let cursor = 0;
  let progressed = true;
  while (out.length < targetCount && progressed) {
    progressed = false;
    for (const list of perSeed) {
      if (cursor >= list.length) continue;
      const candidate = list[cursor];
      progressed = true;
      if (!seen.has(candidate.text)) {
        seen.add(candidate.text);
        out.push(candidate.text);
        if (out.length >= targetCount) break;
      }
    }
    cursor += 1;
  }
  return out;
}
