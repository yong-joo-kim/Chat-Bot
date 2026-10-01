/**
 * PII 마스킹 순수 함수(FR-11-23, NFR-S4, ADR-0013). **`packages/pii-mask`로 승격**됐다(DD-84,
 * nlu-rag-answering-설계.md §7.3) — 소비자가 2곳(`ConversationLogService.record()` 저장 경로,
 * `RagAnswerService` 외부 RAG 송신 경로)이 되어 명세서 §5의 승격 조건을 충족했다. 동작은 이동 전과
 * 완전히 동일하다(AC-N4-7 — 함수 복제 금지, 정책 변경 0). `apps/api`는 이 함수를 재export하지 않고
 * `@chat-bot/pii-mask`를 직접 import한다.
 *

 * **실제 구현은 정규식 휴리스틱 기반 1패스**다(종류별 정규식을 순서대로 적용해 치환). ADR-0013 §3이
 * 언급한 형제 프로젝트 `Auto QA`의 2단계 구조(① 구분자로 형태가 특정되는 패턴 ② 구분자 없는 연속
 * 숫자열을 길이/문맥/Luhn·주민번호 체크섬으로 분류)는 **이식하지 않았다** — 2단계(체크섬 기반 분류)는
 * 미구현이며, 카드/계좌 정규식만으로는 구분자가 동일한 형태(예: "XXX-XXXX-XXXX")를 완벽히 분리하지
 * 못하는 구조적 한계가 있다. 이는 ADR-0013이 명시적으로 허용한 단순화 범위다(§1 "설계로만 이식",
 * 구현은 이 저장소 테스트로 보증). 규칙 기반이라 사람 이름·주소 등 문맥 의존 PII도 탐지하지 못하며,
 * **미탐(false negative)보다 과탐을 택하는 fail-closed 원칙**을 따른다 — 애매하면 마스킹한다.
 *
 * 종류별 차등 정책: 주민등록번호/카드번호/계좌번호=전량 마스킹, 전화번호/이메일=부분 마스킹(§8.4).
 * 한계 기록: ADR-0013 §6(구현 확인) 참조.
 */

export interface PiiMaskCounts {
  rrn: number;
  card: number;
  account: number;
  phone: number;
  email: number;
}

export interface PiiMaskResult {
  maskedText: string;
  counts: PiiMaskCounts;
}

/**
 * [신규 No.45 — 데이터 거버넌스] 마스킹 강도. `PARTIAL`(기본 = 현행)은 전화·이메일을 부분 마스킹,
 * `FULL`은 전화·이메일도 전량 치환한다(주민번호·카드·계좌는 두 모드 모두 전량). ADR-0013 감수 비용
 * ①이 예고한 옵션이다 — 함수 1벌을 유지한다(`docs/02-spec/data-governance-설계.md` §12).
 */
export type PiiMaskMode = 'PARTIAL' | 'FULL';

/** [신규 No.36] `PiiMaskCounts`의 키 = 종류 이름(`rrn`·`card`·`account`·`phone`·`email`). */
export type PiiKind = keyof PiiMaskCounts;

export interface PiiMaskOptions {
  /** 생략하면 `configurePiiMaskMode()`로 설치된 값(기본 `PARTIAL`)을 쓴다. */
  mode?: PiiMaskMode;
  /**
   * [신규 No.36 — 출구 전용] 주어지면 이 종류만 치환한다. 생략 = 5종 전부(기존 본문 그대로 실행 —
   * 바이트 불변). 저장·송신 마스킹 호출은 이 인자를 쓰지 않는다(ai-guardrails-설계.md §7).
   */
  kinds?: readonly PiiKind[];
  /**
   * [L-5, 2026-10-01 PM] 독립된 `YYYY-MM-DD` 날짜를 계좌번호 후보에서 제외한다. **생략 = true**(규칙 v2) —
   * 단 바로 앞 낱말이 생년월일 문맥 키워드(`생년`·`생일`·`출생`·`탄생일`·`birth`·`birth date`·`dob` — 사이 기호 0~6개·`(양력)` 등 주석
   * 1개 허용)면 예전처럼 가린다(`isBirthDateContext`). 날짜 뒤의 문맥은 보지 않는다.
   * `false` = 규칙 v1(날짜 오인 포함, 예외 판정 자체를 하지 않음 — 바이트 동일).
   */
  preserveDates?: boolean;
}

/**
 * [L-5] 규칙 버전. 1 = 날짜 오인 포함 구 규칙, 2 = 저장 마스킹도 날짜 제외 + 생년월일 문맥 예외(2026-10-01 PM 결정 — 구분 문자·키워드를
 * 넓힌 2차 확장 포함이 최종 정의. 2차 확장 전 v2가 어디에도 배포된 적이 없어 번호를 올리지 않았다).
 * 기동 로그가 이 값을 찍는다(폐쇄망 반입 시 구 `dist`가 조용히 v1로 동작하는 것을 드러낸다).
 */
export const PII_MASK_RULES_VERSION = 2;

/** 거버넌스 부트스트랩 1곳만 호출한다(설치 없음 = PARTIAL). 재설치는 시험 전용. */
let installedMode: PiiMaskMode = 'PARTIAL';

export function configurePiiMaskMode(mode: PiiMaskMode): void {
  installedMode = mode;
}

/** 시험 전용 — 설치값을 기본으로 되돌린다(함수명에 `ForTest`, 운영 코드 호출 0). */
export function resetPiiMaskModeForTest(): void {
  installedMode = 'PARTIAL';
}

// ① 주민등록번호 — YYMMDD-[1-8]XXXXXX(구분자 선택). 성별코드 1~4(~1999년생 이하 legacy) / 5~8(2000년~/외국인).
const RRN_REGEX = /\d{6}-?[1-8]\d{6}/g;

// ② 카드번호 — 4자리씩 4묶음(구분자 선택, 마지막 묶음은 2~4자리까지 허용해 일부 브랜드 대응).
const CARD_REGEX = /\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{2,4}(?![-\d])/g;

// ③ 전화번호 — 휴대전화(01[016789]) / 유선(0XX). 카드·계좌보다 먼저 처리해 동일한 "XXX-XXXX-XXXX"
// 형태의 전화번호가 계좌번호로 잘못 분류되지 않게 한다.
const PHONE_REGEX = /01[016789]-?\d{3,4}-?\d{4}|0\d{1,2}-\d{3,4}-\d{4}/g;

// ④ 계좌번호 — 구분자(-) 2개 이상을 포함한 연속 숫자열(은행마다 자릿수가 제각각이라 길이만으로는
// 특정할 수 없다 — "구분자 있음 + 전화번호로 이미 분류되지 않음"을 계좌로 간주하는 보수적 휴리스틱).
const ACCOUNT_REGEX = /\d{2,6}-\d{2,6}-\d{2,6}(?:-\d{1,6})?/g;

const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

function maskPhone(value: string): string {
  const digits = value.replace(/[^0-9]/g, '');
  if (digits.length < 9) return value;
  const front = digits.slice(0, 3);
  const back = digits.slice(-4);
  return `${front}-****-${back}`;
}

function maskEmail(value: string): string {
  const at = value.indexOf('@');
  if (at <= 0) return value;
  const local = value.slice(0, at);
  const domain = value.slice(at + 1);
  return `${local[0]}***@${domain}`;
}

/**
 * PII 마스킹(FR-11-23, NFR-S4, ADR-0013). `options.mode`를 생략하면 설치값(기본 `PARTIAL`)을 쓴다.
 * `PARTIAL` 결과는 이 옵션 도입 전과 **바이트 동일**이다(No.45 FR-0-161).
 */
export function maskPii(text: string, options?: PiiMaskOptions): PiiMaskResult {
  // [L-5] 날짜 보호는 기본 경로가 처리한다 — 생략 = true, false = 구 동작(v1).
  const preserveDates = options?.preserveDates !== false;
  // [신규 No.36] `kinds`가 있을 때만 별도 경로(출구 전용 선택 가림). 사설 영역 문자 입력이면 null → 아래 기본 본문(K-11).
  if (options?.kinds !== undefined) {
    const selective = maskPiiSelective(text, options.mode ?? installedMode, options.kinds, preserveDates);
    if (selective) return selective;
  }
  const mode = options?.mode ?? installedMode;
  const counts: PiiMaskCounts = { rrn: 0, card: 0, account: 0, phone: 0, email: 0 };
  if (!text) return { maskedText: text, counts };

  let masked = text;
  masked = masked.replace(RRN_REGEX, () => {
    counts.rrn += 1;
    return '[주민등록번호]';
  });
  masked = masked.replace(CARD_REGEX, () => {
    counts.card += 1;
    return '[카드번호]';
  });
  masked = masked.replace(PHONE_REGEX, (m) => {
    counts.phone += 1;
    return mode === 'FULL' ? '[전화번호]' : maskPhone(m);
  });
  masked = masked.replace(ACCOUNT_REGEX, (m, offset: number, whole: string) => {
    // [L-5] 독립 날짜는 계좌번호가 아니다 — 단 생년월일 문맥이면 예전처럼 가린다.
    if (preserveDates && isStandaloneDate(m, offset, whole) && !isBirthDateContext(whole, offset)) return m;
    counts.account += 1;
    return '[계좌번호]';
  });
  masked = masked.replace(EMAIL_REGEX, (m) => {
    counts.email += 1;
    return mode === 'FULL' ? '[이메일]' : maskEmail(m);
  });

  return { maskedText: masked, counts };
}

// ── [신규 No.36] 출구 전용 선택 가림 ───────────────────────────────────────────────────────────
// 같은 순서(주민번호 → 카드 → 전화 → 계좌 → 이메일)·같은 정규식·같은 치환 모양을 쓰되, 선택되지 않은
// 종류의 일치 구간은 자리표시(사설 영역 문자 — 숫자·하이픈·@·영문 없음)로 잠시 바꿔 뒤 단계 정규식이
// 가져가지 못하게 한다 → "앞 종류 우선" 분류가 선택과 무관하게 보존된다(ai-guardrails-설계.md §7.2).

const ALL_KINDS: readonly PiiKind[] = ['rrn', 'card', 'phone', 'account', 'email'];
const PLACEHOLDER_OPEN = '\uE000';
const PLACEHOLDER_CLOSE = '\uE001';
const PLACEHOLDER_DIGIT_BASE = 0xe100;
const PRIVATE_USE_INPUT = /[\uE000-\uE1FF]/;
const PLACEHOLDER_REGEX = /\uE000([\uE100-\uE1FF]+)\uE001/g;


// ── [L-5] 날짜 제외 + 생년월일 문맥 예외 ──────────────────────────────────────────────────────────
// 날짜(YYYY-MM-DD) — 계좌 정규식만 날짜를 오인한다(주민번호·카드·전화 정규식은 겹치지 않음). 저장 경로(기본)와
// 출구(선택 경로)가 **같은 정의 1곳**에서 파생한 규칙을 쓴다: 연도 19xx·20xx, 월 01~12, 일 01~31(월별 일수·윤년은 보지 않는다),
// 앞뒤 글자가 숫자도 하이픈도 아니어야 한다(독립 날짜).
const DATE_CORE = String.raw`(?:19|20)\d{2}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])`;
const DATE_FULL_REGEX = new RegExp(`^${DATE_CORE}$`);
const DATE_BOUNDARY_CHAR = /[\d-]/;

/** 계좌 정규식 일치(`m`, 위치 `offset`)가 독립 날짜인가 — 날짜 규칙(전체 일치 + 앞뒤 경계 `[\d-]` 아님). */
function isStandaloneDate(m: string, offset: number, whole: string): boolean {
  if (!DATE_FULL_REGEX.test(m)) return false;
  const prev = offset > 0 ? whole[offset - 1] : '';
  const next = whole[offset + m.length] ?? '';
  return !(prev !== '' && DATE_BOUNDARY_CHAR.test(prev)) && !(next !== '' && DATE_BOUNDARY_CHAR.test(next));
}

/**
 * 생년월일 문맥 키워드 — 한 낱말 6개(`birth date` 두 낱말은 `isBirthDateContext`가 따로 본다 = 닫힌 목록 7개). 목록 변경 = 규칙 변경이며
 * 골든 갱신 절차가 필요하다. 비교는 창 정규화(NFKC + 소문자) 이후다.
 */
const BIRTH_KEYWORDS: ReadonlyArray<{ readonly keyword: string; readonly maxSuffix: number }> = [
  { keyword: '생년', maxSuffix: 4 },
  { keyword: '생일', maxSuffix: 2 },
  { keyword: '출생', maxSuffix: 4 },
  { keyword: '탄생일', maxSuffix: 2 },
  { keyword: 'birth', maxSuffix: 4 },
  { keyword: 'dob', maxSuffix: 0 },
];
/** 두 낱말 키워드 `birth date` — 두 낱말 모두 접미 0, 사이 공백 1~2개. */
const BIRTH_TWO_WORD = { first: 'birth', second: 'date', minSpaces: 1, maxSpaces: 2 } as const;
const BIRTH_WINDOW = 32;
const BIRTH_MAX_DELIMITERS = 6;
/** 구분 문자로 셈하는 닫힌 주석(정규화 후 문자열 그대로 일치 · 최대 1회 · 구분 문자 1개로 계산). */
const BIRTH_ANNOTATIONS: readonly string[] = ['(양력)', '(음력)', '[양력]', '[음력]'];
// 보이지 않는 문자(판정 창에서만 제거) — apps/api N36-2 금지어 정규화(`banned-word-filter.ts`)와 같은 집합이다.
// `pii-mask`는 api를 import할 수 없어 정의를 따로 두고, 두 집합이 같음을 api 쪽 정적 시험이 고정한다. 리터럴 서식을 같게 유지할 것.
const INVISIBLE_CLASS = '[\\p{Cf}\\u034F\\uFE00-\\uFE0F\\u115F\\u1160\\u3164\\uFFA0]';
const INVISIBLE_ALL = new RegExp(INVISIBLE_CLASS, 'gu');
// 구분 문자(NFKC 이후 단일 문자 검사 — 수량자 없음): 공백류(줄바꿈은 이미 잘림) `:` `=` `,` `(` `[` `"` `'` `-` `/` `~`,
// 하이픈 변형 U+2010~2015 · 빼기 U+2212 · 물결 U+301C · 곡선 따옴표 U+2018/2019/201C/201D · 낫표 U+300C~300F. 닫는 괄호는 아니다.
const LINE_BREAKS = ['\n', '\r', '\u2028', '\u2029'];
const BIRTH_DELIMITER = /^[\s:=,(["'\-/~‐-―−〜‘’“”「-』]$/;
const LETTER = /^\p{L}$/u;
const DIGIT = /^\d$/;
const SPACE = /^\s$/;


/**
 * 날짜가 `text[dateStart]`에서 시작할 때, 바로 앞 낱말이 생년월일 문맥 키워드인가(U-1, 2차 확장 2026-10-01). 날짜 시작 위치에서
 * 왼쪽으로 **고정 창 32글자 선형 역방향 스캔**한다 — 정규식 역추적·가변 수량자가 없어 입력과 무관하게 날짜당 상수 시간이다.
 * 순서: 같은 줄만(줄바꿈 뒤) → 보이지 않는 문자 제거 → NFKC → 소문자(창에만 — 판정 전용, 결과 문자열은 바꾸지 않는다).
 * 구분 문자(공백·`:`·`=`·`,`·`(`·`[`·`"`·`'`·`-`·`/`·`~`·하이픈 변형·빼기·물결·곡선 따옴표·낫표) 0~6개를 건너뛰되, 닫힌 주석
 * `(양력)`·`(음력)`·`[양력]`·`[음력]`은 최대 1개를 구분 문자 1개로 센다. 그 앞의 글자 연속(낱말)이 한 낱말 키워드로 시작하고 뒤에 붙는
 * 글자 수가 허용치 이하이거나, 정확히 `date`이고 사이 공백 1~2개 앞이 정확히 `birth`이면(`birth date`) true. 낱말 바로 앞이 숫자면
 * false(`2생일` 방지). 날짜 **뒤**의 문맥(`1990-05-12 (생년월일)`)은 보지 않는다(U-14).
 */
function isBirthDateContext(text: string, dateStart: number): boolean {
  let win = text.slice(Math.max(0, dateStart - BIRTH_WINDOW), dateStart);
  for (const br of LINE_BREAKS) {
    const at = win.lastIndexOf(br);
    if (at >= 0) win = win.slice(at + 1);
  }
  win = win.replace(INVISIBLE_ALL, '');
  if (win === '') return false;
  const w = win.normalize('NFKC').toLowerCase();

  let end = w.length;
  let skipped = 0;
  let annotationUsed = false;
  while (end > 0 && skipped < BIRTH_MAX_DELIMITERS) {
    if (BIRTH_DELIMITER.test(w[end - 1])) {
      end -= 1;
    } else if (!annotationUsed && end >= 4 && BIRTH_ANNOTATIONS.includes(w.slice(end - 4, end))) {
      end -= 4;
      annotationUsed = true;
    } else {
      break;
    }
    skipped += 1;
  }
  let start = end;
  while (start > 0 && LETTER.test(w[start - 1])) start -= 1;
  if (start === end) return false;
  if (start > 0 && DIGIT.test(w[start - 1])) return false;

  const word = w.slice(start, end);
  if (BIRTH_KEYWORDS.some(({ keyword, maxSuffix }) => word.startsWith(keyword) && word.length - keyword.length <= maxSuffix)) return true;

  // `birth date` — 낱말이 정확히 `date`, 앞이 공백 1~2개, 그 앞 글자 연속이 정확히 `birth`(앞이 숫자가 아님).
  if (word !== BIRTH_TWO_WORD.second) return false;
  let spaceStart = start;
  while (spaceStart > 0 && SPACE.test(w[spaceStart - 1])) spaceStart -= 1;
  const spaces = start - spaceStart;
  if (spaces < BIRTH_TWO_WORD.minSpaces || spaces > BIRTH_TWO_WORD.maxSpaces) return false;
  let firstStart = spaceStart;
  while (firstStart > 0 && LETTER.test(w[firstStart - 1])) firstStart -= 1;
  if (w.slice(firstStart, spaceStart) !== BIRTH_TWO_WORD.first) return false;
  return !(firstStart > 0 && DIGIT.test(w[firstStart - 1]));
}

function encodeIndex(index: number): string {
  let value = index;
  let out = '';
  do {
    out = String.fromCharCode(PLACEHOLDER_DIGIT_BASE + (value % 256)) + out;
    value = Math.floor(value / 256);
  } while (value > 0);
  return out;
}

function decodeIndex(encoded: string): number {
  let value = 0;
  for (const ch of encoded) value = value * 256 + (ch.charCodeAt(0) - PLACEHOLDER_DIGIT_BASE);
  return value;
}

/** 입력에 사설 영역 문자가 있으면 `null`(호출자가 기존 5종 전부 경로로 처리 — fail-closed, K-11). */
function maskPiiSelective(
  text: string,
  mode: PiiMaskMode,
  kinds: readonly PiiKind[] | undefined,
  preserveDates: boolean,
): PiiMaskResult | null {
  const counts: PiiMaskCounts = { rrn: 0, card: 0, account: 0, phone: 0, email: 0 };
  if (!text) return { maskedText: text, counts };
  if (PRIVATE_USE_INPUT.test(text)) return null;

  const selected = new Set<PiiKind>(kinds ?? ALL_KINDS);
  const stash: string[] = [];
  const hold = (original: string): string => {
    stash.push(original);
    return `${PLACEHOLDER_OPEN}${encodeIndex(stash.length - 1)}${PLACEHOLDER_CLOSE}`;
  };

  const apply = (kind: PiiKind, regex: RegExp, replacer: (m: string) => string, input: string): string =>
    input.replace(regex, (m) => {
      if (!selected.has(kind)) return hold(m);
      counts[kind] += 1;
      return replacer(m);
    });

  let masked = text;
  masked = apply('rrn', RRN_REGEX, () => '[주민등록번호]', masked);
  masked = apply('card', CARD_REGEX, () => '[카드번호]', masked);
  masked = apply('phone', PHONE_REGEX, (m) => (mode === 'FULL' ? '[전화번호]' : maskPhone(m)), masked);
  // [L-5] 기본 경로와 **같은 판정**(독립 날짜 + 생년월일 문맥 아님 → 날짜는 원문 그대로)을 계좌 단계 콜백에서 적용한다. 날짜를
  // 자리표시로 미리 바꾸던 이전 방식은 뒤 단계(이메일) 정규식이 날짜 주변을 다르게 보게 해 기본 경로와 어긋났다(퍼징으로 확인).
  masked = masked.replace(ACCOUNT_REGEX, (m, offset: number, whole: string) => {
    if (preserveDates && isStandaloneDate(m, offset, whole) && !isBirthDateContext(whole, offset)) return m;
    if (!selected.has('account')) return hold(m);
    counts.account += 1;
    return '[계좌번호]';
  });
  masked = apply('email', EMAIL_REGEX, (m) => (mode === 'FULL' ? '[이메일]' : maskEmail(m)), masked);

  masked = masked.replace(PLACEHOLDER_REGEX, (_m, encoded: string) => stash[decodeIndex(encoded)] ?? '');
  return { maskedText: masked, counts };
}
