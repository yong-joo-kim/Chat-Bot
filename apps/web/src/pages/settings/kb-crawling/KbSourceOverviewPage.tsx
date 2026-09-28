import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import type { KbRunView } from '@chat-bot/shared-types';
import { kbSourcesApi } from '../../../api/kbSources';
import { ApiError } from '../../../api/client';
import { useAuth } from '../../../context/AuthContext';
import { useToast } from '../../../components/Toast';
import { ErrorState } from '../../../components/ErrorState';
import { ConfirmDialog } from '../../../components/Modal';
import { MESSAGES } from '../../../constants/messages';
import { formatDateTime } from '../../../lib/date';
import { KbPiiMaskBadge, KbRawFileBadge, KbTransportAckBadge } from './badges';
import { KbRunProgress } from './KbRunProgress';
import { formatEtaSeconds } from './formatEtaSeconds';
import { KbGovernanceBlockedHint, clientGovernanceViolation } from './governanceBlock';
import { isPreviewOlderThanDemotion } from './previewAfterDemotion';
import type { KbSourceOutletContext } from './KbSourceShell';

type ApproveDisabledReason = 'TRANSPORT_NOT_ACKNOWLEDGED' | 'RAG_NOT_CONFIGURED' | 'PREVIEW_REQUIRED' | 'PREVIEW_STALE' | 'PREVIEW_AFTER_DEMOTION_REQUIRED' | 'REVIEW_REQUIRED' | null;

function approveDisabledText(reason: Exclude<ApproveDisabledReason, null>): string {
  return reason === 'PREVIEW_AFTER_DEMOTION_REQUIRED' ? MESSAGES.kbRuns.approveDisabledAfterDemotion : MESSAGES.kbRuns.approveButtonDisabledReason[reason];
}

/**
 * 승인 409(`KB_INGEST_NOT_ALLOWED`)의 `details[0].message` 코드를 사람이 읽는 문구로 바꾼다.
 * 1) 승인 게이트 사유 표(TRANSPORT_NOT_ACKNOWLEDGED 등) → 2) 실행 실패 코드 표(거버넌스
 * `GOVERNANCE_MASK_REQUIRED`·`GOVERNANCE_RAW_FILE_NOT_ALLOWED` 등) → 3) 서버가 준 한글 메시지(폴백).
 * 어느 경우에도 빈 값이 되지 않도록 해 오류 배너(`role="alert"`)가 항상 원인을 보여 준다(UIUX §7).
 *
 * [RG-27] `PREVIEW_STALE`은 원인이 둘이다 — 설정 변경(서버 문구 = 원인 없는 기본 "유효한 미리보기 실행이
 * 아닙니다.") / 강등 뒤 새 미리보기 없음(서버 문구에 원인·해결 방법이 담김). 기본 문구가 아닌 비지 않은 서버
 * 문구는 항상 원인을 담고 있으므로 그대로 보이고, 기본 문구·빈 문구일 때만 종전 "설정이 바뀌어…" 안내를 쓴다.
 */
function resolveApproveErrorText(code: string | undefined, serverMessage: string): string {
  if (code === 'PREVIEW_STALE' && serverMessage.trim() && serverMessage.trim() !== MESSAGES.kbRuns.approveGenericInvalidPreviewServerMessage) {
    return serverMessage;
  }
  if (code) {
    const gate: Record<string, string> = MESSAGES.kbRuns.approveButtonDisabledReason;
    if (Object.prototype.hasOwnProperty.call(gate, code)) return gate[code];
    const failure: Record<string, string> = MESSAGES.kbRuns.failureCodeLabel;
    if (Object.prototype.hasOwnProperty.call(failure, code)) return failure[code];
  }
  return serverMessage || MESSAGES.errors.generic;
}

const GOVERNANCE_APPROVE_HINT_ID = 'kb-approve-governance-hint';
const GOVERNANCE_PREVIEW_HINT_ID = 'kb-preview-governance-hint';
const APPROVE_REASON_HINT_ID = 'kb-approve-reason-hint';

/** KB3 — 소스 상세: 개요·미리보기(`/settings/kb-crawling/:sourceId/overview`, `kb-crawling-ui-spec.md` §3.3). */
export function KbSourceOverviewPage(): JSX.Element {
  const { source, meta, reloadSource } = useOutletContext<KbSourceOutletContext>();
  const { can } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const msg = MESSAGES.kbRuns;
  const canWrite = can('security:write');

  const [runs, setRuns] = useState<KbRunView[]>([]);
  const [runsLoading, setRunsLoading] = useState(true);
  const [runsError, setRunsError] = useState(false);
  const [approveDialogOpen, setApproveDialogOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [banner, setBanner] = useState<string | undefined>(undefined);

  const loadRuns = useCallback(async () => {
    setRunsLoading(true);
    setRunsError(false);
    try {
      const res = await kbSourcesApi.listRuns(source.id, 1, 20);
      setRuns(res.items);
    } catch {
      setRunsError(true);
    } finally {
      setRunsLoading(false);
    }
  }, [source.id]);

  useEffect(() => {
    void loadRuns();
  }, [loadRuns]);

  const latestPreviewRun = useMemo(() => runs.find((r) => r.kind === 'PREVIEW' && r.status === 'SUCCEEDED'), [runs]);
  const latestRun = runs[0];

  const disabledReason: ApproveDisabledReason = useMemo(() => {
    if (!meta.ingestAck) return 'TRANSPORT_NOT_ACKNOWLEDGED';
    if (!meta.ragConfigured) return 'RAG_NOT_CONFIGURED';
    if (!latestPreviewRun) return 'PREVIEW_REQUIRED';
    // [No.43 R1 M1] 서버가 미리 계산한 `previewStale`(최근 성공 미리보기의 configVersion이 현재와
    // 다름)을 그대로 써서 클릭·거절 왕복 없이 미리 비활성으로 보여준다(§3.3.1).
    if (source.previewStale) return 'PREVIEW_STALE';
    // [RG-27 · pass 11 L-B] 강등 뒤에 끝난 미리보기가 아니면 서버가 409 PREVIEW_STALE로 거절한다 — 실행 이력에서
    // 확실히 알 수 있을 때만 미리 막고(모르면 활성 유지 · 서버 409 폴백), 설정 변경 사유가 우선이다.
    if (isPreviewOlderThanDemotion(source, runs, latestPreviewRun)) return 'PREVIEW_AFTER_DEMOTION_REQUIRED';
    return null;
  }, [meta.ingestAck, meta.ragConfigured, latestPreviewRun, source, runs]);

  // 거버넌스 규칙 위반이 확실할 때만(메타 + 소스 값) 미리 막는다 — 모르면 null(활성 유지 · 서버 409 폴백).
  const governanceViolation = canWrite ? clientGovernanceViolation(meta, source) : null;

  async function handleRunPreview(): Promise<void> {
    setSubmitting(true);
    setBanner(undefined);
    try {
      await kbSourcesApi.createRun(source.id, { kind: 'PREVIEW' });
      await reloadSource();
      void loadRuns();
    } catch (e) {
      setBanner(e instanceof ApiError ? e.message : MESSAGES.errors.generic);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleApprove(): Promise<void> {
    if (!latestPreviewRun) return;
    setSubmitting(true);
    try {
      await kbSourcesApi.approveIngest(source.id, { previewRunId: latestPreviewRun.id });
      setApproveDialogOpen(false);
      showToast(msg.approveSuccess);
      await reloadSource();
      navigate(`/settings/kb-crawling/${source.id}/runs`);
    } catch (e) {
      setApproveDialogOpen(false);
      if (e instanceof ApiError && e.details && e.details.length > 0) {
        setBanner(resolveApproveErrorText(e.details[0].message, e.message));
      } else {
        setBanner(e instanceof ApiError ? e.message : MESSAGES.errors.generic);
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCancel(): Promise<void> {
    if (!source.activeRun) return;
    try {
      await kbSourcesApi.cancelRun(source.id, source.activeRun.id);
      showToast(msg.cancelSuccess);
      await reloadSource();
      void loadRuns();
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : MESSAGES.errors.generic);
    }
  }

  const approveDescribedBy = [governanceViolation ? GOVERNANCE_APPROVE_HINT_ID : null, disabledReason ? APPROVE_REASON_HINT_ID : null].filter(Boolean).join(' ') || undefined;

  const scopeText = [source.scope.company, source.scope.category, source.scope.subcategory].filter(Boolean).join(' / ');

  // [3차 보완] 서버 `etaSeconds`(실측)를 우선 쓰고, 없으면(0 이하·null) 문서당 평균 1분 어림값으로
  // 대체한다(§13.1 코디네이터 지시 2 — "null일 때만 기존 클라이언트 어림값").
  const approveDialogBody = latestPreviewRun
    ? latestPreviewRun.etaSeconds && latestPreviewRun.etaSeconds > 0
      ? msg.approveDialogBodyWithEta(latestPreviewRun.crawl.added, latestPreviewRun.crawl.changed, formatEtaSeconds(latestPreviewRun.etaSeconds))
      : msg.approveDialogBody(latestPreviewRun.crawl.added, latestPreviewRun.crawl.changed, latestPreviewRun.crawl.added + latestPreviewRun.crawl.changed)
    : '';

  return (
    <div className="kb-source-overview">
      <dl className="settings-card-fields">
        <div>
          <dt>{msg.overviewScopeLabel}</dt>
          <dd>{scopeText}</dd>
        </div>
        <div>
          <dt>{msg.overviewTransportAckLabel}</dt>
          <dd>
            <KbTransportAckBadge ack={meta.ingestAck} />
          </dd>
        </div>
        <div>
          <dt>{msg.overviewPiiLabel}</dt>
          <dd>
            <KbPiiMaskBadge on={source.piiMask} /> <KbRawFileBadge on={source.allowRawFileIngest} />
          </dd>
        </div>
      </dl>

      {banner && (
        <p className="form-banner form-banner--error" role="alert">
          {banner}
        </p>
      )}

      {source.reviewRequiredReason && (
        <p className="form-banner form-banner--warning" role="status">
          {msg.demotedBanner(MESSAGES.kbSources.reviewReasonLabel[source.reviewRequiredReason])}
        </p>
      )}

      {source.activeRun ? (
        <>
          <KbRunProgress run={source.activeRun} />
          {canWrite && (
            <button type="button" className="btn btn-secondary" onClick={() => void handleCancel()}>
              {msg.cancelButton}
            </button>
          )}
        </>
      ) : source.needsPreview ? (
        <>
          {latestPreviewRun ? (
            <div className="settings-card">
              <p role="status">
                <span aria-hidden="true">ⓘ</span> {msg.previewFoundNotice}
              </p>
              <p>{msg.crawlSummaryText(latestPreviewRun.crawl.discovered, latestPreviewRun.crawl.added, latestPreviewRun.crawl.changed, latestPreviewRun.crawl.unchanged, latestPreviewRun.crawl.needsCleanup, Object.values(latestPreviewRun.crawl.excluded).reduce((a, b) => a + b, 0))}</p>
              {latestPreviewRun.demotedReason && latestPreviewRun.demotedReason !== source.reviewRequiredReason && (
                <p className="form-banner form-banner--warning" role="status">
                  <span aria-hidden="true">⚠</span> {msg.demotedBanner(msg.demotionReasonLabel[latestPreviewRun.demotedReason])}
                </p>
              )}
              {latestPreviewRun.maxPagesReached && <p className="field-hint field-hint--warning">{msg.maxPagesReachedWarning}</p>}
              {canWrite && (
                <span title={disabledReason ? approveDisabledText(disabledReason) : undefined}>
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={Boolean(disabledReason) || Boolean(governanceViolation) || submitting}
                    aria-describedby={approveDescribedBy}
                    onClick={() => setApproveDialogOpen(true)}
                  >
                    {msg.approveButton}
                  </button>
                </span>
              )}
              {governanceViolation && <KbGovernanceBlockedHint id={GOVERNANCE_APPROVE_HINT_ID} violation={governanceViolation} />}
              {disabledReason && (
                <p id={APPROVE_REASON_HINT_ID} className="field-hint field-hint--warning">
                  <span aria-hidden="true">⚠</span> {approveDisabledText(disabledReason)}
                </p>
              )}
            </div>
          ) : (
            <div className="settings-card">
              <p role="status">{msg.previewRequiredBanner}</p>
              {canWrite && (
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={submitting || Boolean(governanceViolation)}
                  aria-describedby={governanceViolation ? GOVERNANCE_PREVIEW_HINT_ID : undefined}
                  onClick={() => void handleRunPreview()}
                >
                  {msg.runPreviewButton}
                </button>
              )}
              {governanceViolation && <KbGovernanceBlockedHint id={GOVERNANCE_PREVIEW_HINT_ID} violation={governanceViolation} />}
            </div>
          )}
        </>
      ) : (
        <div className="settings-card">
          {source.lastRun && (
            <p>
              {msg.tabRuns}: {msg.statusLabel[source.lastRun.status]}
              {source.lastRun.finishedAt && ` · ${formatDateTime(source.lastRun.finishedAt)}`}
            </p>
          )}
          {!source.lastRun && !runsLoading && <p>{msg.emptyTitle}</p>}
        </div>
      )}

      {runsError && <ErrorState title={msg.loadFailed} onRetry={loadRuns} />}

      <ConfirmDialog
        isOpen={approveDialogOpen}
        title={msg.approveDialogTitle}
        description={approveDialogBody}
        confirmLabel={msg.approveButton}
        onConfirm={() => void handleApprove()}
        onCancel={() => setApproveDialogOpen(false)}
        confirmDisabled={submitting}
      />
    </div>
  );
}
