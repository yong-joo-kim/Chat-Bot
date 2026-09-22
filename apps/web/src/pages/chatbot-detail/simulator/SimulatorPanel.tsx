import { useEffect, useRef, useState } from 'react';
import type { ButtonActionView } from '@chat-bot/shared-types/output-view';
import type { AssetCounts, ButtonAction, ConversationState, DialogueOverlay } from '@chat-bot/shared-types';
import { simulationApi } from '../../../api/simulation';
import { ApiError } from '../../../api/client';
import { contextsApi, dialogNodesApi, faqsApi, homonymsApi, intentsApi, keywordsApi } from '../../../api/dialogue';
import { MESSAGES } from '../../../constants/messages';
import { SeverityBadge } from '../../../components/SeverityBadge';
import { ChatMessageList } from './ChatMessageList';
import { SessionStatePanel } from './SessionStatePanel';
import { NodeJumpPicker } from './NodeJumpPicker';
import { MessageComposer } from './MessageComposer';
import { CompareView } from './CompareView';
import { RagUsageToggle } from './RagUsageToggle';
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

export interface SimulatorPanelProps {
  chatbotId: string;
  isArchived: boolean;
  mode: 'tab' | 'drawer';
  /** 드로어 진입 시 편집 폼 상태로 직렬화한 오버레이(FR-10-18~24). 탭 모드에는 없다. */
  overlay?: DialogueOverlay;
}

/** SIM1/SIM1-D 본체(FR-10-1~24). 탭·드로어가 완전히 동일한 컴포넌트를 재사용한다(ui-spec §0-3). */
export function SimulatorPanel({ chatbotId, isArchived, mode, overlay }: SimulatorPanelProps): JSX.Element {
  const msg = MESSAGES.simulator;
  const [messages, setMessages] = useState<SimMessage[]>([]);
  const [state, setState] = useState<ConversationState | undefined>(undefined);
  const [sending, setSending] = useState(false);
  const [viewMode, setViewMode] = useState<'chat' | 'compare'>('chat');
  const [assetCounts, setAssetCounts] = useState<AssetCounts | null>(null);
  // FR-N2-3: 기본 꺼짐. 세션(탭 유지) 동안은 체크 상태를 유지해 매턴 껐다 켜는 비용을 줄인다.
  const [useRag, setUseRag] = useState(false);
  const [sendingUsesRag, setSendingUsesRag] = useState(false);
  const inputWrapRef = useRef<HTMLDivElement>(null);

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
      const res = await simulationApi.simulate(chatbotId, { ...payload, state, overlay, useRag });
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

      {viewMode === 'compare' ? (
        <CompareView chatbotId={chatbotId} overlay={overlay} initialState={state} />
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
            <MessageComposer disabled={sending} onSend={handleSend} />
          </div>
          <SessionStatePanel state={state ?? null} />
        </div>
      )}
    </div>
  );
}
