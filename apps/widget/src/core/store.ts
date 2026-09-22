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

export interface WidgetMessage {
  id: string;
  role: 'user' | 'bot' | 'system' | 'error';
  text?: string;
  outputs?: OutputView[];
}

export interface WidgetState {
  status: WidgetStatus;
  config: PublicChatbotConfig | null;
  messages: WidgetMessage[];
  error?: { kind: WidgetErrorKind; message: string };
  greetingShown: boolean;
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
  | { type: 'PENDING_RESOLVED' };

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
    default:
      return state;
  }
}
