import { toOutputViews, isSafeHttpUrl, type ButtonActionView } from '@chat-bot/shared-types/output-view';
import { evaluateHeaderContrast } from '@chat-bot/shared-types/contrast';
import type { ButtonAction, PendingAnswerPollResponse, PublicChatbotConfig } from '@chat-bot/shared-types';
import { MESSAGES } from '../constants/messages';
import { createPublicClient, PublicApiError, type PublicApiErrorKind } from '../api/public-client';
import { getOrCreateSessionId, loadConversationState, saveConversationState } from '../core/session';
import { createInitialState, reducer, type WidgetAction, type WidgetErrorKind } from '../core/store';
import { createPendingPollConfig, decideNextPollAction, nextPollDelayMs, type PendingPollResultKind } from '../core/pending-poll';
import type { WidgetMount } from './shadow-root';
import { createLauncher } from './launcher';
import { createPanel } from './panel';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
  // PENDING 폴링 세대 카운터(EX-N2-11) — 도중 새 질문을 보내면 증가시켜 이전 폴링 루프를 폐기한다.
  let pollGeneration = 0;

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
        undefined,
        // 퀵리플라이는 관리자가 직접 구성한 메뉴이지 되묻기 후보가 아니다(FR-W-15) — 라벨 길이와
        // 무관하게 항상 가로 배치를 유지한다(code-reviewer 지적, Medium).
        { allowStackedLayout: false },
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

  /**
   * PENDING(2단계 RAG) 백그라운드 완료를 폴링한다(`nlu-rag-answering-ui-spec.md` §4.4.3, ADR-0023).
   * `core/pending-poll.ts`의 순수 함수로 간격·상한을 계산하고, 여기서는 `setTimeout`/`fetch`
   * 부수효과만 수행한다. `pollGeneration`이 호출 시점과 달라지면(새 질문 전송) 조용히 중단한다.
   */
  async function pollPendingAnswer(pendingId: string, pollAfterMs: number): Promise<void> {
    const generation = ++pollGeneration;
    const config = createPendingPollConfig(pollAfterMs);
    const startedAt = Date.now();
    let attempt = 0;

    panel.messages.addPendingIndicator(pendingId);
    // #cb-status에는 진입 시 1회만 기록한다 — 매 폴링 tick마다 갱신하지 않는다(FR-N2-39).
    panel.setStatusText(MESSAGES.pending.statusAnnounce);

    for (;;) {
      await sleep(nextPollDelayMs(attempt, config));
      if (generation !== pollGeneration) return; // 이전 폴링 폐기(EX-N2-11)

      let payload: PendingAnswerPollResponse | null = null;
      let resultKind: PendingPollResultKind;
      try {
        payload = await client.pollMessage(pendingId);
        if (payload.status === 'READY') resultKind = { kind: 'READY' };
        else if (payload.status === 'FAILED') resultKind = { kind: 'FAILED' };
        else if (payload.status === 'EXPIRED') resultKind = { kind: 'EXPIRED' };
        else resultKind = { kind: 'PENDING' };
      } catch (e) {
        resultKind = e instanceof PublicApiError && e.kind === 'NOT_FOUND' ? { kind: 'EXPIRED' } : { kind: 'NETWORK_ERROR' };
      }
      if (generation !== pollGeneration) return;

      const decision = decideNextPollAction(resultKind, Date.now() - startedAt, config);
      if (decision.action === 'CONTINUE') {
        attempt += 1;
        continue;
      }

      panel.messages.removePendingIndicator(pendingId);
      dispatch({ type: 'PENDING_RESOLVED' });
      panel.composer.setDisabled(false);

      if (decision.reason === 'READY' && payload) {
        panel.setStatusText(MESSAGES.pending.readyAnnounce);
        await panel.messages.addBotAnswer(pendingId, toOutputViews(payload.outputs ?? []), payload.sources, handleButtonAction);
      } else if (decision.reason === 'FAILED' && payload) {
        panel.setStatusText(MESSAGES.pending.timeoutFallback);
        await panel.messages.addBotAnswer(pendingId, toOutputViews(payload.outputs ?? []), undefined, handleButtonAction);
      } else {
        // EXPIRED(404/TTL 만료) 또는 TIMEOUT(90초 초과, 로컬 판단) — 서버 응답이 없으므로
        // 클라이언트가 정리 문구로 마감한다(S-15, 오류로 표시하지 않는다).
        panel.setStatusText(MESSAGES.pending.timeoutFallback);
        await panel.messages.addBotAnswer(
          pendingId,
          [{ type: 'TEXT', payload: { text: MESSAGES.pending.timeoutFallback } }],
          undefined,
          handleButtonAction,
        );
      }
      panel.composer.focus();
      window.setTimeout(() => panel.setStatusText(''), 2000);
      return;
    }
  }

  async function handleSend(input: { message?: string; buttonAction?: ButtonAction }): Promise<void> {
    if (state.status === 'SENDING' || disabledPermanently) return;
    if (state.status === 'AWAITING_ANSWER') {
      // 도중 새 질문 전송 — 이전 폴링을 폐기하고 인디케이터를 즉시 제거한다(EX-N2-11).
      pollGeneration += 1;
      panel.messages.removePendingIndicator();
      panel.setStatusText('');
    }
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
      if (res.pendingAnswer) {
        // PENDING — 인터림 안내 말풍선(서버가 내려준 일반 TEXT 아웃풋)만 먼저 렌더하고, 입력은
        // 잠그지 않는다(FR-N2-38, AWAITING_ANSWER는 SENDING과 달리 입력 잠금이 없다).
        await panel.messages.addBotOutputs(views, handleButtonAction);
        dispatch({ type: 'PENDING_STARTED' });
        panel.composer.setDisabled(false);
        panel.composer.focus();
        void pollPendingAnswer(res.pendingAnswer.id, res.pendingAnswer.pollAfterMs);
        return;
      }
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
