/**
 * [신규 No.35] 선제 안내(Proactive Messaging) 판정 순수 함수 — **zod 무의존 서브패스**
 * (`@chat-bot/shared-types/proactive-eval`, ADR-0012 · `output-view`·`contrast` 선례).
 *
 * 이 파일은 다른 `packages/shared-types` 파일을 import하지 않는다(PA-6 — 정규식 리터럴·`RegExp(` 0 ·
 * import 0). 위젯(브라우저 안 체류 판정)과 콘솔(경로 검사 도구 · 미리보기)이 이 모듈 1벌을 공유한다
 * (NFR-PAM1). 서버는 이 파일을 **판정에 쓰지 않는다** — 서버 판정 대상은 규칙 켜짐·게시 기간·표시
 * 시간대(KST)·금지어·노드 유효성뿐이다(FR-0-242, `apps/api/src/proactive/lib/**`가 서버 쪽 1벌).
 */

export type ProactiveDeviceKind = 'DESKTOP' | 'MOBILE';

/** 방어적 입력 축소 — ReDoS 자체가 불가능한 알고리즘(정규식 0)이지만, 극단적 입력에서도 선형 시간을
 * 보장하기 위해 길이·세그먼트 수를 자른다(AC-PA7-5). */
const MAX_PATH_LENGTH = 2048;
const MAX_PATH_SEGMENTS = 256;
const MAX_PATTERN_LENGTH = 200;

function safeDecodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/** 연속된 `/`를 1개로 줄인다(정규식 0 — 문자 순회, PA-6). */
function collapseSlashes(value: string): string {
  let result = '';
  let lastWasSlash = false;
  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i];
    if (ch === '/') {
      if (lastWasSlash) continue;
      lastWasSlash = true;
    } else {
      lastWasSlash = false;
    }
    result += ch;
  }
  return result;
}

/** 앞의 `/` 하나만 제거한다(정규식 0 — PA-6). */
function stripLeadingSlash(value: string): string {
  return value.startsWith('/') ? value.slice(1) : value;
}

/**
 * FR-PA2-1·§6.2 — 호출자는 `location.pathname`(쿼리·해시 제외)만 넘긴다. 연속 `/` 축약 · 끝 `/` 제거
 * (`/`만 예외) · 세그먼트별 안전 `decodeURIComponent` · 세그먼트 수 상한.
 */
export function normalizeProactivePath(pathname: string): string {
  const truncated = pathname.length > MAX_PATH_LENGTH ? pathname.slice(0, MAX_PATH_LENGTH) : pathname;
  const withLeading = truncated.startsWith('/') ? truncated : `/${truncated}`;
  const collapsed = collapseSlashes(withLeading);
  const withoutTrailing = collapsed.length > 1 && collapsed.endsWith('/') ? collapsed.slice(0, -1) : collapsed;
  const rawSegments = withoutTrailing === '/' ? [] : stripLeadingSlash(withoutTrailing).split('/');
  const decoded = rawSegments.map(safeDecodeSegment);
  const bounded = decoded.length > MAX_PATH_SEGMENTS ? decoded.slice(0, MAX_PATH_SEGMENTS) : decoded;
  return bounded.length === 0 ? '/' : `/${bounded.join('/')}`;
}

/**
 * 정규식 0 · 세그먼트 배열 비교(선형 시간 `O(P·S)`) — `*` = 정확히 1세그먼트 · `**` = 0개 이상 세그먼트 ·
 * 리터럴은 대소문자 구분 정확 일치. 두 포인터 + 마지막 `**` 위치로의 단일 되돌림(고전 와일드카드
 * 매칭, NFR-PAS3 · AC-PA7-5). `path`는 이 함수 안에서 `normalizeProactivePath()`로 정규화한다(호출자가
 * 이미 정규화한 값을 넘겨도 멱등이라 안전하다).
 */
export function matchProactivePathPattern(pattern: string, path: string): boolean {
  if (pattern.length > MAX_PATTERN_LENGTH) return false;
  const normalizedPath = normalizeProactivePath(path);
  const patternSegments = pattern === '/' || pattern.length === 0 ? [] : stripLeadingSlash(pattern).split('/');
  const pathSegments = normalizedPath === '/' ? [] : normalizedPath.slice(1).split('/');

  let pi = 0;
  let si = 0;
  let starPi = -1;
  let starSi = -1;

  while (si < pathSegments.length) {
    const patSeg = pi < patternSegments.length ? patternSegments[pi] : undefined;
    if (patSeg === '**') {
      starPi = pi;
      starSi = si;
      pi += 1;
      continue;
    }
    if (patSeg !== undefined && (patSeg === '*' || patSeg === pathSegments[si])) {
      pi += 1;
      si += 1;
      continue;
    }
    if (starPi !== -1) {
      starSi += 1;
      si = starSi;
      pi = starPi + 1;
      continue;
    }
    return false;
  }
  while (pi < patternSegments.length && patternSegments[pi] === '**') pi += 1;
  return pi === patternSegments.length;
}

/** include 중 하나라도 일치 ∧ exclude 모두 불일치(FR-PA2-1). */
export function matchesPathCondition(include: readonly string[], exclude: readonly string[], path: string): boolean {
  const included = include.some((p) => matchProactivePathPattern(p, path));
  if (!included) return false;
  return !exclude.some((p) => matchProactivePathPattern(p, path));
}

export interface SelectDueRulePageDwellTrigger {
  kind: 'PAGE_DWELL';
  pathInclude: readonly string[];
  pathExclude: readonly string[];
  dwellSec: number;
}

export interface SelectableProactiveRule {
  id: string;
  trigger: SelectDueRulePageDwellTrigger;
  devices: readonly ProactiveDeviceKind[];
  /** ISO 문자열 또는 epoch ms. 없으면 종료 시각 제한 없음. */
  showUntil?: string | number;
}

export interface SelectDueRuleContext {
  path: string;
  dwellMs: number;
  device: ProactiveDeviceKind;
  nowMs: number;
  /** 이 세션에서 닫힌(또는 끄기 대상) 규칙 id 목록. */
  closedRuleIds: readonly string[];
  /** 이 페이지(현재 경로)에서 이미 표시를 시도/완료한 규칙 id 목록(FR-PA2-3 — 페이지당 1번). */
  firedOnPage: readonly string[];
}

/**
 * 서버가 이미 우선순위(`position`) 순으로 내려준 규칙 배열에서 **첫 후보**를 고른다(EX-PA-3) —
 * 기기 포함 ∧ 닫은 규칙 아님 ∧ 이 페이지에서 아직 표시 안 함 ∧ 경로 조건 ∧ 체류 시간 충족 ∧
 * (`showUntil` 없음 ∨ 아직 지나지 않음).
 */
export function selectDueRule<T extends SelectableProactiveRule>(rules: readonly T[], ctx: SelectDueRuleContext): T | undefined {
  return rules.find((rule) => {
    if (!rule.devices.includes(ctx.device)) return false;
    if (ctx.closedRuleIds.includes(rule.id)) return false;
    if (ctx.firedOnPage.includes(rule.id)) return false;
    if (rule.showUntil !== undefined) {
      const untilMs = typeof rule.showUntil === 'number' ? rule.showUntil : new Date(rule.showUntil).getTime();
      if (!Number.isNaN(untilMs) && ctx.nowMs >= untilMs) return false;
    }
    if (rule.trigger.kind !== 'PAGE_DWELL') return false;
    if (!matchesPathCondition(rule.trigger.pathInclude, rule.trigger.pathExclude, ctx.path)) return false;
    return ctx.dwellMs >= rule.trigger.dwellSec * 1000;
  });
}

export interface ProactiveGateCaps {
  maxPerSession: number;
  minIntervalSec: number;
  quietAfterUserMessageSec: number;
}

export interface ProactiveGateRecord {
  shownCount: number;
  lastShownAtMs?: number;
  optedOut: boolean;
  lastUserSendAtMs?: number;
}

export interface ProactiveGateInput {
  nowMs: number;
  caps: ProactiveGateCaps;
  record: ProactiveGateRecord;
  panelOpen: boolean;
  handoffConnected: boolean;
  launcherVisible: boolean;
  bubbleVisible: boolean;
  /**
   * FR-PA3-9·K-10 — **선택 필드**. `device`·`hostInputFocused`를 함께 채워야 검사가 동작한다(하나만
   * 채워도 무시 — 하위 호환). 호출자가 아직 안 채우면(둘 다 `undefined`) 기존 동작과 완전히 같다.
   *
   * - `device`: 이 게이트를 평가하는 규칙이 대상으로 삼은 기기 종류(`selectDueRule`의
   *   `SelectDueRuleContext.device`와 같은 값을 그대로 넘긴다). `'MOBILE'`이 아니면
   *   `hostInputFocused`는 무시된다(데스크톱은 가상 키보드가 없으므로 영향 없음).
   * - `hostInputFocused`: 휴대폰에서 호스트 페이지의 텍스트 입력 요소가 포커스 중인지(가상 키보드가
   *   떠 있다고 추정). 위젯(`apps/widget`) 구현 안내(다음 단계 — frontend-implementer):
   *   - 호스트 문서에 `focusin`/`focusout` 리스너를 등록해(캡처 불필요 — 두 이벤트 모두 버블링됨)
   *     `document.activeElement`가 `INPUT`·`TEXTAREA`·`[contenteditable]`(또는
   *     `isContentEditable === true`)인지 검사한 값을 컨트롤러 상태에 저장한다.
   *   - `focusin`에서 포커스된 요소가 위 조건에 맞으면 `true`, `focusout`에서 `false`로 되돌린다
   *     (포커스가 다른 입력으로 즉시 옮겨가는 경우도 각 이벤트가 정확히 한 번씩 오므로 안전).
   *   - 위젯 자신의 Shadow DOM 안 입력(예: 향후 자유 입력창)은 판정 대상이 아니다 — 호스트 페이지
   *     (`document`, 위젯 바깥)의 포커스만 본다(패널이 열려 있으면 이 필드와 무관하게 `PANEL_OPEN`이
   *     먼저 막으므로, 리스너는 패널이 닫혀 있을 때의 상태만 신경 쓰면 된다).
   *   - `device !== 'MOBILE'`이면 리스너 등록 자체를 생략해도 된다(계산 비용 0).
   */
  device?: ProactiveDeviceKind;
  hostInputFocused?: boolean;
}

export type ProactiveGateReason =
  | 'OPTED_OUT'
  | 'CAP_REACHED'
  | 'LAUNCHER_HIDDEN'
  | 'INTERVAL'
  | 'QUIET_AFTER_SEND'
  | 'PANEL_OPEN'
  | 'HANDOFF_CONNECTED'
  | 'BUBBLE_VISIBLE'
  | 'HOST_INPUT_FOCUSED';

export type ProactiveGateResult = { ok: true } | { ok: false; reason: ProactiveGateReason; final: boolean };

/**
 * §4.2 — `final: true`인 사유(끄기·상한·런처 숨김)는 컨트롤러가 틱·리스너를 멈춰야 함을 뜻한다.
 * 그 외(패널 열림·조용한 시간·간격·상담 연결 중·말풍선 이미 표시 중·호스트 입력 포커스)는 **일시적**
 * 이라 다음 틱에 다시 평가될 수 있다(R-6). `HOST_INPUT_FOCUSED`(FR-PA3-9·K-10)는 `PANEL_OPEN`과
 * 같은 취급 — 포커스가 빠지면(다음 틱에 `hostInputFocused`가 `false`/`undefined`로 바뀌면) 다시 통과할
 * 수 있다. `device`·`hostInputFocused` 둘 다 없으면(선택 필드) 이 검사는 항상 통과한다(하위 호환).
 */
export function evaluateProactiveGate(input: ProactiveGateInput): ProactiveGateResult {
  if (input.record.optedOut) return { ok: false, reason: 'OPTED_OUT', final: true };
  if (!input.launcherVisible) return { ok: false, reason: 'LAUNCHER_HIDDEN', final: true };
  if (input.record.shownCount >= input.caps.maxPerSession) return { ok: false, reason: 'CAP_REACHED', final: true };
  if (input.bubbleVisible) return { ok: false, reason: 'BUBBLE_VISIBLE', final: false };
  if (input.handoffConnected) return { ok: false, reason: 'HANDOFF_CONNECTED', final: false };
  if (input.panelOpen) return { ok: false, reason: 'PANEL_OPEN', final: false };
  if (input.device === 'MOBILE' && input.hostInputFocused === true) {
    return { ok: false, reason: 'HOST_INPUT_FOCUSED', final: false };
  }
  if (input.record.lastUserSendAtMs !== undefined) {
    const quietUntilMs = input.record.lastUserSendAtMs + input.caps.quietAfterUserMessageSec * 1000;
    if (input.nowMs < quietUntilMs) return { ok: false, reason: 'QUIET_AFTER_SEND', final: false };
  }
  if (input.record.lastShownAtMs !== undefined) {
    const intervalUntilMs = input.record.lastShownAtMs + input.caps.minIntervalSec * 1000;
    if (input.nowMs < intervalUntilMs) return { ok: false, reason: 'INTERVAL', final: false };
  }
  return { ok: true };
}

/**
 * 절전·스로틀로 벌어진 틱 간격을 과대 산입하지 않는다(최대 `tickMs`의 2배까지만 인정 — §6.2).
 */
export function accumulateDwell(prevAccMs: number, lastTickMs: number, nowMs: number, tickMs: number): number {
  const elapsed = Math.max(0, nowMs - lastTickMs);
  return prevAccMs + Math.min(elapsed, tickMs * 2);
}
