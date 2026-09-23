import { useEffect, useRef, useState } from 'react';
import type { AugmentationCapability, AugmentationListResponse, AugmentationRunResult, AugmentationSuggestion } from '@chat-bot/shared-types';
import { augmentationsApi } from '../../../api/augmentation';
import { trainingJobsApi } from '../../../api/trainingJobs';
import { ApiError } from '../../../api/client';
import { MESSAGES } from '../../../constants/messages';
import { useToast } from '../../../components/Toast';
import { useAuth } from '../../../context/AuthContext';
import { AsyncJobProgress } from '../../../components/AsyncJobProgress';
import { ProposalContainer } from '../../../components/ProposalContainer';
import { ConfirmDialog } from '../../../components/Modal';
import { SkeletonRow } from '../../../components/Skeleton';
import { AutoSnapshotPreNotice } from '../../../components/AutoSnapshotPreNotice';
import { AutoSnapshotNotice } from '../../../components/AutoSnapshotNotice';
import { useTrainingJobPolling } from '../../../lib/useTrainingJobPolling';
import { AugmentationSuggestionTable } from './AugmentationSuggestionTable';
import { AugmentationImpactCheckButton } from './AugmentationImpactCheckButton';

const msg = MESSAGES.augmentation;

function sessionKey(intentId: string): string {
  return `augmentationJob:${intentId}`;
}

function capabilityBannerText(capability: AugmentationCapability): string | null {
  if (!capability.degraded) return null;
  if (capability.degradeReason === 'API_KEY_MISSING' || capability.degradeReason === 'BASE_URL_MISSING') return msg.capabilityApiKeyMissing;
  if (capability.degradeReason === 'UNHEALTHY') return msg.capabilityUnhealthy;
  return msg.capabilityCircuitOpen;
}

function rejectedPartsText(rejected: AugmentationRunResult['rejected']): string {
  return Object.entries(rejected)
    .filter(([, count]) => count > 0)
    .map(([reason, count]) => `${msg.rejectReasonLabels[reason] ?? reason} ${count}`)
    .join(' · ');
}

export interface AugmentationPanelProps {
  chatbotId: string;
  intentId: string;
  currentExampleCount: number;
  /** 챗봇이 보관됨(archived) 등으로 편집 자체가 막힌 상태 — `dialogue:write` 권한과 별개로 쓰기를 막는다. */
  readOnly?: boolean;
  /** 승인 성공 시 즉시 `ExampleChipEditor`에 반영한다(§2 P-5) — 부모가 `examples` 배열에 append한다. */
  onExamplesAccepted: (newExampleTexts: string[]) => void;
}

/** A1 — 예문 증강 패널(`IntentEditModal` 확장, ui-spec §4). VIEWER는 쓰기 액션을 렌더하지 않는다(FR-L3-9). */
export function AugmentationPanel({ chatbotId, intentId, currentExampleCount, readOnly = false, onExamplesAccepted }: AugmentationPanelProps): JSX.Element {
  const { showToast } = useToast();
  const { can } = useAuth();
  const canWrite = !readOnly && can('dialogue:write');
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [items, setItems] = useState<AugmentationSuggestion[]>([]);
  const [runResult, setRunResult] = useState<AugmentationRunResult | undefined>();
  const [capability, setCapability] = useState<AugmentationCapability | null>(null);
  const [sufficientExamples, setSufficientExamples] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());

  const [jobId, setJobId] = useState<string | null>(null);
  const [genBusy, setGenBusy] = useState(false);
  const [genBanner, setGenBanner] = useState<string | undefined>();
  const [blockingBanner, setBlockingBanner] = useState<string | undefined>();
  const [liveMessage, setLiveMessage] = useState('');

  const [pendingAcceptIds, setPendingAcceptIds] = useState<string[] | null>(null);
  const [pendingBulkReject, setPendingBulkReject] = useState(false);
  const [resultPanel, setResultPanel] = useState<{ succeeded: number; failed: { id: string; message: string }[] } | null>(null);

  const hasAutoExpandedRef = useRef(false);
  const restoredRef = useRef(false);

  async function load(): Promise<AugmentationListResponse | null> {
    setLoading(true);
    setError(false);
    try {
      const res = await augmentationsApi.list(chatbotId, intentId, { status: ['PENDING'], page: 1, pageSize: 20 });
      setItems(res.items);
      setRunResult(res.runResult);
      setCapability(res.capability);
      setSufficientExamples(res.sufficientExamples);
      setLoaded(true);
      if (!hasAutoExpandedRef.current) {
        hasAutoExpandedRef.current = true;
        if (res.items.length > 0) setExpanded(true);
      }
      return res;
    } catch {
      setError(true);
      return null;
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatbotId, intentId]);

  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    const saved = window.sessionStorage.getItem(sessionKey(intentId));
    if (saved) setJobId(saved);
  }, [intentId]);

  const jobState = useTrainingJobPolling(jobId, (id) => trainingJobsApi.get(chatbotId, id), {
    initialDelayMs: 300,
    intervalMs: 700,
    maxWaitMs: 60 * 1000,
  });

  useEffect(() => {
    if (jobState.phase === 'done') {
      window.sessionStorage.removeItem(sessionKey(intentId));
      setJobId(null);
      if (jobState.job.status === 'FAILED') {
        setGenBanner(msg.generateFailed);
      } else {
        void load().then((res) => {
          if (res) setLiveMessage(msg.generateDone(res.items.length));
        });
      }
    } else if (jobState.phase === 'timeout') {
      window.sessionStorage.removeItem(sessionKey(intentId));
      setJobId(null);
      setGenBanner(msg.generateTimeout);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobState.phase]);

  function toggleExpanded(): void {
    setExpanded((v) => !v);
  }

  async function handleGenerate(): Promise<void> {
    setGenBanner(undefined);
    setBlockingBanner(undefined);
    setGenBusy(true);
    try {
      const res = await augmentationsApi.generate(chatbotId, intentId, {});
      window.sessionStorage.setItem(sessionKey(intentId), res.jobId);
      setJobId(res.jobId);
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.code === 'AUGMENTATION_IN_PROGRESS') {
          setGenBanner(msg.inProgressNotice);
          window.setTimeout(() => void load(), 5000);
        } else if (e.code === 'AUGMENTATION_UNAVAILABLE') {
          setBlockingBanner(msg.unavailableBanner);
        } else {
          setGenBanner(e.message);
        }
      } else {
        setGenBanner(msg.generateFailed);
      }
    } finally {
      setGenBusy(false);
    }
  }

  function toggleOne(id: string): void {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /** 전체 선택은 `stale===false && conflictIntent 없음`인 행만 대상으로 한다(§4.6, J-11). */
  function toggleAll(): void {
    const selectableIds = items.filter((i) => !i.stale && !i.conflictIntent).map((i) => i.id);
    const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selected.has(id));
    setSelected(allSelected ? new Set() : new Set(selectableIds));
  }

  async function doAccept(ids: string[]): Promise<void> {
    setBusyIds((prev) => new Set([...prev, ...ids]));
    try {
      const res = await augmentationsApi.accept(chatbotId, intentId, { suggestionIds: ids });
      const failedIds = new Set(res.failed.map((f) => f.id));
      const succeededIds = ids.filter((id) => !failedIds.has(id));
      const succeededTexts = items.filter((i) => succeededIds.includes(i.id)).map((i) => i.text);
      setItems((prev) => prev.filter((i) => !succeededIds.includes(i.id)));
      setSelected((prev) => {
        const next = new Set(prev);
        succeededIds.forEach((id) => next.delete(id));
        return next;
      });
      if (succeededTexts.length > 0) onExamplesAccepted(succeededTexts);
      if (res.failed.length > 0) {
        setResultPanel({
          succeeded: res.succeeded,
          failed: res.failed.map((f) => ({ id: f.id, message: `${items.find((i) => i.id === f.id)?.text ?? f.id} | ${f.message}` })),
        });
      } else if (succeededTexts.length > 0) {
        showToast(MESSAGES.learning.resolveSuccessImmediate);
      }
      /** [신규 2026-09-23 No.25] 승인 직전 자동 스냅샷 결과(§4.5.3) — 필드가 없거나 UNCHANGED/DISABLED면 아무 것도 표시하지 않는다. */
      if (res.autoSnapshot && (res.autoSnapshot.status === 'CREATED' || res.autoSnapshot.status === 'FAILED')) {
        showToast(
          <AutoSnapshotNotice
            outcome={res.autoSnapshot}
            chatbotId={chatbotId}
            createdText={msg.autoSnapshotCreated}
            viewLinkText={msg.autoSnapshotViewLink}
            failedText={msg.autoSnapshotFailed}
          />,
        );
      }
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : MESSAGES.errors.generic);
    } finally {
      setBusyIds((prev) => {
        const next = new Set(prev);
        ids.forEach((id) => next.delete(id));
        return next;
      });
      setPendingAcceptIds(null);
    }
  }

  async function doReject(ids: string[]): Promise<void> {
    setBusyIds((prev) => new Set([...prev, ...ids]));
    try {
      await augmentationsApi.reject(chatbotId, intentId, { suggestionIds: ids });
      setItems((prev) => prev.filter((i) => !ids.includes(i.id)));
      setSelected((prev) => {
        const next = new Set(prev);
        ids.forEach((id) => next.delete(id));
        return next;
      });
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : MESSAGES.errors.generic);
    } finally {
      setBusyIds((prev) => {
        const next = new Set(prev);
        ids.forEach((id) => next.delete(id));
        return next;
      });
      setPendingBulkReject(false);
    }
  }

  const isGenerating = jobState.phase === 'polling';
  const headerCount = loaded ? items.length : undefined;

  return (
    <div className="augmentation-panel">
      <div className="augmentation-panel-header">
        <button type="button" className="collapsible-toggle" aria-expanded={expanded} onClick={toggleExpanded}>
          <span aria-hidden="true">{expanded ? '▾' : '▸'}</span>{' '}
          {headerCount === undefined ? MESSAGES.common.loading : msg.sectionTitleCollapsed(headerCount)}
        </button>
      </div>

      <div aria-live="polite" className="sr-only">
        {liveMessage}
      </div>

      {expanded && (
        <div className="augmentation-panel-body">
          {loading && !loaded && <SkeletonRow />}
          {!loading && error && <p className="field-error" role="alert">{msg.loadFailed}</p>}
          {loaded && (
            <>
              {capability && capabilityBannerText(capability) && (
                <p className="form-banner form-banner--info" role="status">
                  {capabilityBannerText(capability)}
                </p>
              )}

              <ProposalContainer title={msg.proposalContainerTitle} safetyNotice={msg.safetyNotice}>
                <AutoSnapshotPreNotice text={msg.autoSnapshotPreNotice} />
                {isGenerating && <AsyncJobProgress label={msg.generating} />}
                {!isGenerating && jobState.phase === 'timeout' && (
                  <p className="field-hint" role="status">
                    {msg.generateTimeout}
                  </p>
                )}

                {!isGenerating && runResult && (
                  <p className="field-hint">
                    {items.length === 0
                      ? msg.allRejectedSummary(runResult.generated, rejectedPartsText(runResult.rejected))
                      : msg.runSummary(runResult.generated, runResult.accepted, rejectedPartsText(runResult.rejected))}
                  </p>
                )}
                {!isGenerating && runResult && items.length === 0 && <p className="field-hint">{msg.allRejectedNotice}</p>}

                {!isGenerating && items.length === 0 && !runResult && (
                  <>
                    {sufficientExamples && <p className="field-hint">{msg.sufficientExamplesNotice(currentExampleCount)}</p>}
                    <p className="field-hint">{msg.emptyBeforeGenerate}</p>
                  </>
                )}

                {!isGenerating && blockingBanner && (
                  <p className="field-error" role="alert">
                    {blockingBanner}
                  </p>
                )}
                {!isGenerating && genBanner && !blockingBanner && (
                  <p className="field-hint" role="status">
                    {genBanner}
                  </p>
                )}

                {!isGenerating && canWrite && (
                  <button type="button" className="btn btn-primary" onClick={() => void handleGenerate()} disabled={genBusy}>
                    {items.length === 0 && !runResult ? msg.generateButton : msg.regenerateButton}
                  </button>
                )}

                {!isGenerating && items.length > 0 && (
                  <>
                    <AugmentationSuggestionTable
                      items={items}
                      selected={selected}
                      canWrite={canWrite}
                      onToggle={toggleOne}
                      onToggleAll={toggleAll}
                      onAcceptOne={(id) => setPendingAcceptIds([id])}
                      onRejectOne={(id) => void doReject([id])}
                      busyIds={busyIds}
                    />
                    {canWrite && selected.size > 0 && (
                      <div className="bulk-action-bar" role="group" aria-label={msg.selectedCount(selected.size)}>
                        <span>{msg.selectedCount(selected.size)}</span>
                        <AugmentationImpactCheckButton chatbotId={chatbotId} intentId={intentId} selectedIds={[...selected]} />
                        <button type="button" className="btn btn-primary" onClick={() => setPendingAcceptIds([...selected])}>
                          {msg.acceptSelected}
                        </button>
                        <button type="button" className="btn btn-secondary" onClick={() => setPendingBulkReject(true)}>
                          {msg.rejectSelected}
                        </button>
                        <button type="button" className="btn btn-secondary" onClick={() => setSelected(new Set())}>
                          {msg.clearSelection}
                        </button>
                      </div>
                    )}
                  </>
                )}
              </ProposalContainer>

              {resultPanel && (
                <div className="bulk-result-panel" role="status">
                  <p className="bulk-result-title">{msg.resultTitle(resultPanel.succeeded, resultPanel.failed.length)}</p>
                  {resultPanel.failed.length > 0 && (
                    <table className="chart-frame-data-table">
                      <thead>
                        <tr>
                          <th scope="col">{msg.resultColumnSuggestion}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {resultPanel.failed.map((f) => (
                          <tr key={f.id}>
                            <td>{f.message}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                  <button type="button" className="btn btn-secondary" onClick={() => setResultPanel(null)}>
                    {MESSAGES.common.close}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}

      <ConfirmDialog
        isOpen={pendingAcceptIds !== null}
        title={msg.acceptConfirmTitle}
        description={msg.acceptConfirmDesc(pendingAcceptIds?.length ?? 0)}
        confirmLabel={msg.acceptSelected}
        onConfirm={() => pendingAcceptIds && void doAccept(pendingAcceptIds)}
        onCancel={() => setPendingAcceptIds(null)}
      />
      <ConfirmDialog
        isOpen={pendingBulkReject}
        title={msg.rejectConfirmTitle}
        description={msg.rejectConfirmDesc(selected.size)}
        confirmLabel={msg.rejectSelected}
        onConfirm={() => void doReject([...selected])}
        onCancel={() => setPendingBulkReject(false)}
      />
    </div>
  );
}
