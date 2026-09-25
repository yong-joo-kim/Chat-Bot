import { useEffect, useRef, useState } from 'react';
import type { ButtonActionView } from '@chat-bot/shared-types/output-view';
import type {
  AssetCounts,
  BundleTarget,
  ButtonAction,
  ConversationState,
  DialogueOverlay,
  EnvironmentStatus,
  SimulateApiMode,
  SimulateMockResponse,
} from '@chat-bot/shared-types';
import { simulationApi } from '../../../api/simulation';
import { ApiError } from '../../../api/client';
import { contextsApi, dialogNodesApi, faqsApi, homonymsApi, intentsApi, keywordsApi } from '../../../api/dialogue';
import { useAuth } from '../../../context/AuthContext';
import { MESSAGES } from '../../../constants/messages';
import { SeverityBadge } from '../../../components/SeverityBadge';
import { TargetSelectField } from '../../../components/TargetSelectField';
import { targetLabel } from '../../../components/TargetBadge';
import { deriveEnvironmentStatusView, type EnvironmentStatusView } from '../../../lib/environmentStatus';
import { ChatMessageList } from './ChatMessageList';
import { SessionStatePanel } from './SessionStatePanel';
import { NodeJumpPicker } from './NodeJumpPicker';
import { MessageComposer } from './MessageComposer';
import { CompareView } from './CompareView';
import { RagUsageToggle } from './RagUsageToggle';
import { ApiModeToggle } from './ApiModeToggle';
import { MockResponseSelector } from './MockResponseSelector';
import { SurveyPreviewToggle } from './SurveyPreviewToggle';
import type { SimMessage } from './types';

let seq = 0;
function nextId(): string {
  seq += 1;
  return `sim-msg-${seq}-${Date.now()}`;
}

async function fetchAssetCounts(chatbotId: string): Promise<AssetCounts | null> {
  try {
    const q = { page: 1, pageSize: 1 };
    const [nodes, intents, keywords, homonyms, contexts, faqs] = await Promise.all([
      dialogNodesApi.list(chatbotId, q),
      intentsApi.list(chatbotId, q),
      keywordsApi.list(chatbotId, q),
      homonymsApi.list(chatbotId, q),
      contextsApi.list(chatbotId, q),
      faqsApi.list(chatbotId, q),
    ]);
    return {
      dialogNodes: nodes.total,
      intents: intents.total,
      keywords: keywords.total,
      homonyms: homonyms.total,
      contexts: contexts.total,
      faqs: faqs.total,
    };
  } catch {
    return null;
  }
}

/**
 * [신규 No.40 — §4.13 NFR-ENA4] "현재 대상"을 대화 영역 제목 옆에 텍스트로 표시하기 위한 라벨.
 * STAGING/PROD는 컨텍스트가 이미 아는 버전 번호로 바로 계산한다. VERSION(팝오버로 고른 임의 버전)은
 * 이 컴포넌트 스코프에 번호가 없어(선택은 `TargetSelectField` 내부 상태) 일반 문구로 대체한다 — 다음
 * 턴 응답의 `target`이 도착하면 트레이스 패널에 정확한 번호가 보인다.
 */
function currentTargetLabel(target: BundleTarget, envView: EnvironmentStatusView): string {
  const msg = MESSAGES.environment.targetSelect;
  switch (target.kind) {
    case 'DRAFT':
      return msg.draft;
    case 'STAGING':
      return envView.stagingVersionNo !== undefined ? msg.staging(envView.stagingVersionNo) : msg.draft;
    case 'PROD':
      return envView.prodVersionNo !== undefined ? msg.prod(envView.prodVersionNo) : msg.draft;
    case 'VERSION':
      return msg.versionPicker;
    default:
      return msg.draft;
  }
}

export interface SimulatorPanelProps {
  chatbotId: string;
  isArchived: boolean;
  mode: 'tab' | 'drawer';
  /** 드로어 진입 시 편집 폼 상태로 직렬화한 오버레이(FR-10-18~24). 탭 모드에는 없다. */
  overlay?: DialogueOverlay;
  /**
   * [신규 No.40 — §4.13] `ChatbotDetailContext.environmentStatus`를 그대로 넘긴다(별도 조회 없음).
   * 생략하면(드로어 진입점 일부가 아직 넘기지 않음) 대상 선택 컨트롤은 "환경 분리 꺼짐"과 동일하게
   * 렌더되지 않는다 — 오버레이 모드는 어차피 대상이 항상 초안으로 고정되므로 기능상 차이가 없다.
   */
  environmentStatus?: EnvironmentStatus | null;
}

/** SIM1/SIM1-D 본체(FR-10-1~24). 탭·드로어가 완전히 동일한 컴포넌트를 재사용한다(ui-spec §0-3). */
export function SimulatorPanel({ chatbotId, isArchived, mode, overlay, environmentStatus }: SimulatorPanelProps): JSX.Element {
  const msg = MESSAGES.simulator;
  const { can } = useAuth();
  const envView = deriveEnvironmentStatusView(environmentStatus);
  // [신규 No.40 — §4.13] 대상 선택. 기본은 항상 초안. 오버레이(미저장 편집)가 켜져 있으면 초안으로
  // 고정하고 컨트롤을 비활성화한다(AC-EN6-2, "오버레이는 초안 대상에서만 사용할 수 있습니다").
  //
  // [R1 L-1/L-2 — 반대 방향(대상이 비초안인 상태에서 오버레이가 켜지는 경우) 검토] 이 컴포넌트에는
  // 오버레이를 껐다 켰다 하는 사용자 컨트롤이 없다 — `overlay`는 항상 호출부가 마운트 시점에 고정으로
  // 넘기는 prop이다: 드로어 모드(`NodeFormPage`/`ContextFormPage`/`FaqEditModal`이 여는 `SimulatorDrawer`)는
  // 처음부터 끝까지 `overlay`가 채워져 있고(각 페이지의 `buildOverlay()`가 항상 객체를 반환), 탭 모드
  // (`SimulatorTab`)는 `overlay`를 아예 넘기지 않는다. 따라서 "대상을 스테이징/운영으로 고른 뒤 오버레이가
  // 뒤늦게 켜지는" 조작 경로는 실제 UI로 발생할 수 없다(`SimulatorPanel.target.spec.tsx`의 회귀 확인 테스트
  // 참고). 아래 effect는 그럼에도 방어적으로 남겨 둔다.
  const [target, setTarget] = useState<BundleTarget>({ kind: 'DRAFT' });
  useEffect(() => {
    if (overlay && target.kind !== 'DRAFT') setTarget({ kind: 'DRAFT' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overlay]);
  const [messages, setMessages] = useState<SimMessage[]>([]);
  const [state, setState] = useState<ConversationState | undefined>(undefined);
  const [sending, setSending] = useState(false);
  const [viewMode, setViewMode] = useState<'chat' | 'compare'>('chat');
  const [assetCounts, setAssetCounts] = useState<AssetCounts | null>(null);
  // FR-N2-3: 기본 꺼짐. 세션(탭 유지) 동안은 체크 상태를 유지해 매턴 껐다 켜는 비용을 줄인다.
  const [useRag, setUseRag] = useState(false);
  const [sendingUsesRag, setSendingUsesRag] = useState(false);
  const inputWrapRef = useRef<HTMLDivElement>(null);

  // [No.26] SIM1-ext — 외부 API 호출 모드. 기본 MOCK(J-5 "아무 것도 설정하지 않아도 안전").
  const [apiMode, setApiMode] = useState<SimulateApiMode>('MOCK');
  const [mockResponse, setMockResponse] = useState<SimulateMockResponse | undefined>(undefined);
  // [No.27] SIM1-ext — 설문 미리보기 토글. 기본 꺼짐(실제 상태·기간을 따름, ui-spec §3.6).
  const [surveyPreview, setSurveyPreview] = useState(false);
  // [No.22] SIM-ext — "비활성 토픽 포함" 토글. 기본 꺼짐(운영과 동일, topic-system-ui-spec.md §3.8).
  // 채팅·비교 모드 공용 상태다(비교 요청도 같은 플래그를 받는다, §6.5).
  const [includeInactiveTopics, setIncludeInactiveTopics] = useState(false);
  const canCallLive = can('simulation:write');
  // ⚠ 오버레이(미저장 편집) 상태에서는 LIVE를 사전 차단한다 — 최종 판정은 항상 서버지만,
  // 클라이언트에서 미리 안내해 무의미한 실패 호출을 줄인다(ui-spec §3.7, disabled는 사전 안내일 뿐).
  const liveDisabledReason = !canCallLive
    ? msg.apiModeLiveDisabledNoPermission
    : overlay
      ? msg.apiModeLiveDisabledUnsaved
      : undefined;

  useEffect(() => {
    let cancelled = false;
    fetchAssetCounts(chatbotId).then((counts) => {
      if (!cancelled) setAssetCounts(counts);
    });
    return () => {
      cancelled = true;
    };
  }, [chatbotId]);

  async function sendTurn(payload: { message?: string; buttonAction?: ButtonAction }): Promise<void> {
    setSending(true);
    setSendingUsesRag(useRag);
    try {
      const res = await simulationApi.simulate(chatbotId, {
        ...payload,
        state,
        overlay,
        useRag,
        apiMode,
        mockResponse: apiMode === 'MOCK' ? mockResponse : undefined,
        surveyPreview,
        includeInactiveTopics,
        // [신규 No.40 — §4.13] 초안이면 생략한다(요청 바이트 불변 — 모드 꺼진 챗봇·환경 미사용 시 기존과 동일).
        target: target.kind === 'DRAFT' ? undefined : target,
      });
      const next: SimMessage[] = [];
      if (res.stateDiscarded.length > 0) {
        next.push({ id: nextId(), role: 'system', text: msg.stateDiscardedNotice });
      }
      next.push({
        id: nextId(),
        role: 'bot',
        outputs: res.outputs,
        trace: res.trace,
        matchedNodeName: res.matchedNodeName,
        matchedIntentName: res.matchedIntentName,
        matchedFaqQuestion: res.matchedFaqQuestion,
        overlayApplied: res.overlayApplied,
        unsupportedOutputs: res.unsupportedOutputs,
        matchTrace: res.matchTrace,
        apiStep: res.apiStep,
        surveyStep: res.surveyStep,
        answeredTopic: res.answeredTopic,
        target: res.target,
      });
      setMessages((prev) => [...prev, ...next]);
      setState(res.state);
      setAssetCounts(res.assetCounts);
    } catch (e) {
      setMessages((prev) => [
        ...prev,
        {
          id: nextId(),
          role: 'error',
          text: e instanceof ApiError ? e.message : msg.errorBubble.network,
          retryPayload: payload,
        },
      ]);
    } finally {
      setSending(false);
      setSendingUsesRag(false);
    }
  }

  function handleSend(text: string): void {
    if (sending) return;
    setMessages((prev) => [...prev, { id: nextId(), role: 'user', text }]);
    void sendTurn({ message: text });
  }

  function handleButtonClick(action: ButtonActionView): void {
    if (sending) return;
    if (action.kind === 'LINK') {
      if (action.href) window.open(action.href, '_blank', 'noopener,noreferrer');
      return;
    }
    if (action.kind === 'MESSAGE') {
      setMessages((prev) => [...prev, { id: nextId(), role: 'user', text: action.text }]);
      void sendTurn({ message: action.text });
      return;
    }
    // NODE
    setMessages((prev) => [...prev, { id: nextId(), role: 'user', text: msg.userButtonPrefix(action.label) }]);
    void sendTurn({ buttonAction: { kind: 'NODE', nodeId: action.nodeId as string, label: action.label } });
  }

  async function handleNodeJump(nodeId: string): Promise<void> {
    if (sending) return;
    let nodeLabel = nodeId;
    try {
      const node = await dialogNodesApi.findOne(chatbotId, nodeId);
      nodeLabel = node.name;
    } catch {
      // 이름 조회 실패해도 테스트는 계속 진행한다(§4.1.3 — 존재하지 않아도 폴백으로 정상 처리됨).
    }
    setMessages((prev) => [...prev, { id: nextId(), role: 'system', text: msg.nodeJumpSystemMessage(nodeLabel) }]);
    void sendTurn({ buttonAction: { kind: 'NODE', nodeId } });
  }

  function handleRetry(failed: SimMessage): void {
    if (!failed.retryPayload) return;
    void sendTurn(failed.retryPayload);
  }

  function handleReset(): void {
    setMessages([]);
    setState(undefined);
  }

  // 사전 차단 조건이 성립하는 동안 LIVE가 선택돼 있으면 MOCK으로 되돌린다(사전 안내 일관성 유지).
  useEffect(() => {
    if (liveDisabledReason && apiMode === 'LIVE') setApiMode('MOCK');
  }, [liveDisabledReason, apiMode]);

  const showEmptyBanner = assetCounts !== null && assetCounts.dialogNodes === 0 && assetCounts.intents === 0 && assetCounts.faqs === 0;

  return (
    <div className={`simulator-panel simulator-panel--${mode}`}>
      {isArchived && <SeverityBadge severity="WARNING" label={msg.archivedNotice} />}
      {showEmptyBanner && (
        <p className="simulator-empty-banner">
          <SeverityBadge
            severity="INFO"
            label={msg.emptyAssetsTitle(assetCounts?.dialogNodes ?? 0, assetCounts?.intents ?? 0)}
          />{' '}
          <a href={`/chatbots/${chatbotId}/dialogue`}>{msg.emptyAssetsCta}</a>
        </p>
      )}
      {overlay && (
        <p className="overlay-badge-row">
          <span className="overlay-badge">
            <span aria-hidden="true">🟡</span> {msg.overlayBadge} — {msg.overlayBadgeDesc}
          </span>
        </p>
      )}

      {/* [신규 No.40 — §4.13] 대화 영역 제목 바로 위. 비교 모드는 항상 초안(변경 없음)이라 렌더하지
          않는다 — CompareView는 고정 대상이다. */}
      {viewMode === 'chat' && (
        <TargetSelectField
          chatbotId={chatbotId}
          value={target}
          onChange={setTarget}
          environmentEnabled={envView.isEnabled}
          stagingVersionNo={envView.stagingVersionNo}
          prodVersionNo={envView.prodVersionNo}
          disabled={Boolean(overlay)}
          disabledReason={overlay ? MESSAGES.environment.targetSelect.disabledOverlayHint : undefined}
        />
      )}
      {viewMode === 'chat' && envView.isEnabled && (
        <p className="field-hint">{MESSAGES.environment.targetSelect.currentTargetPrefix(currentTargetLabel(target, envView))}</p>
      )}

      <fieldset className="simulator-mode-toggle" role="radiogroup" aria-label="테스트 모드">
        <label className="form-field--inline">
          <input type="radio" name={`sim-mode-${mode}`} checked={viewMode === 'chat'} onChange={() => setViewMode('chat')} />
          {msg.modeChat}
        </label>
        <label className="form-field--inline">
          <input type="radio" name={`sim-mode-${mode}`} checked={viewMode === 'compare'} onChange={() => setViewMode('compare')} />
          {mode === 'drawer' ? msg.modeCompareDrawer : msg.modeCompare}
        </label>
        {/* AC-N2-26: 비교 모드에서는 useRag 토글 자체가 렌더되지 않고, 고정 캡션만 남는다. */}
        {viewMode === 'compare' && <span className="field-hint">{msg.ragToggle.compareNotice}</span>}
      </fieldset>

      <label className="form-field--inline">
        <input type="checkbox" checked={includeInactiveTopics} onChange={(e) => setIncludeInactiveTopics(e.target.checked)} />
        {MESSAGES.topics.simulatorIncludeInactiveLabel}
      </label>
      <p className="field-hint">{MESSAGES.topics.simulatorTcNoToggleHint}</p>

      {viewMode === 'compare' ? (
        <>
          {/* [No.26] 비교 모드는 항상 목이며 A/B가 같은 목 원천을 쓴다는 사실만 1줄로 안내한다(ui-spec §3.7 흐름 3). */}
          <p className="field-hint">{msg.compareApiMockNotice}</p>
          <CompareView chatbotId={chatbotId} overlay={overlay} initialState={state} includeInactiveTopics={includeInactiveTopics} />
        </>
      ) : (
        <div className="simulator-layout">
          <div className="simulator-chat-area">
            <div className="simulator-chat-toolbar">
              <p className="field-hint">{msg.statsCaption}</p>
              {/* FR-12-42: 금지어 필터는 실제 대화(공개 API)에만 적용되고 이 시뮬레이터에는 적용되지 않는다. */}
              <p className="field-hint">{msg.bannedWordFilterCaption}</p>
              <button type="button" className="btn btn-secondary" onClick={handleReset}>
                {msg.resetButton}
              </button>
            </div>
            <ChatMessageList
              messages={messages}
              chatbotId={chatbotId}
              sending={sending}
              sendingLabel={sendingUsesRag ? msg.sendingRag : msg.sending}
              onButtonClick={handleButtonClick}
              onRetry={handleRetry}
            />
            <div ref={inputWrapRef} className="node-jump-row">
              <span className="field-label-static">{msg.nodeJump.label}</span>
              <NodeJumpPicker chatbotId={chatbotId} disabled={sending} onSubmit={(nodeId) => void handleNodeJump(nodeId)} />
            </div>
            <RagUsageToggle checked={useRag} onChange={setUseRag} disabled={sending} />
            <ApiModeToggle mode={apiMode} onChange={setApiMode} liveDisabled={Boolean(liveDisabledReason)} liveDisabledReason={liveDisabledReason} />
            {apiMode === 'MOCK' && <MockResponseSelector value={mockResponse} onChange={setMockResponse} />}
            <SurveyPreviewToggle checked={surveyPreview} onChange={setSurveyPreview} />
            <MessageComposer disabled={sending} onSend={handleSend} />
          </div>
          <SessionStatePanel state={state ?? null} />
        </div>
      )}
    </div>
  );
}
