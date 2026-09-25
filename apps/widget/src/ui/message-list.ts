import type { ButtonActionView, OutputView } from '@chat-bot/shared-types/output-view';
import type { ButtonItem, PendingAnswerSource } from '@chat-bot/shared-types';
import { planPauseSchedule } from '../core/pause-schedule';
import { renderOutputView, type ButtonGroupOptions } from './renderers';
import { renderSourceList } from './renderers/sources';
import { renderButtonGroup } from './renderers/button';
import { createPendingIndicator, removePendingIndicator as removePendingIndicatorDom } from './renderers/pending-indicator';
import { createFeedbackBar, type FeedbackBarBinding } from './feedback-bar';
import { MESSAGES } from '../constants/messages';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function renderPlainText(text: string): HTMLElement {
  const p = document.createElement('p');
  p.className = 'cb-msg-text';
  p.textContent = text;
  return p;
}

export interface MessageListController {
  root: HTMLElement;
  addUserText(text: string): void;
  addSystemText(text: string): void;
  addErrorText(text: string, onRetry?: () => void): void;
  /**
   * [No.24] 상담원 메시지 — 기존 `wrapMessage`/`bubble` 패턴을 확장한다(ADR-0036 §4.2·§4.3, 새 DOM
   * 체계 없음). 보이는 텍스트 라벨 "상담원"을 말풍선 안에 함께 렌더한다(색상 단독 구분 금지, NFR-CSA5).
   * `textContent`만 삽입한다(URL 자동 링크 없음, FR-CS5-2).
   */
  addAgentText(text: string): void;
  /**
   * [No.24] 상담 종료 시 서버가 스냅샷으로 전달한 "종료 후 버튼"(`action.kind==='NODE'`)을 기존
   * `BUTTON` 렌더러로 그린다(새 버튼 종류 0건, FR-CS9-6). 클릭하면 일반 `NODE` 버튼과 동일하게
   * `onButtonAction`으로 위임한다 — 엔진이 정상 진행한다(상담은 이미 끝난 뒤이므로 노드가 실행된다).
   */
  addSystemAction(action: { label: string; nodeId: string }, onButtonAction: (action: ButtonActionView) => void): void;
  /**
   * `PAUSE` 아웃풋만큼 지연 후 다음 아웃풋을 렌더한다(FR-W-7). `onTyping`으로 대기 상태를 알린다.
   * `buttonGroupOptions`는 이 호출로 렌더되는 `BUTTON` 아웃풋 전부에 적용된다(예: 인사말 퀵리플라이는
   * `{ allowStackedLayout: false }`로 되묻기 전용 세로 스택 레이아웃에서 제외한다).
   * `feedback`(No.44, 선택)이 있을 때만 — 서버 응답에 `feedback.rateable === true`가 있던
   * 말풍선에만 — 렌더 직후 같은 삽입 동작으로 평가 막대를 붙인다(`feedback-loop-ui-spec.md` §3.2.1).
   */
  addBotOutputs(
    views: OutputView[],
    onButtonAction: (action: ButtonActionView) => void,
    onTyping?: (active: boolean) => void,
    buttonGroupOptions?: ButtonGroupOptions,
    feedback?: FeedbackBarBinding,
  ): Promise<void>;
  /**
   * PENDING 최종 답변(§4.4.2-4) — 아웃풋 + 출처를 같은 말풍선에 렌더한다. `messageId`는 이번
   * 답변이 그 이전의 인터림 안내 말풍선과 구분되는 **새 노드**임을 보장하기 위한 식별용일 뿐,
   * 기존 노드를 찾아 수정하지 않는다(`aria-relevant="additions"` 계약 유지). `feedback`(No.44,
   * 선택)은 보류 RAG 최종 답변(READY·FAILED)에만 — 인터림 안내·정리 문구에는 전달하지 않는다.
   */
  addBotAnswer(
    messageId: string,
    views: OutputView[],
    sources: PendingAnswerSource[] | undefined,
    onButtonAction: (action: ButtonActionView) => void,
    feedback?: FeedbackBarBinding,
  ): Promise<void>;
  /** 진행 인디케이터를 봇 메시지 다음에 추가한다(§4.4.2-2). */
  addPendingIndicator(messageId: string): void;
  /** `messageId`를 지정하면 해당 인디케이터만, 생략하면 전부 제거한다(§4.4.2-3/4). */
  removePendingIndicator(messageId?: string): void;
}

/** `#cb-messages` — `role="log" aria-live="polite"`(FR-W-21). 새 메시지마다 스크롤을 끝으로 이동한다. */
export function createMessageList(): MessageListController {
  const root = document.createElement('div');
  root.id = 'cb-messages';
  root.className = 'cb-messages';
  root.setAttribute('role', 'log');
  root.setAttribute('aria-live', 'polite');
  root.setAttribute('aria-relevant', 'additions');
  root.tabIndex = 0;

  function scrollToEnd(): void {
    root.scrollTop = root.scrollHeight;
  }

  function wrapMessage(role: 'bot' | 'user' | 'system' | 'error' | 'agent'): HTMLElement {
    const el = document.createElement('div');
    el.className = `cb-msg cb-msg-${role}`;
    return el;
  }

  function bubble(): HTMLElement {
    const b = document.createElement('div');
    b.className = 'cb-bubble';
    return b;
  }

  function addPlainText(role: 'bot' | 'user', text: string): void {
    const el = wrapMessage(role);
    const b = bubble();
    b.appendChild(renderPlainText(text));
    el.appendChild(b);
    root.appendChild(el);
    scrollToEnd();
  }

  return {
    root,
    addUserText(text) {
      addPlainText('user', text);
    },
    addSystemText(text) {
      const el = wrapMessage('system');
      el.textContent = text;
      root.appendChild(el);
      scrollToEnd();
    },
    addErrorText(text, onRetry) {
      const el = wrapMessage('error');
      const b = bubble();
      b.setAttribute('role', 'alert');
      b.appendChild(renderPlainText(text));
      if (onRetry) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'cb-retry';
        btn.textContent = MESSAGES.retry;
        btn.addEventListener('click', onRetry);
        b.appendChild(btn);
      }
      el.appendChild(b);
      root.appendChild(el);
      scrollToEnd();
    },
    async addBotOutputs(views, onButtonAction, onTyping, buttonGroupOptions, feedback) {
      const el = wrapMessage('bot');
      const b = bubble();
      el.appendChild(b);
      // [No.44] 말풍선이 #cb-messages에 추가되는 같은 삽입 동작 안에서 평가 막대를 붙인다 —
      // root.appendChild(el) 이후 새 노드를 추가하지 않는다(재낭독 방지, §3.2.1).
      if (feedback) {
        el.appendChild(createFeedbackBar(feedback));
      }
      root.appendChild(el);
      scrollToEnd();
      await renderViewsIntoBubble(b, views, onButtonAction, onTyping, buttonGroupOptions);
      scrollToEnd();
    },
    async addBotAnswer(_messageId, views, sources, onButtonAction, feedback) {
      const el = wrapMessage('bot');
      const b = bubble();
      el.appendChild(b);
      if (feedback) {
        el.appendChild(createFeedbackBar(feedback));
      }
      root.appendChild(el);
      scrollToEnd();
      await renderViewsIntoBubble(b, views, onButtonAction);
      const sourceBlock = sources && sources.length > 0 ? renderSourceList(sources) : null;
      if (sourceBlock) {
        b.appendChild(sourceBlock);
      }
      scrollToEnd();
    },
    addPendingIndicator(messageId) {
      root.appendChild(createPendingIndicator(messageId));
      scrollToEnd();
    },
    removePendingIndicator(messageId) {
      removePendingIndicatorDom(root, messageId);
    },
    addAgentText(text) {
      const el = wrapMessage('agent');
      const b = bubble();
      b.classList.add('cb-bubble-agent');
      const label = document.createElement('span');
      label.className = 'cb-agent-label';
      label.textContent = MESSAGES.agentLabel;
      b.appendChild(label);
      b.appendChild(renderPlainText(text));
      el.appendChild(b);
      root.appendChild(el);
      scrollToEnd();
    },
    addSystemAction(action, onButtonAction) {
      const el = wrapMessage('bot');
      const b = bubble();
      const item: ButtonItem = { label: action.label, action: 'NODE', value: action.nodeId };
      b.appendChild(renderButtonGroup([item], onButtonAction));
      el.appendChild(b);
      root.appendChild(el);
      scrollToEnd();
    },
  };
}

/** `addBotOutputs`/`addBotAnswer`가 공유하는 아웃풋 렌더링 루프(PAUSE 지연 포함, FR-W-7). */
async function renderViewsIntoBubble(
  b: HTMLElement,
  views: OutputView[],
  onButtonAction: (action: ButtonActionView) => void,
  onTyping?: (active: boolean) => void,
  buttonGroupOptions?: ButtonGroupOptions,
): Promise<void> {
  const delays = planPauseSchedule(views);
  let renderedAny = false;
  for (let i = 0; i < views.length; i += 1) {
    const view = views[i];
    if (view.type === 'PAUSE') {
      const ms = delays[i] ?? 0;
      if (ms > 0) {
        onTyping?.(true);
        await sleep(ms);
        onTyping?.(false);
      }
      continue;
    }
    const node = renderOutputView(view, onButtonAction, buttonGroupOptions);
    if (node) {
      b.appendChild(node);
      renderedAny = true;
    }
  }
  if (!renderedAny) {
    // 응답 아웃풋이 0건이어도 빈 말풍선을 두지 않는다(EX-W-6).
    b.appendChild(renderPlainText(MESSAGES.emptyOutputsFallback));
  }
}
