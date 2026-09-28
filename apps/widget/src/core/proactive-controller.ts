import {
  accumulateDwell,
  evaluateProactiveGate,
  normalizeProactivePath,
  selectDueRule,
  type ProactiveDeviceKind,
} from '@chat-bot/shared-types/proactive-eval';
import type { ProactiveButton, ProactiveEventKind } from '@chat-bot/shared-types';
import type { WireProactivePayload, WireProactiveRule } from '../api/public-client';
import { PROACTIVE_TICK_MS } from '../constants/proactive';
import { loadProactiveRecord, recordClosed, recordOptedOut, recordShown, recordUserSend, type ProactiveRecord } from './proactive-storage';
import type { ProactiveBubbleController } from '../ui/proactive-bubble';

/**
 * [신규 No.35] 체류 판정기(§6.2) — 타이머 1개(`setInterval(tick, 1000)`, 탭이 보일 때만) ·
 * `visibilitychange` 리스너 1개(이 컨트롤러가 등록·해제)로 페이지 머묾을 판정하고, 통과하면
 * 말풍선을 띄운다. **`location.pathname`만 읽는다**(PA-13) — `history.pushState`/`replaceState`
 * 가로채기 없음(SPA 대응은 매 틱 폴링, 최대 1초 지연).
 */
export interface ProactiveControllerDeps {
  slug: string;
  device: ProactiveDeviceKind;
  payload: WireProactivePayload;
  bubble: ProactiveBubbleController;
  /** 대화 패널이 열려 있는지(전송 중·대기 중 포함 — "대화 중"). */
  getPanelOpen: () => boolean;
  /** 상담원 연결 중(`CONNECTED`)인지 — 위젯 측 억제(FR-PA4-6). */
  getHandoffConnected: () => boolean;
  /** 런처가 화면에 보이는지(`showLauncher=false`·전체 화면 모드가 아니면 true). */
  getLauncherVisible: () => boolean;
  /** 사건 전송(보내고 잊기) — 컨트롤러는 결과를 기다리지 않는다(FR-PA5-7). */
  sendEvent: (ruleId: string, kind: ProactiveEventKind) => void;
  /** 버튼(또는 0버튼 규칙의 본문) 클릭 시 호출 — 앱이 패널을 열고 기존 버튼 처리로 이어간다. */
  onActivate: (button?: ProactiveButton) => void;
  /** 시험 전용 — 기본 `Date.now`. */
  now?: () => number;
}

export interface ProactiveControllerApi {
  start(): void;
  stop(): void;
  /** `handleSend()` 첫 줄의 선택 훅 — 조용한 시간(FR-PA4-5) 판정에 쓰인다. */
  noteUserSend(nowMs: number): void;
}

/**
 * FR-PA3-9·K-10 — 호스트 문서(위젯 Shadow DOM 바깥)의 현재 포커스 요소가 텍스트 입력류(가상 키보드를
 * 띄울 만한 요소)인지 검사한다. `INPUT`·`TEXTAREA`·`contenteditable` 요소만 해당한다.
 */
function isHostInputElement(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return true;
  if ((el as HTMLElement).isContentEditable === true) return true;
  // jsdom(시험 환경)은 `isContentEditable`를 구현하지 않는다(항상 undefined) — 실제 브라우저에서는
  // 위 검사만으로 충분하지만, 속성 자체(`contenteditable="true"`·`contenteditable=""`)도 함께 본다.
  const attr = el.getAttribute('contenteditable');
  return attr === 'true' || attr === '';
}

export function createProactiveController(deps: ProactiveControllerDeps): ProactiveControllerApi {
  const now = deps.now ?? (() => Date.now());
  let record: ProactiveRecord = loadProactiveRecord(deps.slug);
  let timerId: number | undefined;
  let currentPath = normalizeProactivePath(location.pathname);
  let dwellMs = 0;
  let lastTickMs = now();
  let firedOnPage = new Set<string>();
  let shownRuleId: string | undefined;
  let stopped = false;
  let visibilityHandler: (() => void) | undefined;
  let hostInputFocused = false;
  let hostFocusInHandler: (() => void) | undefined;
  let hostFocusOutHandler: (() => void) | undefined;

  function stop(): void {
    if (stopped) return;
    stopped = true;
    if (timerId !== undefined) {
      window.clearInterval(timerId);
      timerId = undefined;
    }
    if (visibilityHandler) {
      document.removeEventListener('visibilitychange', visibilityHandler);
      visibilityHandler = undefined;
    }
    if (hostFocusInHandler) {
      document.removeEventListener('focusin', hostFocusInHandler);
      hostFocusInHandler = undefined;
    }
    if (hostFocusOutHandler) {
      document.removeEventListener('focusout', hostFocusOutHandler);
      hostFocusOutHandler = undefined;
    }
  }

  function handleDismiss(rule: WireProactiveRule): void {
    deps.sendEvent(rule.id, 'DISMISSED');
    record = recordClosed(deps.slug, rule.id);
    shownRuleId = undefined;
  }

  function handleOptOut(rule: WireProactiveRule): void {
    deps.sendEvent(rule.id, 'OPTED_OUT');
    record = recordOptedOut(deps.slug);
    shownRuleId = undefined;
    stop();
  }

  function handleActivate(rule: WireProactiveRule, button?: ProactiveButton): void {
    deps.sendEvent(rule.id, 'CLICKED');
    shownRuleId = undefined;
    deps.onActivate(button);
  }

  function showRule(rule: WireProactiveRule): void {
    firedOnPage.add(rule.id);
    shownRuleId = rule.id;
    record = recordShown(deps.slug, now());
    deps.sendEvent(rule.id, 'SHOWN');
    deps.bubble.show(rule, {
      onActivate: (button) => handleActivate(rule, button),
      onDismiss: () => handleDismiss(rule),
      onOptOut: () => handleOptOut(rule),
    });
  }

  function tick(): void {
    if (stopped) return;
    const nowMs = now();
    const nextPath = normalizeProactivePath(location.pathname);
    if (nextPath !== currentPath) {
      currentPath = nextPath;
      dwellMs = 0;
      firedOnPage = new Set();
    } else {
      dwellMs = accumulateDwell(dwellMs, lastTickMs, nowMs, PROACTIVE_TICK_MS);
    }
    lastTickMs = nowMs;

    if (shownRuleId !== undefined) return; // 이미 표시 중 — 후보 재선정 불필요(게이트가 BUBBLE_VISIBLE로 걸러도 동일)

    const candidate = selectDueRule(deps.payload.rules, {
      path: currentPath,
      dwellMs,
      device: deps.device,
      nowMs,
      closedRuleIds: record.closedRuleIds,
      firedOnPage: Array.from(firedOnPage),
    });
    if (!candidate) return;

    const gate = evaluateProactiveGate({
      nowMs,
      caps: deps.payload.caps,
      record,
      panelOpen: deps.getPanelOpen(),
      handoffConnected: deps.getHandoffConnected(),
      launcherVisible: deps.getLauncherVisible(),
      bubbleVisible: deps.bubble.isVisible(),
      device: deps.device,
      hostInputFocused,
    });
    if (gate.ok) {
      showRule(candidate);
      return;
    }
    if (gate.final) stop();
  }

  function onVisibilityChange(): void {
    if (document.hidden) {
      if (timerId !== undefined) {
        window.clearInterval(timerId);
        timerId = undefined;
      }
      return;
    }
    if (stopped) return;
    lastTickMs = now();
    if (timerId === undefined) {
      timerId = window.setInterval(tick, PROACTIVE_TICK_MS);
    }
  }

  function start(): void {
    if (record.optedOut) return; // OPTED_OUT — 틱·리스너를 아예 시작하지 않는다(final 사유 선반영).
    visibilityHandler = onVisibilityChange;
    document.addEventListener('visibilitychange', visibilityHandler);
    if (deps.device === 'MOBILE') {
      // FR-PA3-9·K-10 — 모바일 대상 규칙일 때만 호스트 문서(위젯 바깥) 포커스를 관찰한다(데스크톱은
      // 가상 키보드가 없으므로 리스너 등록 자체를 생략 — 계산 비용 0).
      hostFocusInHandler = () => {
        hostInputFocused = isHostInputElement(document.activeElement);
      };
      hostFocusOutHandler = () => {
        hostInputFocused = false;
      };
      document.addEventListener('focusin', hostFocusInHandler);
      document.addEventListener('focusout', hostFocusOutHandler);
    }
    if (!document.hidden) {
      timerId = window.setInterval(tick, PROACTIVE_TICK_MS);
    }
  }

  function noteUserSend(nowMs: number): void {
    record = recordUserSend(deps.slug, nowMs);
  }

  return { start, stop, noteUserSend };
}
