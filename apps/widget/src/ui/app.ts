import { toOutputViews, isSafeHttpUrl, type ButtonActionView } from '@chat-bot/shared-types/output-view';
import { evaluateHeaderContrast } from '@chat-bot/shared-types/contrast';
import type { ButtonAction, HandoffPollMessage, PendingAnswerPollResponse, PublicChatbotConfig } from '@chat-bot/shared-types';
import { MESSAGES } from '../constants/messages';
import { createPublicClient, PublicApiError, type PublicApiErrorKind } from '../api/public-client';
import { getOrCreateSessionId, loadConversationState, saveConversationState } from '../core/session';
import { createInitialState, reducer, type WidgetAction, type WidgetErrorKind } from '../core/store';
import { createPendingPollConfig, decideNextPollAction, nextPollDelayMs, type PendingPollResultKind } from '../core/pending-poll';
import {
  createHandoffPollState,
  isPollingUnstable,
  nextDelayMs as nextHandoffDelayMs,
  onPendingResult,
  onPollFailure,
  onPollRateLimited,
  onPollResponse,
  onSendResponse,
  shouldPoll,
  type HandoffPollState,
} from '../core/handoff-poll';
import { clearHandoffToken, loadHandoffToken, saveHandoffToken } from '../core/handoff-storage';
import type { FeedbackAttemptResult, FeedbackRating } from '../core/feedback';
import type { WidgetMount } from './shadow-root';
import { createLauncher } from './launcher';
import { createPanel } from './panel';
import type { FeedbackBarBinding } from './feedback-bar';

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

  // [No.24] 상담 전용 짧은 폴링(ADR-0036 §14) — 보류 답변 폴링과 **독립된** 세대 카운터·타이머를 쓴다.
  let handoffPollState: HandoffPollState = createHandoffPollState();
  let handoffPollGeneration = 0;
  let handoffPollTimer: number | undefined;
  let handoffPollActive = false;
  // true인 동안은 "대기 중"(아직 fetch를 시작하지 않음) — 가시성 전환 시 이 구간에서만 안전하게
  // 재예약한다. fetch가 진행 중일 때 재예약하면 요청이 중첩된다(요청은 한 번에 하나만, §14.4).
  let handoffPollTimerPending = false;
  let handoffRestoreAttempted = false;

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
    // NODE — FR-W-6: 평소에는 서버 전송만 한다(사용자 말풍선 추가는 규격에 없음). 상담 중(CONNECTED)에는
    // 노드가 실행되지 않고 텍스트로 전달만 되므로(ADR-0036 §5.3 EX-CS-9), 사용자 자신의 말풍선으로
    // "[선택] {라벨}"을 보여준다(설계서 §4.5 — 서버로는 여전히 같은 buttonAction을 보낸다).
    if (handoffPollState.mode === 'CONNECTED') {
      panel.messages.addUserText(MESSAGES.handoffNodeSelectionPrefix(action.label));
    }
    void handleSend({ buttonAction: { kind: 'NODE', nodeId: action.nodeId as string, label: action.label } });
  }

  /**
   * [No.24] 상담 폴링 응답의 메시지를 렌더한다(ADR-0036 §14.2·§4.2). `AGENT`는 상담원 말풍선,
   * `SYSTEM`은 기존 `system` 역할(연결·종료·연결 실패 안내), `USER`는 새로고침 복구(`restore=true`)
   * 때만 온다. `action`(종료 후 버튼)은 기존 `BUTTON` 렌더러로 그린다(새 버튼 종류 0건).
   */
  function renderHandoffMessages(messages: HandoffPollMessage[]): void {
    for (const m of messages) {
      if (m.sender === 'AGENT') {
        panel.messages.addAgentText(m.text);
      } else if (m.sender === 'SYSTEM') {
        panel.messages.addSystemText(m.text);
        if (m.action?.kind === 'NODE') {
          panel.messages.addSystemAction({ label: m.action.label, nodeId: m.action.nodeId }, handleButtonAction);
        }
      } else {
        // USER(restore=true 한정) — 마스킹본, 자기 발화 복원(§14.3).
        panel.messages.addUserText(m.text);
      }
    }
  }

  /**
   * 폴링 루프를 완전히 멈춘다 — 대기 중인 타이머를 지우고 세대를 올려 이미 실행 중인(폐기 대상)
   * 콜백이 스스로 멈추게 한다(타이머 누수 방지, §14.4). 상담 종료·토큰 무효·위젯 파괴 시 호출한다.
   */
  function stopHandoffPolling(): void {
    handoffPollGeneration += 1;
    if (handoffPollTimer !== undefined) {
      window.clearTimeout(handoffPollTimer);
      handoffPollTimer = undefined;
    }
    handoffPollTimerPending = false;
    handoffPollActive = false;
  }

  /** 폴링 1회 시행(fetch 부수효과) — `core/handoff-poll.ts`의 순수 함수로 상태를 갱신한다. */
  async function runHandoffPollOnce(restore: boolean): Promise<void> {
    const sessionId = getOrCreateSessionId(options.slug);
    try {
      const res = await client.pollHandoff({ sessionId, token: handoffPollState.token, after: handoffPollState.cursor, restore });
      const prevMode = handoffPollState.mode;
      const outcome = onPollResponse(handoffPollState, res, Date.now());
      handoffPollState = outcome.state;

      if (prevMode !== 'CONNECTED' && handoffPollState.mode === 'CONNECTED') {
        panel.setStatusText(MESSAGES.handoffConnectAnnounce);
        dispatch({ type: 'HANDOFF_CONNECTED' });
      }

      renderHandoffMessages(res.messages);

      if (handoffPollState.token) {
        saveHandoffToken(options.slug, { token: handoffPollState.token, cursor: handoffPollState.cursor });
      }

      if (outcome.action === 'STOP') {
        if (prevMode === 'CONNECTED') {
          panel.setStatusText(MESSAGES.handoffEndAnnounce);
        } else if (prevMode === 'WATCHING') {
          panel.setStatusText(MESSAGES.handoffFailAnnounce);
        }
        dispatch({ type: 'HANDOFF_ENDED' });
        clearHandoffToken(options.slug);
        handoffPollState = createHandoffPollState();
        stopHandoffPolling();
        window.setTimeout(() => panel.setStatusText(''), 2000);
      }
    } catch (e) {
      if (e instanceof PublicApiError && e.kind === 'NOT_FOUND') {
        // 토큰 무효·교차·유예 경과 — 조용히 정리한다(§6.3).
        clearHandoffToken(options.slug);
        handoffPollState = createHandoffPollState();
        stopHandoffPolling();
        return;
      }
      // 네트워크 오류는 같은 간격으로 재시도한다(중단하지 않음, §6.5). 429(RATE_LIMITED)는 백오프한다
      // (세션당 40/분 한도, §7.3) — 다음 폴링 간격을 강제로 늘린다.
      handoffPollState =
        e instanceof PublicApiError && e.kind === 'RATE_LIMITED'
          ? onPollRateLimited(handoffPollState, Date.now())
          : onPollFailure(handoffPollState, Date.now());
      if (isPollingUnstable(handoffPollState, Date.now())) {
        panel.setStatusText(MESSAGES.handoffPollUnstable);
      }
    }
  }

  function scheduleHandoffPoll(): void {
    const myGeneration = handoffPollGeneration;
    const delay = nextHandoffDelayMs(handoffPollState, document.hidden ? 'hidden' : 'visible');
    handoffPollTimerPending = true;
    handoffPollTimer = window.setTimeout(() => {
      handoffPollTimerPending = false;
      if (myGeneration !== handoffPollGeneration) return; // 폐기된 루프(EX-N2-11과 동일 패턴)
      void runHandoffPollOnce(false).then(() => {
        if (myGeneration !== handoffPollGeneration) return;
        if (!shouldPoll(handoffPollState, Date.now())) {
          handoffPollActive = false;
          return;
        }
        scheduleHandoffPoll();
      });
    }, delay);
  }

  /** `shouldPoll()`이 참이고 아직 루프가 없을 때만 새로 시작한다(요청 중첩 방지 — 폴링은 한 번에 하나). */
  function ensureHandoffPolling(): void {
    if (handoffPollActive) return;
    if (!shouldPoll(handoffPollState, Date.now())) return;
    handoffPollActive = true;
    scheduleHandoffPoll();
  }

  // 탭이 숨겨지면 다음 폴링 간격을 즉시 재계산한다(§14.4 — 숨김 15초로 완화). fetch가 이미 진행
  // 중이면(대기 중이 아니면) 건드리지 않는다 — 재예약이 요청 중첩을 만들지 않게 한다.
  document.addEventListener('visibilitychange', () => {
    if (handoffPollActive && handoffPollTimerPending && handoffPollTimer !== undefined) {
      window.clearTimeout(handoffPollTimer);
      handoffPollTimerPending = false;
      scheduleHandoffPoll();
    }
  });

  /** 새로고침 복구(FR-CS9-7, §14.3) — 저장소에 토큰이 있으면 1회 복원 후 폴링을 재개한다. */
  async function restoreHandoffIfAny(): Promise<void> {
    if (handoffRestoreAttempted) return;
    handoffRestoreAttempted = true;
    const stored = loadHandoffToken(options.slug);
    if (!stored) return;
    handoffPollState = { ...createHandoffPollState(), token: stored.token, cursor: stored.cursor, mode: 'CONNECTED' };
    dispatch({ type: 'HANDOFF_CONNECTED' });
    panel.messages.addSystemText(MESSAGES.handoffRestoreNotice);
    await runHandoffPollOnce(true);
    ensureHandoffPolling();
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

  /**
   * [No.44/N2] `delayMs` 뒤, 그 사이 다른 문구로 바뀌지 않았을 때만(자기 문구일 때만) `#cb-status`를
   * 지운다(`feedback-loop-설계.md` §13.4). `announceFeedback`과 `pollPendingAnswer` 종료 시 공통으로
   * 쓴다 — 보류 RAG 최종 답변 직후 평가 안내가 뜬 상태에서 이 타이머가 무조건 지우면 경합이 난다
   * (code-reviewer R1 Medium).
   */
  function clearStatusTextIfUnchanged(text: string, delayMs = 2000): void {
    window.setTimeout(() => {
      if (panel.status.textContent === text) panel.setStatusText('');
    }, delayMs);
  }

  /**
   * [No.44] `#cb-status`(polite) 1회 안내 — `panel.setStatusText`. 2초 뒤 **자기 문구일 때만**
   * 지운다(다른 상태 문구를 덮어써 지우지 않는다, `feedback-loop-설계.md` §13.4).
   */
  function announceFeedback(text: string): void {
    panel.setStatusText(text);
    clearStatusTextIfUnchanged(text);
  }

  /**
   * [No.44] 공개 평가 API 호출 — 오류를 `core/feedback.ts`의 `FeedbackAttemptResult`로 분류해
   * `ui/feedback-bar.ts`(DOM 무의존 재시도 판정)에 넘긴다. `sessionStorage`/`localStorage`에
   * 평가를 저장하지 않는다(F-16) — 상태는 DOM(막대)에만 있다.
   */
  async function submitFeedback(messageId: string, rating: FeedbackRating): Promise<FeedbackAttemptResult> {
    const sessionId = getOrCreateSessionId(options.slug);
    try {
      await client.submitFeedback(messageId, { sessionId, rating });
      return 'OK';
    } catch (e) {
      if (e instanceof PublicApiError) {
        switch (e.kind) {
          case 'NOT_FOUND':
            return 'NOT_FOUND';
          case 'CLOSED':
            return 'CLOSED';
          case 'RATE_LIMITED':
            return 'RATE_LIMITED';
          case 'DISABLED':
            return 'DISABLED';
          case 'NETWORK':
            return 'NETWORK';
          default:
            return 'SERVER';
        }
      }
      return 'SERVER';
    }
  }

  function makeFeedbackBinding(messageId: string): FeedbackBarBinding {
    return {
      messageId,
      onRate: (rating) => submitFeedback(messageId, rating),
      onAnnounce: announceFeedback,
    };
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
      if (!alreadyGreeted) {
        renderGreeting(config);
        void restoreHandoffIfAny();
      }
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
  async function pollPendingAnswer(pendingId: string, pollAfterMs: number, feedbackOffered: boolean): Promise<void> {
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

      // [No.24] 보류 답변이 실패로 끝나면(§5.5 `IF_PENDING_FAILS`) 관찰 창을 연다 — 사람이 도와야
      // 할 사용자로 본다(P-6). READY면 보류만 해제한다(관찰 창을 새로 열지 않음).
      handoffPollState = onPendingResult(handoffPollState, decision.reason, Date.now());
      if (handoffPollState.mode === 'WATCHING') {
        ensureHandoffPolling();
      }

      // [No.44] 평가 막대는 보류 RAG의 **최종** 말풍선(READY·FAILED)에만 붙는다 — 인터림 안내·
      // 로컬 정리 문구(EXPIRED/TIMEOUT)에는 붙이지 않는다(`feedback-loop-ui-spec.md` §3.2.1).
      let statusText: string;
      if (decision.reason === 'READY' && payload) {
        statusText = MESSAGES.pending.readyAnnounce;
        panel.setStatusText(statusText);
        const feedback = feedbackOffered ? makeFeedbackBinding(pendingId) : undefined;
        await panel.messages.addBotAnswer(pendingId, toOutputViews(payload.outputs ?? []), payload.sources, handleButtonAction, feedback);
      } else if (decision.reason === 'FAILED' && payload) {
        statusText = MESSAGES.pending.timeoutFallback;
        panel.setStatusText(statusText);
        const feedback = feedbackOffered ? makeFeedbackBinding(pendingId) : undefined;
        await panel.messages.addBotAnswer(pendingId, toOutputViews(payload.outputs ?? []), undefined, handleButtonAction, feedback);
      } else {
        // EXPIRED(404/TTL 만료) 또는 TIMEOUT(90초 초과, 로컬 판단) — 서버 응답이 없으므로
        // 클라이언트가 정리 문구로 마감한다(S-15, 오류로 표시하지 않는다).
        statusText = MESSAGES.pending.timeoutFallback;
        panel.setStatusText(statusText);
        await panel.messages.addBotAnswer(
          pendingId,
          [{ type: 'TEXT', payload: { text: MESSAGES.pending.timeoutFallback } }],
          undefined,
          handleButtonAction,
        );
      }
      panel.composer.focus();
      // R1 Medium — 무조건 지우던 것을, 그 사이(예: READY 직후 평가 클릭) 안내 문구가 덮어써졌으면
      // 지우지 않도록 조건부로 바꾼다(§13.4와 동일 규칙, announceFeedback과 헬퍼 공유).
      clearStatusTextIfUnchanged(statusText);
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
      const res = await client.sendMessage(
        { sessionId, message: input.message, buttonAction: input.buttonAction, state: savedState },
        { handoffToken: handoffPollState.token },
      );
      saveConversationState(options.slug, res.state);
      if (res.stateReset) {
        panel.messages.addSystemText(MESSAGES.stateResetNotice);
      }

      // [No.24] 상담 상태 조각 반영(ADR-0036 §5.3). `res.handoff`가 없으면(상담 꺼진 챗봇 등)
      // 상태를 바꾸지 않는다 — 바이트 동일 응답에 대한 위젯 측 반영.
      if (res.handoff?.status === 'ENDED') {
        // G-7 — 위젯은 봇 출력을 그리기 전에 폴링 1회로 종료 안내를 먼저 그린다(§14.2 ⑥).
        await runHandoffPollOnce(false);
      } else {
        const prevHandoffMode = handoffPollState.mode;
        handoffPollState = onSendResponse(handoffPollState, res.handoff, Date.now());
        if (handoffPollState.token) {
          saveHandoffToken(options.slug, { token: handoffPollState.token, cursor: handoffPollState.cursor });
        }
        if (prevHandoffMode !== 'CONNECTED' && handoffPollState.mode === 'CONNECTED') {
          panel.setStatusText(MESSAGES.handoffConnectAnnounce);
          dispatch({ type: 'HANDOFF_CONNECTED' });
        } else if (prevHandoffMode === 'IDLE' && handoffPollState.mode === 'WATCHING') {
          dispatch({ type: 'HANDOFF_WATCH_STARTED' });
        }
      }
      if (handoffPollState.mode === 'WATCHING' || handoffPollState.mode === 'CONNECTED') {
        ensureHandoffPolling();
      }

      const views = toOutputViews(res.outputs);
      if (res.pendingAnswer) {
        // PENDING — 인터림 안내 말풍선(서버가 내려준 일반 TEXT 아웃풋)만 먼저 렌더하고, 입력은
        // 잠그지 않는다(FR-N2-38, AWAITING_ANSWER는 SENDING과 달리 입력 잠금이 없다). [No.44]
        // `res.feedback`은 이 POST 응답 시점에 이미 있을 수 있지만(§6.1) 인터림 말풍선에는 붙이지
        // 않는다 — 최종 답변(READY/FAILED)에만 `pollPendingAnswer`가 붙인다.
        await panel.messages.addBotOutputs(views, handleButtonAction);
        dispatch({ type: 'PENDING_STARTED' });
        panel.composer.setDisabled(false);
        panel.composer.focus();
        void pollPendingAnswer(res.pendingAnswer.id, res.pendingAnswer.pollAfterMs, res.feedback?.rateable === true);
        return;
      }
      // [No.24] 상담 구간 검증 발화(G-4)는 `outputs: []`가 정상이다 — 봇 말풍선을 만들지 않는다
      // (사용자 말풍선만, §14.2 ⑤). 그 밖의(핸드오프와 무관한) 빈 응답은 기존 폴백 문구를 유지한다(EX-W-6).
      if (views.length > 0 || res.handoff?.status !== 'CONNECTED') {
        // [No.44] 서버가 `feedback.rateable === true`를 준 말풍선에만 평가 막대를 붙인다 — 위젯은
        // 스스로 평가 가능성을 추정하지 않는다(FR-FB9-3).
        const feedback = res.feedback?.rateable === true ? makeFeedbackBinding(res.messageId) : undefined;
        await panel.messages.addBotOutputs(views, handleButtonAction, (typing) => panel.setStatusText(typing ? MESSAGES.sending : ''), undefined, feedback);
      }
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
