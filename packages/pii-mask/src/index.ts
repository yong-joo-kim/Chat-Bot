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

export interface PiiMaskOptions {
  /** 생략하면 `configurePiiMaskMode()`로 설치된 값(기본 `PARTIAL`)을 쓴다. */
  mode?: PiiMaskMode;
}

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
  masked = masked.replace(ACCOUNT_REGEX, () => {
    counts.account += 1;
    return '[계좌번호]';
  });
  masked = masked.replace(EMAIL_REGEX, (m) => {
    counts.email += 1;
    return mode === 'FULL' ? '[이메일]' : maskEmail(m);
  });

  return { maskedText: masked, counts };
}
