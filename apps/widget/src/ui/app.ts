import { toOutputViews, isSafeHttpUrl, type ButtonActionView } from '@chat-bot/shared-types/output-view';
import { evaluateHeaderContrast } from '@chat-bot/shared-types/contrast';
import type { ButtonAction, PublicChatbotConfig } from '@chat-bot/shared-types';
import { MESSAGES } from '../constants/messages';
import { createPublicClient, PublicApiError, type PublicApiErrorKind } from '../api/public-client';
import { getOrCreateSessionId, loadConversationState, saveConversationState } from '../core/session';
import { createInitialState, reducer, type WidgetAction, type WidgetErrorKind } from '../core/store';
import type { WidgetMount } from './shadow-root';
import { createLauncher } from './launcher';
import { createPanel } from './panel';

export interface WidgetAppOptions {
  slug: string;
  apiBase: string;
  /** `desktop`/`mobile`(FR-W-2 스니펫 계약). `mobile`은 패널이 뷰포트 전체를 차지한다(§8.2). */
  mode: 'desktop' | 'mobile';
  /** `data-fullscreen="true"` 또는 `/c/:slug` — 런처 없이 바로 `OPEN` 상태로 시작한다. */
  autoOpen: boolean;
  /** `/c/:slug` 정적 위치(왼쪽 하단 런처 대응은 이 옵션과 무관, config 응답의 `launcherPosition` 반영). */
}

function errorKindToMessage(kind: PublicApiErrorKind | WidgetErrorKind): string {
  switch (kind) {
    case 'RATE_LIMITED':
      return MESSAGES.errorRateLimited;
    case 'NETWORK':
      return MESSAGES.errorNetwork;
    case 'DISABLED':
      return MESSAGES.errorDisabled;
    default:
      return MESSAGES.errorUnknown;
  }
}

/** 위젯 전체 조립 — `core/`(store·session·button-action·pause-schedule)와 `ui/`를 연결한다(§5.2~5.6). */
export function createWidgetApp(mount: WidgetMount, options: WidgetAppOptions): void {
  const client = createPublicClient(options.apiBase, options.slug);
  let state = createInitialState();
  let disabledPermanently = false;

  const cbRoot = document.createElement('div');
  cbRoot.className = 'cb-root';
  cbRoot.dataset.state = 'closed';
  if (options.mode === 'mobile') cbRoot.dataset.mode = 'mobile';
  if (options.autoOpen) cbRoot.dataset.fullscreen = 'true';

  function dispatch(action: WidgetAction): void {
    state = reducer(state, action);
    cbRoot.dataset.state = state.status.toLowerCase();
  }

  function handleButtonAction(action: ButtonActionView): void {
    if (action.kind === 'LINK') {
      if (action.href) window.open(action.href, '_blank', 'noopener,noreferrer');
      return;
    }
    if (action.kind === 'MESSAGE') {
      const text = action.text ?? action.label;
      panel.messages.addUserText(text);
      void handleSend({ message: text });
      return;
    }
    // NODE — FR-W-6: 서버 전송만 한다(사용자 말풍선 추가는 규격에 없음).
    void handleSend({ buttonAction: { kind: 'NODE', nodeId: action.nodeId as string, label: action.label } });
  }

  const launcher = createLauncher(() => void handleOpen());
  const panel = createPanel(
    () => handleClose(),
    (text) => {
      panel.messages.addUserText(text);
      void handleSend({ message: text });
    },
  );

  cbRoot.append(launcher.root, panel.root);
  mount.container.appendChild(cbRoot);

  if (options.autoOpen) {
    launcher.root.hidden = true;
  }

  function applySkin(config: PublicChatbotConfig): void {
    const primary = config.skin.primaryColor;
    cbRoot.style.setProperty('--cb-primary', primary);
    const contrast = evaluateHeaderContrast(primary);
    cbRoot.style.setProperty('--cb-header-text', contrast?.suggestedTextColor === 'black' ? '#111827' : '#ffffff');
    panel.title.textContent = config.skin.headerTitle;
    if (config.skin.logoUrl && isSafeHttpUrl(config.skin.logoUrl)) {
      panel.logo.src = config.skin.logoUrl;
      panel.logo.hidden = false;
    }
    if (config.launcherPosition === 'LEFT') {
      cbRoot.dataset.position = 'left';
    }
    if (!config.showLauncher && !options.autoOpen) {
      launcher.root.hidden = true;
    }
  }

  function renderGreeting(config: PublicChatbotConfig): void {
    if (config.greetingMessage) {
      void panel.messages.addBotOutputs([{ type: 'TEXT', payload: { text: config.greetingMessage } }], handleButtonAction);
    }
    if (config.quickReplies.length > 0) {
      void panel.messages.addBotOutputs(
        [{ type: 'BUTTON', payload: { buttons: config.quickReplies.map((label) => ({ label, action: 'MESSAGE' as const, value: label })) } }],
        handleButtonAction,
      );
    }
  }

  async function handleOpen(): Promise<void> {
    panel.setOpen(true);
    launcher.setExpanded(true);
    if (state.status === 'OPEN' || state.status === 'DISABLED') {
      panel.composer.focus();
      return;
    }
    if (disabledPermanently) {
      panel.composer.focus();
      return;
    }
    dispatch({ type: 'OPEN_REQUESTED' });
    try {
      const config = await client.getConfig();
      applySkin(config);
      const alreadyGreeted = state.greetingShown;
      dispatch({ type: 'CONFIG_LOADED', config });
      if (!alreadyGreeted) renderGreeting(config);
      panel.composer.focus();
    } catch (e) {
      if (e instanceof PublicApiError && e.kind === 'DISABLED') {
        dispatch({ type: 'CONFIG_DISABLED' });
        panel.messages.addSystemText(MESSAGES.errorDisabled);
        panel.composer.setDisabled(true);
        return;
      }
      if (e instanceof PublicApiError && e.kind === 'NOT_FOUND') {
        // 런처 자체를 렌더하지 않는다(FR-W-10) — 이미 마운트했으므로 제거하고 경고만 남긴다.
        console.warn(`[ChatBotWidget] 챗봇을 찾을 수 없습니다: ${options.slug}`);
        mount.hostElement.remove();
        return;
      }
      const kind: WidgetErrorKind = e instanceof PublicApiError && e.kind === 'RATE_LIMITED' ? 'RATE_LIMITED' : e instanceof PublicApiError && e.kind === 'NETWORK' ? 'NETWORK' : 'UNKNOWN';
      dispatch({ type: 'CONFIG_FAILED', kind, message: String(e) });
      panel.messages.addErrorText(errorKindToMessage(kind), () => void handleOpen());
    }
  }

  function handleClose(): void {
    dispatch({ type: 'CLOSE' });
    panel.setOpen(false);
    launcher.setExpanded(false);
    launcher.focus();
  }

  async function handleSend(input: { message?: string; buttonAction?: ButtonAction }): Promise<void> {
    if (state.status === 'SENDING' || disabledPermanently) return;
    const sessionId = getOrCreateSessionId(options.slug);
    const savedState = loadConversationState(options.slug);
    dispatch({ type: 'SEND_STARTED' });
    panel.composer.setDisabled(true);
    panel.setStatusText(MESSAGES.sending);
    try {
      const res = await client.sendMessage({ sessionId, message: input.message, buttonAction: input.buttonAction, state: savedState });
      saveConversationState(options.slug, res.state);
      if (res.stateReset) {
        panel.messages.addSystemText(MESSAGES.stateResetNotice);
      }
      const views = toOutputViews(res.outputs);
      await panel.messages.addBotOutputs(views, handleButtonAction, (typing) => panel.setStatusText(typing ? MESSAGES.sending : ''));
      dispatch({ type: 'SEND_SUCCEEDED', botMessages: [] });
      panel.setStatusText('');
      panel.composer.setDisabled(false);
      panel.composer.focus();
    } catch (e) {
      panel.setStatusText('');
      panel.composer.setDisabled(false);
      if (e instanceof PublicApiError && e.kind === 'DISABLED') {
        disabledPermanently = true;
        dispatch({ type: 'CONFIG_DISABLED' });
        panel.messages.addSystemText(MESSAGES.errorDisabled);
        panel.composer.setDisabled(true);
        return;
      }
      const kind: WidgetErrorKind = e instanceof PublicApiError && e.kind === 'RATE_LIMITED' ? 'RATE_LIMITED' : e instanceof PublicApiError && e.kind === 'NETWORK' ? 'NETWORK' : 'UNKNOWN';
      dispatch({ type: 'SEND_FAILED', kind, message: String(e) });
      const retry = kind === 'RATE_LIMITED' ? undefined : () => void handleSend(input);
      panel.messages.addErrorText(errorKindToMessage(kind), retry);
    }
  }

  if (options.autoOpen) {
    void handleOpen();
  }
}
