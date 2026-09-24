import type { OutputView } from '@chat-bot/shared-types/output-view';
import type { PublicChatbotConfig } from '@chat-bot/shared-types';

/**
 * DOM 무의존 상태/리듀서(FR-W-16). `ui/`가 `dispatch()` 결과로 화면을 그린다(단방향 `store + reducer`,
 * ADR-0012 — React 없이도 동일한 멘탈모델을 유지한다). §5.2 상태 전이 다이어그램을 그대로 구현한다.
 */
/**
 * `AWAITING_ANSWER`(신규, ADR-0023)는 `SENDING`과 별개 상태다 — `SENDING`은 "요청을 보내고 짧게
 * 기다리는 중"이고, `AWAITING_ANSWER`는 "이미 PENDING 응답은 받았고 백그라운드 완료(최대 90초)를
 * 기다리는 중"이라 입력을 잠그지 않는다(FR-N2-38, `nlu-rag-answering-ui-spec.md` §4.4.1).
 */
export type WidgetStatus = 'CLOSED' | 'OPENING' | 'OPEN' | 'SENDING' | 'AWAITING_ANSWER' | 'ERROR' | 'DISABLED';
export type WidgetErrorKind = 'NETWORK' | 'RATE_LIMITED' | 'UNKNOWN';

/** [No.24] `'agent'` — 상담원 메시지(ADR-0036 §14.2). `message-list.ts`의 기존 `wrapMessage`/`bubble` 확장으로 렌더한다. */
export type WidgetMessage = {
  id: string;
  role: 'user' | 'bot' | 'system' | 'error' | 'agent';
  text?: string;
  outputs?: OutputView[];
};

export interface WidgetState {
  status: WidgetStatus;
  config: PublicChatbotConfig | null;
  messages: WidgetMessage[];
  error?: { kind: WidgetErrorKind; message: string };
  greetingShown: boolean;
  /**
   * [No.24, 신규 선택 필드] 기존 7상태와 **직교**한다 — 입력창을 잠그지 않는다(FR-CS9-2).
   * `createInitialState()`의 반환값은 이 키가 없는 상태로 **불변**이다(ADR-0036 §14.1).
   */
  handoff?: { mode: 'WATCHING' | 'CONNECTED' };
}

export type WidgetAction =
  | { type: 'OPEN_REQUESTED' }
  | { type: 'CONFIG_LOADED'; config: PublicChatbotConfig }
  | { type: 'CONFIG_DISABLED' }
  | { type: 'CONFIG_FAILED'; kind: WidgetErrorKind; message: string }
  | { type: 'CLOSE' }
  | { type: 'SEND_STARTED'; userMessage?: WidgetMessage }
  | { type: 'SEND_SUCCEEDED'; botMessages: WidgetMessage[] }
  | { type: 'SEND_FAILED'; kind: WidgetErrorKind; message: string }
  | { type: 'RETRY_DISMISSED' }
  /** PENDING 응답 수신 — 입력을 잠그지 않는 대기 상태로 전환한다(§4.4.1). */
  | { type: 'PENDING_STARTED' }
  /** 폴링 종료(READY/FAILED/EXPIRED/TIMEOUT 전부 포함) — 최종 말풍선은 호출부가 별도로 추가한다. */
  | { type: 'PENDING_RESOLVED' }
  /** [No.24] 관찰 창(WATCHING) 시작 — 화면 변화 없음, 순수 백그라운드 폴링(FR-CS9-2). */
  | { type: 'HANDOFF_WATCH_STARTED' }
  /** [No.24] 폴링이 토큰을 받아 상담 연결됨을 확인 — 최대 1회 연결 안내(§4.5). */
  | { type: 'HANDOFF_CONNECTED' }
  /** [No.24] 상담원/시스템 메시지 도착 — 렌더는 `ui/message-list.ts`가 직접 수행하므로 상태 전이는 없다. */
  | { type: 'HANDOFF_MESSAGES' }
  /** [No.24] 상담 종료(또는 `pollAfterMs:null`) — 폴링 중단, `handoff` 키를 다시 제거한다. */
  | { type: 'HANDOFF_ENDED' };

export function createInitialState(): WidgetState {
  return { status: 'CLOSED', config: null, messages: [], greetingShown: false };
}

function greetingMessages(state: WidgetState, config: PublicChatbotConfig): WidgetMessage[] {
  if (state.greetingShown) return [];
  const msgs: WidgetMessage[] = [];
  if (config.greetingMessage) {
    msgs.push({ id: 'cb-greeting', role: 'bot', text: config.greetingMessage });
  }
  if (config.quickReplies.length > 0) {
    msgs.push({
      id: 'cb-greeting-quick-replies',
      role: 'bot',
      outputs: [{ type: 'BUTTON', payload: { buttons: config.quickReplies.map((label) => ({ label, action: 'MESSAGE', value: label })) } }],
    });
  }
  return msgs;
}

export function reducer(state: WidgetState, action: WidgetAction): WidgetState {
  switch (action.type) {
    case 'OPEN_REQUESTED':
      return { ...state, status: 'OPENING' };
    case 'CONFIG_LOADED': {
      const greeting = greetingMessages(state, action.config);
      return {
        ...state,
        status: 'OPEN',
        config: action.config,
        messages: [...state.messages, ...greeting],
        greetingShown: true,
        error: undefined,
      };
    }
    case 'CONFIG_DISABLED':
      return { ...state, status: 'DISABLED' };
    case 'CONFIG_FAILED':
      return { ...state, status: 'ERROR', error: { kind: action.kind, message: action.message } };
    case 'CLOSE':
      return { ...state, status: 'CLOSED' };
    case 'SEND_STARTED':
      return {
        ...state,
        status: 'SENDING',
        error: undefined,
        messages: action.userMessage ? [...state.messages, action.userMessage] : state.messages,
      };
    case 'SEND_SUCCEEDED':
      return {
        ...state,
        status: state.status === 'DISABLED' ? 'DISABLED' : 'OPEN',
        messages: [...state.messages, ...action.botMessages],
      };
    case 'SEND_FAILED':
      return { ...state, status: 'ERROR', error: { kind: action.kind, message: action.message } };
    case 'RETRY_DISMISSED':
      return { ...state, status: state.config ? 'OPEN' : 'CLOSED', error: undefined };
    case 'PENDING_STARTED':
      return { ...state, status: 'AWAITING_ANSWER', error: undefined };
    case 'PENDING_RESOLVED':
      return { ...state, status: state.status === 'DISABLED' ? 'DISABLED' : 'OPEN' };
    case 'HANDOFF_WATCH_STARTED':
      return { ...state, handoff: { mode: 'WATCHING' } };
    case 'HANDOFF_CONNECTED':
      return { ...state, handoff: { mode: 'CONNECTED' } };
    case 'HANDOFF_MESSAGES':
      return state;
    case 'HANDOFF_ENDED': {
      const { handoff: _handoff, ...rest } = state;
      return rest;
    }
    default:
      return state;
  }
}
