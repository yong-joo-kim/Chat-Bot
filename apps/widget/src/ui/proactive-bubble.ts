import { isSafeHttpUrl } from '@chat-bot/shared-types/output-view';
import type { ProactiveButton } from '@chat-bot/shared-types';
import type { WireProactiveRule } from '../api/public-client';
import { PROACTIVE_MESSAGES } from '../constants/proactive';

/**
 * [신규 No.35] 위젯 — 런처 옆 말풍선(PA-W1, `proactive-messaging-ui-spec.md` §4). 패널(`#cb-panel`)과
 * 무관하게 런처의 형제 요소로 존재한다(패널 안 `#cb-status`는 이 파일이 건드리지 않는다, C-7).
 *
 * 다크 패턴 금지(FR-0-247)를 **구조적으로** 지킨다 — 이 파일에는 사람 이름·사진·"입력 중" 표시·
 * 카운트다운·읽지 않은 메시지 배지·소리·재확인창(`confirm(`)을 만들 수 있는 코드 자체가 없다.
 */
export interface ProactiveBubbleHandlers {
  /** `button`이 없으면 "본문 클릭"(FR-PA1-7) — 버튼 0개 규칙의 문구 영역 클릭과 같다. */
  onActivate: (button?: ProactiveButton) => void;
  onDismiss: () => void;
  onOptOut: () => void;
}

export interface ProactiveBubbleController {
  /** 런처의 형제로 `cbRoot`에 붙일 컨테이너. */
  root: HTMLElement;
  /** 패널 밖 전용 알림 영역(`role="status"`, NFR-PAA2) — 패널 안 `#cb-status`와 별개. */
  statusRegion: HTMLElement;
  show(rule: WireProactiveRule, handlers: ProactiveBubbleHandlers): void;
  hide(): void;
  isVisible(): boolean;
}

/**
 * `focusLauncher`는 닫기(×)·Esc 처리 안에서만 호출한다(PA-18 — `.focus(` 호출이 표시 함수 본문에
 * 있으면 봉인 시험이 실패한다). `show()`는 `.focus()`·`scrollIntoView()`를 호출하지 않는다(AC-PA3-5).
 */
export function createProactiveBubble(focusLauncher: () => void): ProactiveBubbleController {
  const root = document.createElement('div');
  root.id = 'cb-pa-bubble';
  root.className = 'cb-pa-bubble';
  root.hidden = true;

  const statusRegion = document.createElement('div');
  statusRegion.id = 'cb-pa-status';
  statusRegion.className = 'cb-sr-only';
  statusRegion.setAttribute('role', 'status');
  statusRegion.setAttribute('aria-live', 'polite');

  let visible = false;
  let lastAnnouncedRuleId: string | undefined;
  let keydownHandler: ((e: KeyboardEvent) => void) | undefined;

  function hide(): void {
    if (!visible) return;
    visible = false;
    root.hidden = true;
    root.textContent = '';
    if (keydownHandler) {
      root.removeEventListener('keydown', keydownHandler);
      keydownHandler = undefined;
    }
  }

  function closeAndFocusLauncher(handlers: ProactiveBubbleHandlers, kind: 'dismiss' | 'optOut'): void {
    hide();
    if (kind === 'dismiss') handlers.onDismiss();
    else handlers.onOptOut();
    // ★ PA-18: `.focus(` 호출은 이 함수(닫기/Esc 처리) 안에만 있어야 한다.
    focusLauncher();
  }

  function makeButtonEl(labelText: string, ariaLabel: string, onClick: () => void): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cb-pa-btn';
    btn.textContent = labelText;
    if (ariaLabel !== labelText) btn.setAttribute('aria-label', ariaLabel);
    btn.addEventListener('click', onClick);
    return btn;
  }

  function show(rule: WireProactiveRule, handlers: ProactiveBubbleHandlers): void {
    root.textContent = '';

    const label = document.createElement('span');
    label.className = 'cb-pa-label';
    label.textContent = PROACTIVE_MESSAGES.defaultLabel;
    root.appendChild(label);

    if (rule.buttons.length === 0) {
      // FR-PA1-7 — 버튼이 0개면 문구 영역 전체가 "대화 열기" 버튼이다.
      const bodyBtn = makeButtonEl(rule.text, PROACTIVE_MESSAGES.bodyButtonAriaLabel, () => {
        hide();
        handlers.onActivate(undefined);
      });
      bodyBtn.className = 'cb-pa-body-button';
      root.appendChild(bodyBtn);
    } else {
      const text = document.createElement('p');
      text.className = 'cb-pa-text';
      text.textContent = rule.text;
      root.appendChild(text);

      const actions = document.createElement('div');
      actions.className = 'cb-pa-actions';
      for (const button of rule.buttons) {
        if (button.action === 'LINK') {
          const a = document.createElement('a');
          a.className = 'cb-pa-btn cb-pa-link';
          a.textContent = button.label;
          a.target = '_blank';
          a.rel = 'noopener noreferrer';
          a.href = isSafeHttpUrl(button.value) ? button.value : '#';
          a.addEventListener('click', () => {
            hide();
            handlers.onActivate(button);
          });
          actions.appendChild(a);
        } else {
          actions.appendChild(
            makeButtonEl(button.label, button.label, () => {
              hide();
              handlers.onActivate(button);
            }),
          );
        }
      }
      root.appendChild(actions);
    }

    const footer = document.createElement('div');
    footer.className = 'cb-pa-footer';
    footer.appendChild(makeButtonEl(PROACTIVE_MESSAGES.dismissLabel, PROACTIVE_MESSAGES.dismissLabel, () => closeAndFocusLauncher(handlers, 'dismiss')));
    footer.appendChild(makeButtonEl(PROACTIVE_MESSAGES.optOutLabel, PROACTIVE_MESSAGES.optOutLabel, () => closeAndFocusLauncher(handlers, 'optOut')));
    root.appendChild(footer);

    keydownHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closeAndFocusLauncher(handlers, 'dismiss');
      }
    };
    root.addEventListener('keydown', keydownHandler);

    visible = true;
    root.hidden = false;
    // NFR-PAA2 — 같은 말풍선(같은 규칙)을 다시 낭독하지 않는다(AC-PA8-2).
    if (lastAnnouncedRuleId !== rule.id) {
      statusRegion.textContent = PROACTIVE_MESSAGES.statusAnnounce(rule.text);
      lastAnnouncedRuleId = rule.id;
    }
    // ★ PA-18 — 이 함수(show)는 `.focus(`·`scrollIntoView(`를 호출하지 않는다.
  }

  return { root, statusRegion, show, hide, isVisible: () => visible };
}
