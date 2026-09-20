import type { OutputView } from '@chat-bot/shared-types/output-view';
import type { PublicChatbotConfig } from '@chat-bot/shared-types';

/**
 * DOM 무의존 상태/리듀서(FR-W-16). `ui/`가 `dispatch()` 결과로 화면을 그린다(단방향 `store + reducer`,
 * ADR-0012 — React 없이도 동일한 멘탈모델을 유지한다). §5.2 상태 전이 다이어그램을 그대로 구현한다.
 */
export type WidgetStatus = 'CLOSED' | 'OPENING' | 'OPEN' | 'SENDING' | 'ERROR' | 'DISABLED';
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
  | { type: 'RETRY_DISMISSED' };

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
    default:
      return state;
  }
}
