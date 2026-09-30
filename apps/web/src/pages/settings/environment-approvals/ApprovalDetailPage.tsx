import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { EnvironmentGateSettings, ProdSwitchApprovalDetail } from '@chat-bot/shared-types';
import { APPROVAL_NOTE_MAX_CODE_POINTS } from '@chat-bot/shared-types';
import { environmentApi } from '../../../api/environment';
import { switchApprovalsApi } from '../../../api/switchApprovals';
import { ConfirmDialog, Modal } from '../../../components/Modal';
import { EmptyState } from '../../../components/EmptyState';
import { ErrorState } from '../../../components/ErrorState';
import { GateResultBadge } from '../../../components/GateResultBadge';
import { SkeletonCard } from '../../../components/Skeleton';
import { useToast } from '../../../components/Toast';
import { useAuth } from '../../../context/AuthContext';
import { MESSAGES } from '../../../constants/messages';
import { approvalActionLabel, approvalErrorView } from '../../../lib/approvalText';
import { formatDateTime } from '../../../lib/date';
import { useMinuteClock } from '../../../lib/useApprovalPolicy';
import { ApprovalStatusText } from '../../chatbot-detail/environment/approval/ApprovalStatusText';
import { RemainingTimeText } from '../../chatbot-detail/environment/approval/RemainingTimeText';
import { displayGate, effectiveSwitchBlockers, isRollbackGateRelaxed } from '../../chatbot-detail/environment/lib/rollbackGate';
import { SwitchBlockerText, SwitchWarningText, type ProdSwitchBlockerCode } from '../../chatbot-detail/environment/lib/switchPreviewText';
import { summaryLine } from '../../chatbot-detail/versions/restore/restorePreviewText';

/**
 * AP-2 승인 요청 상세 — 승인자가 "지금 기준으로 다시 확인"하는 화면(`ai-guardrails-ui-spec.md` §9.8). 대기 요청이면 서버가 현재 운영 기준
 * 미리보기(`livePreview`)를 함께 준다. 자기 요청은 승인·반려 버튼을 `aria-disabled` + 이유 글자로 막고(서버도 403), 종결된 요청은 컨트롤 없이
 * 종결 상태만 보인다. 승인·반려·취소가 409(이미 처리됨 등)면 안내 뒤 상세를 다시 조회한다.
 */
export function ApprovalDetailPage(): JSX.Element {
  const { chatbotId = '', requestId = '' } = useParams<{ chatbotId: string; requestId: string }>();
  const m = MESSAGES.switchApproval.detail;
  const { user, can } = useAuth();
  const { showToast } = useToast();
  const now = useMinuteClock();
  const canDeploy = can('chatbot:deploy');

  const [detail, setDetail] = useState<ProdSwitchApprovalDetail | null>(null);
  const [gateSettings, setGateSettings] = useState<EnvironmentGateSettings | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState(false);
  const [banner, setBanner] = useState<{ text: string; tone: 'info' | 'warning' | 'error' } | null>(null);
  const [ack, setAck] = useState(false);
  const [ackError, setAckError] = useState(false);
  const [approveOpen, setApproveOpen] = useState(false);
  const [approving, setApproving] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectNote, setRejectNote] = useState('');
  const [rejecting, setRejecting] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const statusHeadingRef = useRef<HTMLHeadingElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    setNotFound(false);
    try {
      const res = await switchApprovalsApi.getRequest(chatbotId, requestId);
      setDetail(res);
    } catch (e) {
      const view = approvalErrorView(e);
      if (view.kind === 'NOT_FOUND') setNotFound(true);
      else setError(true);
    } finally {
      setLoading(false);
    }
  }, [chatbotId, requestId]);

  useEffect(() => {
    void load();
  }, [load]);

  // 게이트 사유 문구에 기준값(minPassRate·validHours)이 필요해 환경 상태를 한 번 더 읽는다(보조 정보 — 실패해도 화면은 그대로).
  useEffect(() => {
    let cancelled = false;
    environmentApi
      .getStatus(chatbotId)
      .then((res) => {
        if (!cancelled && res.enabled) setGateSettings(res.gate);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [chatbotId]);

  function focusStatus(): void {
    window.setTimeout(() => statusHeadingRef.current?.focus(), 0);
  }

  /** 승인·반려·취소가 실패했을 때 — 안내 배너를 띄우고, 서버 상태가 바뀐 경우(이미 처리·기준 변경·적용 실패)는 상세를 다시 조회한다. */
  async function handleActionError(e: unknown, ctx: 'APPROVE' | 'REJECT' | 'CANCEL'): Promise<void> {
    const view = approvalErrorView(e, ctx);
    if (view.kind === 'ACK_REQUIRED') {
      setAckError(true);
      return;
    }
    setBanner({ text: view.text, tone: view.kind === 'NOT_PENDING' || view.kind === 'BASE_CHANGED' || view.kind === 'APPLY_FAILED' ? 'warning' : 'error' });
    if (view.kind === 'NOT_PENDING' || view.kind === 'BASE_CHANGED' || view.kind === 'APPLY_FAILED' || view.kind === 'NOT_FOUND') {
      await load();
      focusStatus();
    }
  }

  const isSelf = Boolean(user && detail && user.id === detail.requestedBy.id);
  const live = detail?.livePreview ?? null;
  const isPending = detail?.status === 'PENDING';
  // 직전 운영 버전으로의 롤백(directRollback)에서만 게이트 BLOCK을 경고로 취급한다(ProdSwitchDialog와 같은 규약, N40-1).
  const gateRelaxed = isRollbackGateRelaxed(detail?.action === 'PROD_ROLLBACK', live?.directRollback);
  const blockers = effectiveSwitchBlockers(live?.blockers ?? [], gateRelaxed);
  const blocked = blockers.length > 0;
  const warnings = live?.warnings ?? [];
  const isScheduled = detail?.action === 'SCHEDULED_PROD_SWITCH';

  function handleApproveClick(): void {
    if (!detail || approving || blocked || isSelf) return;
    if (warnings.length > 0 && !ack) {
      setAckError(true);
      return;
    }
    setAckError(false);
    setApproveOpen(true);
  }

  async function handleApproveConfirm(): Promise<void> {
    if (!detail) return;
    setApproving(true);
    setBanner(null);
    try {
      const res = await switchApprovalsApi.approve(chatbotId, requestId, { acknowledgeWarnings: warnings.length > 0 ? ack : undefined });
      setApproveOpen(false);
      setDetail({ ...res.request, livePreview: null });
      const req = res.request;
      if (req.outcome === 'APPLIED') setBanner({ text: m.appliedBanner(req.target.versionNo), tone: 'info' });
      else if (req.outcome === 'SCHEDULED' && req.scheduledAt) setBanner({ text: m.scheduledBanner(formatDateTime(req.scheduledAt)), tone: 'info' });
      focusStatus();
    } catch (e) {
      setApproveOpen(false);
      await handleActionError(e, 'APPROVE');
    } finally {
      setApproving(false);
    }
  }

  async function handleRejectConfirm(): Promise<void> {
    if (!detail) return;
    setRejecting(true);
    setBanner(null);
    try {
      const note = rejectNote.trim();
      const res = await switchApprovalsApi.reject(chatbotId, requestId, note ? { note } : {});
      setRejectOpen(false);
      setDetail({ ...res, livePreview: null });
      setBanner({ text: m.rejectedBanner, tone: 'info' });
      focusStatus();
    } catch (e) {
      setRejectOpen(false);
      await handleActionError(e, 'REJECT');
    } finally {
      setRejecting(false);
    }
  }

  async function handleCancelConfirm(): Promise<void> {
    if (!detail) return;
    setCancelling(true);
    setBanner(null);
    try {
      const res = await switchApprovalsApi.cancel(chatbotId, requestId);
      setCancelOpen(false);
      setDetail({ ...res, livePreview: null });
      showToast(MESSAGES.switchApproval.cancelDialog.success);
      focusStatus();
    } catch (e) {
      setCancelOpen(false);
      await handleActionError(e, 'CANCEL');
    } finally {
      setCancelling(false);
    }
  }

  const listLink = canDeploy ? (
    <Link to="/environment-approvals">{m.toList}</Link>
  ) : null;
  const envLink = (
    <Link to={`/chatbots/${chatbotId}/environment`}>{m.toEnvironment}</Link>
  );

  if (loading && !detail) {
    return (
      <div className="settings-page" aria-busy="true">
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
      </div>
    );
  }
  if (notFound) {
    return (
      <div className="settings-page">
        <EmptyState title={m.notFoundTitle} action={<>{listLink ?? envLink}</>} />
      </div>
    );
  }
  if (error || !detail) {
    return (
      <div className="settings-page">
        <ErrorState title={m.loadFailed} onRetry={() => void load()} />
      </div>
    );
  }

  const approveBlockedReason = blocked
    ? m.blockedReason(blockers.map((b) => SwitchBlockerText(b as ProdSwitchBlockerCode, live?.gate, gateSettings)).join(' '))
    : undefined;
  const bannerClass = banner?.tone === 'error' ? 'form-banner--error' : banner?.tone === 'warning' ? 'form-banner--warning' : 'form-banner--info';

  return (
    <div className="settings-page approval-detail-page" aria-busy={loading}>
      <h1>{m.title}</h1>
      <p className="approval-detail-links">
        {listLink} {listLink && <span aria-hidden="true">/</span>} {envLink}
      </p>

      {banner && (
        <p className={`form-banner ${bannerClass}`} role="status" aria-live="polite">
          <span aria-hidden="true">{banner.tone === 'info' ? 'ⓘ' : '⚠'}</span> {banner.text}
        </p>
      )}

      <h2 ref={statusHeadingRef} tabIndex={-1}>
        {m.statusLabel}
      </h2>
      <p>
        <ApprovalStatusText request={detail} />
        {isPending && (
          <>
            {' '}
            {m.expiresLabel}: <RemainingTimeText expiresAt={detail.expiresAt} now={now} onRefresh={() => void load()} />
          </>
        )}
      </p>

      <section aria-labelledby="approval-request-title">
        <h3 id="approval-request-title">{m.sectionRequest}</h3>
        <dl className="guardrail-readonly-list">
          <dt>{m.fields.chatbot}</dt>
          <dd className="guardrail-break">
            <Link to={`/chatbots/${detail.chatbotId}/environment`}>{detail.chatbotName}</Link>
          </dd>
          <dt>{m.fields.action}</dt>
          <dd>{approvalActionLabel(detail)}</dd>
          <dt>{m.fields.target}</dt>
          <dd>v{detail.target.versionNo}</dd>
          <dt>{m.fields.base}</dt>
          <dd>v{detail.base.versionNo}</dd>
          <dt>{m.fields.requester}</dt>
          <dd className="guardrail-break">
            {m.requesterLine(detail.requestedBy.email, formatDateTime(detail.createdAt))}
            {!detail.requestedBy.active && <> {MESSAGES.switchApproval.pending.inactiveAccount}</>}
            {!detail.requestedBy.active && <span className="field-hint"> {MESSAGES.switchApproval.pending.inactiveHint}</span>}
          </dd>
          {detail.reason && (
            <>
              <dt>{m.fields.reason}</dt>
              <dd className="guardrail-break">{detail.reason}</dd>
            </>
          )}
          {isScheduled && detail.scheduledAt && (
            <>
              <dt>{m.fields.schedule}</dt>
              <dd>
                {formatDateTime(detail.scheduledAt)}{' '}
                {detail.deployScheduleId && (
                  <Link to={`/chatbots/${detail.chatbotId}/deploy-schedules/${detail.deployScheduleId}`}>{m.scheduleLink}</Link>
                )}
              </dd>
            </>
          )}
          {detail.decidedBy && detail.decidedAt && (
            <>
              <dt>{m.fields.decision}</dt>
              <dd className="guardrail-break">{m.approvedByLine(detail.decidedBy.email, formatDateTime(detail.decidedAt))}</dd>
            </>
          )}
          {detail.decisionNote && (
            <>
              <dt>{m.fields.decisionNote}</dt>
              <dd className="guardrail-break">{detail.decisionNote}</dd>
            </>
          )}
        </dl>
      </section>

      {isPending && live ? (
        <section aria-labelledby="approval-live-title" className="approval-live-preview">
          <h3 id="approval-live-title">{m.sectionLive}</h3>
          <p className="field-hint">
            <span aria-hidden="true">ⓘ</span> {m.liveNotice}
          </p>
          <p>{m.liveCurrentToTarget(live.current.versionNo, live.target.versionNo)}</p>
          <p className="restore-diff-summary">{summaryLine(live.diffSummary.rows)}</p>
          <p>
            {m.liveGate}: <GateResultBadge gate={displayGate(live.gate, gateRelaxed)} settings={gateSettings} />
          </p>
          {blocked ? (
            <ul className="restore-blocker-list">
              {blockers.map((b, i) => (
                <li key={i}>
                  <span aria-hidden="true">⚠</span> {SwitchBlockerText(b as ProdSwitchBlockerCode, live.gate, gateSettings)}
                </li>
              ))}
            </ul>
          ) : (
            warnings.length > 0 && (
              <div className="restore-warning-block">
                <p className="restore-warning-heading">{m.liveWarnings}</p>
                <ul className="restore-warning-list">
                  {warnings.map((w, i) => (
                    <li key={i}>{SwitchWarningText(w, gateSettings)}</li>
                  ))}
                </ul>
              </div>
            )
          )}
          {canDeploy && !isSelf && !blocked && warnings.length > 0 && (
            <div>
              <label className="restore-ack-checkbox" id="approval-ack-label">
                <input
                  type="checkbox"
                  checked={ack}
                  onChange={(e) => {
                    setAck(e.target.checked);
                    setAckError(false);
                  }}
                />
                {m.ackLabel}
              </label>
              {ackError && (
                <p className="field-error" role="alert">
                  {m.ackError}
                </p>
              )}
            </div>
          )}
        </section>
      ) : (
        !isPending && (
          <p className="field-hint">
            <span aria-hidden="true">ⓘ</span> {m.closedNote}
          </p>
        )
      )}

      {isPending && canDeploy && (
        <div className="approval-detail-actions">
          {isSelf ? (
            <>
              <button type="button" className="btn btn-primary" aria-disabled="true" aria-describedby="approval-self-reason" onClick={(e) => e.preventDefault()}>
                {isScheduled ? m.approveScheduled : m.approveNow}
              </button>{' '}
              <button type="button" className="btn btn-secondary" aria-disabled="true" aria-describedby="approval-self-reason" onClick={(e) => e.preventDefault()}>
                {m.rejectButton}
              </button>
              <p id="approval-self-reason" className="field-hint">
                <span aria-hidden="true">ⓘ</span> {m.selfForbidden} {m.selfHint}
              </p>
              {detail.canCancel && (
                <button type="button" className="btn btn-secondary" onClick={() => setCancelOpen(true)}>
                  {MESSAGES.switchApproval.pending.cancelButton}
                </button>
              )}
            </>
          ) : (
            detail.canApprove && (
              <>
                <button
                  type="button"
                  className="btn btn-primary"
                  aria-disabled={blocked || approving || undefined}
                  aria-describedby={blocked ? 'approval-blocked-reason' : ackError ? 'approval-ack-label' : undefined}
                  onClick={handleApproveClick}
                >
                  {approving ? m.approving : isScheduled ? m.approveScheduled : m.approveNow}
                </button>{' '}
                <button type="button" className="btn btn-secondary" onClick={() => setRejectOpen(true)}>
                  {m.rejectButton}
                </button>
                {blocked && (
                  <p id="approval-blocked-reason" className="field-hint">
                    <span aria-hidden="true">⚠</span> {approveBlockedReason}
                  </p>
                )}
              </>
            )
          )}
        </div>
      )}

      <ConfirmDialog
        isOpen={approveOpen}
        title={m.approveConfirmTitle}
        description={isScheduled && detail.scheduledAt ? m.approveConfirmScheduled(formatDateTime(detail.scheduledAt), detail.target.versionNo) : m.approveConfirmNow(detail.target.versionNo)}
        confirmLabel={approving ? m.approving : m.approveConfirmButton}
        cancelLabel={m.approveConfirmCancel}
        confirmDisabled={approving}
        onConfirm={() => void handleApproveConfirm()}
        onCancel={() => !approving && setApproveOpen(false)}
      />

      <Modal isOpen={rejectOpen} title={m.rejectTitle} onClose={() => !rejecting && setRejectOpen(false)} closeOnEsc={!rejecting} initialFocusSelector='[data-autofocus="cancel"]'>
        <div className="form-field">
          <label htmlFor="approval-reject-note">{m.rejectNoteLabel}</label>
          <textarea
            id="approval-reject-note"
            value={rejectNote}
            rows={4}
            aria-describedby="approval-reject-help"
            onChange={(e) => {
              // 붙여넣기는 제한하지 않는다(UIUX §5) — 넘치는 글자만 잘라 200자로 맞춘다.
              setRejectNote(Array.from(e.target.value).slice(0, APPROVAL_NOTE_MAX_CODE_POINTS).join(''));
            }}
          />
          <p className="char-counter">{m.rejectNoteCount(Array.from(rejectNote).length, APPROVAL_NOTE_MAX_CODE_POINTS)}</p>
          <p id="approval-reject-help" className="field-hint">
            {m.rejectNoteHelp}
          </p>
        </div>
        <div className="modal-actions">
          <button type="button" className="btn btn-secondary" onClick={() => setRejectOpen(false)} disabled={rejecting} data-autofocus="cancel">
            {m.rejectCancel}
          </button>
          <button type="button" className="btn btn-danger" onClick={() => void handleRejectConfirm()} disabled={rejecting}>
            {rejecting ? m.rejecting : m.rejectConfirm}
          </button>
        </div>
      </Modal>

      <ConfirmDialog
        isOpen={cancelOpen}
        title={MESSAGES.switchApproval.cancelDialog.title}
        description={MESSAGES.switchApproval.cancelDialog.desc(`${approvalActionLabel(detail)}: v${detail.target.versionNo} ← v${detail.base.versionNo}`)}
        confirmLabel={cancelling ? MESSAGES.switchApproval.cancelDialog.confirming : MESSAGES.switchApproval.cancelDialog.confirm}
        cancelLabel={MESSAGES.switchApproval.cancelDialog.close}
        danger
        confirmDisabled={cancelling}
        onConfirm={() => void handleCancelConfirm()}
        onCancel={() => !cancelling && setCancelOpen(false)}
      />
    </div>
  );
}
