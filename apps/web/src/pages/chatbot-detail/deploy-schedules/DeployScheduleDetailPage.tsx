import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { DeployScheduleDetail } from '@chat-bot/shared-types';
import { useChatbotDetailContext } from '../../ChatbotDetailLayout';
import { useAuth } from '../../../context/AuthContext';
import { useToast } from '../../../components/Toast';
import { ApiError } from '../../../api/client';
import { deploySchedulesApi } from '../../../api/deploySchedules';
import { MESSAGES } from '../../../constants/messages';
import { SkeletonRow } from '../../../components/Skeleton';
import { ErrorState } from '../../../components/ErrorState';
import { ConfirmDialog } from '../../../components/Modal';
import { DeployScheduleStatusBadge } from '../../../components/DeployScheduleStatusBadge';
import { deployScheduleActionText } from '../../../components/DeployScheduleActionLabel';
import { ScheduledAtField } from '../../../components/ScheduledAtField';
import { canManageDeploySchedule } from '../../../lib/deploySchedulePermissions';
import { formatScheduleDateTime, localPartsToInstant, timezoneLabel } from '../../../lib/scheduleTime';
import { useDeployScheduleMeta } from '../../../lib/useDeployScheduleMeta';
import { ScheduleChainPanel } from './ScheduleChainPanel';
import { StateCheckPanel } from './StateCheckPanel';
import { ReadinessWarningList } from './ReadinessWarningList';
import { ScheduleResultSummaryPanel } from './ScheduleResultSummaryPanel';
import { ScheduleDeployDialog } from './ScheduleDeployDialog';

const RUNNING_POLL_INTERVAL_MS = 3000;

function toLocalTimeParts(instant: Date, timezone: string): { date: string; hour: string; minute: string } {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(instant);
  const map: Record<string, string> = {};
  for (const p of parts) map[p.type] = p.value;
  return { date: `${map.year}-${map.month}-${map.day}`, hour: map.hour === '24' ? '00' : map.hour, minute: map.minute };
}

/** S2 — 예약 상세(`scheduled-deploy-ui-spec.md` §4.2). */
export function DeployScheduleDetailPage(): JSX.Element {
  const { chatbot, environmentStatus } = useChatbotDetailContext();
  const { scheduleId } = useParams<{ scheduleId: string }>();
  const { can } = useAuth();
  const { showToast } = useToast();
  const msg = MESSAGES.deploySchedules;
  const meta = useDeployScheduleMeta();
  const timezone = meta?.timezone ?? 'Asia/Seoul';

  const [detail, setDetail] = useState<DeployScheduleDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState(false);

  const [editing, setEditing] = useState(false);
  const [editLocal, setEditLocal] = useState({ date: '', hour: '', minute: '' });
  const [editMemo, setEditMemo] = useState('');
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | undefined>();

  const [cancelOpen, setCancelOpen] = useState(false);
  const [retryOpen, setRetryOpen] = useState(false);
  const [resumeOpen, setResumeOpen] = useState(false);

  const load = useCallback(async () => {
    if (!scheduleId) return;
    setError(false);
    try {
      const res = await deploySchedulesApi.detail(chatbot.id, scheduleId);
      setDetail(res);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) setNotFound(true);
      else setError(true);
    } finally {
      setLoading(false);
    }
  }, [chatbot.id, scheduleId]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  useEffect(() => {
    if (detail?.status !== 'RUNNING') return undefined;
    const timer = window.setInterval(() => void load(), RUNNING_POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [detail?.status, load]);

  function startEdit(): void {
    if (!detail || !meta) return;
    setEditLocal(toLocalTimeParts(detail.scheduledAt, meta.timezone));
    setEditMemo(detail.memo ?? '');
    setEditError(undefined);
    setEditing(true);
  }

  async function handleSaveEdit(): Promise<void> {
    if (!detail || !meta || !scheduleId) return;
    const instant = localPartsToInstant(editLocal.date, editLocal.hour, editLocal.minute, meta.timezone);
    if (!instant) {
      setEditError(MESSAGES.errors.generic);
      return;
    }
    setEditSaving(true);
    setEditError(undefined);
    try {
      const updated = await deploySchedulesApi.update(chatbot.id, scheduleId, {
        scheduledAt: instant.toISOString() as never,
        memo: (editMemo.trim() ? editMemo.trim() : null) as never,
      });
      setDetail(updated);
      setEditing(false);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'DEPLOY_SCHEDULE_PRECONDITION_FAILED' && e.details?.[0]?.message === 'ORDER_CHANGE') {
        setEditError(msg.detail.orderChangeError);
      } else if (e instanceof ApiError && e.code === 'DEPLOY_SCHEDULE_INVALID_TIME') {
        setEditError(e.message);
      } else if (e instanceof ApiError && e.code === 'DEPLOY_SCHEDULE_NOT_MODIFIABLE') {
        showToast(msg.notModifiable);
        setEditing(false);
        void load();
      } else {
        setEditError(e instanceof ApiError ? e.message : MESSAGES.errors.generic);
      }
    } finally {
      setEditSaving(false);
    }
  }

  async function handleCancelConfirm(): Promise<void> {
    if (!scheduleId) return;
    try {
      await deploySchedulesApi.cancel(chatbot.id, scheduleId);
      showToast(msg.cancelSuccess);
      setCancelOpen(false);
      void load();
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : MESSAGES.errors.generic);
      setCancelOpen(false);
    }
  }

  async function handleAcknowledge(): Promise<void> {
    if (!scheduleId) return;
    try {
      const updated = await deploySchedulesApi.acknowledge(chatbot.id, scheduleId);
      setDetail(updated);
      showToast(msg.acknowledgeSuccess);
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : MESSAGES.errors.generic);
    }
  }

  function handleDialogCreated(label: string): void {
    setRetryOpen(false);
    setResumeOpen(false);
    showToast(msg.dialog.createSuccess(label));
    void load();
  }

  if (loading) {
    return <SkeletonRow />;
  }
  if (notFound) {
    return (
      <div className="error-state" role="alert">
        <p className="error-state-title">
          <span aria-hidden="true">⚠</span> {msg.notFound}
        </p>
        <Link to={`/chatbots/${chatbot.id}/deploy-schedules`} className="btn btn-secondary">
          {MESSAGES.common.backToList}
        </Link>
      </div>
    );
  }
  if (error || !detail) {
    return <ErrorState title={MESSAGES.errors.generic} onRetry={load} />;
  }

  const actionLabel = deployScheduleActionText({
    action: detail.action,
    targetVersionNo: detail.targetVersionNo,
    enableWebChannel: detail.enableWebChannel,
    channelEnabled: detail.channelEnabled,
  });
  // No.28 리뷰 2라운드 M-3 — 포괄 권한 대신 이 예약의 동작(+enableWebChannel)별 필요 권한으로 판정한다.
  const canManage = canManageDeploySchedule(can, detail.action, { enableWebChannel: detail.enableWebChannel });

  return (
    <div className="deploy-schedule-detail-page">
      <h1>{msg.detail.pageTitle(actionLabel)}</h1>

      <div className="deploy-schedule-detail-header">
        <DeployScheduleStatusBadge status={detail.status} attemptCount={detail.attemptCount} outcome={detail.outcome} delaySeconds={detail.delaySeconds} />
        <span>{formatScheduleDateTime(detail.scheduledAt, timezone)}</span>
        <span>{msg.detail.createdBy(detail.createdByEmail, formatScheduleDateTime(detail.createdAt, timezone))}</span>
      </div>

      {detail.memo && <p>{msg.detail.memoLabel}: "{detail.memo}"</p>}

      {(detail.status === 'PENDING' || detail.status === 'HELD') && canManage && !editing && (
        <button type="button" className="btn btn-secondary" onClick={startEdit}>
          {msg.detail.editTimeButton}
        </button>
      )}

      {editing && meta && (
        <div className="deploy-schedule-edit-form">
          <ScheduledAtField
            idPrefix="schedule-edit"
            timezoneLabel={timezoneLabel(meta.timezone)}
            date={editLocal.date}
            hour={editLocal.hour}
            minute={editLocal.minute}
            onDateChange={(v) => setEditLocal((p) => ({ ...p, date: v }))}
            onHourChange={(v) => setEditLocal((p) => ({ ...p, hour: v }))}
            onMinuteChange={(v) => setEditLocal((p) => ({ ...p, minute: v }))}
            disabled={editSaving}
          />
          <div className="form-field">
            <label htmlFor="schedule-edit-memo">{msg.detail.memoLabel}</label>
            <textarea id="schedule-edit-memo" value={editMemo} onChange={(e) => setEditMemo(e.target.value)} />
          </div>
          {editError && (
            <p className="field-error" role="alert">
              {editError}
            </p>
          )}
          <div className="form-actions">
            <button type="button" className="btn btn-secondary" onClick={() => setEditing(false)} disabled={editSaving}>
              {MESSAGES.common.cancel}
            </button>
            <button type="button" className="btn btn-primary" onClick={() => void handleSaveEdit()} disabled={editSaving}>
              {editSaving ? MESSAGES.common.saving : MESSAGES.common.save}
            </button>
          </div>
        </div>
      )}

      <ScheduleChainPanel chatbotId={chatbot.id} detail={detail} timezone={timezone} />

      {detail.status === 'RUNNING' && (
        <p role="status" aria-live="polite">
          {msg.detail.runningNotice}
        </p>
      )}

      {(detail.status === 'PENDING' || detail.status === 'HELD') && <StateCheckPanel chatbotId={chatbot.id} scheduleId={detail.id} timezone={timezone} />}

      {detail.readinessWarnings.length > 0 && (
        <div className="readiness-block">
          <p className="restore-warning-heading">{msg.detail.readinessHeading}</p>
          <ReadinessWarningList warnings={detail.readinessWarnings} />
        </div>
      )}

      {detail.status === 'SUCCEEDED' && <ScheduleResultSummaryPanel chatbotId={chatbot.id} detail={detail} />}

      {(detail.status === 'FAILED' || detail.status === 'MISSED') && detail.failureReason && (
        <p className="field-error" role="alert">
          {msg.reasons.failure[detail.failureReason]}
        </p>
      )}

      {detail.status === 'HELD' && detail.heldReason && <p>{msg.reasons.held[detail.heldReason]}</p>}

      {detail.status === 'CANCELLED' && detail.cancelledByEmail && detail.cancelledAt && (
        <p>{msg.detail.cancelledInfo(detail.cancelledByEmail, formatScheduleDateTime(detail.cancelledAt, timezone))}</p>
      )}

      {detail.acknowledgedByEmail && detail.acknowledgedAt && (
        <p>{msg.detail.acknowledgedInfo(detail.acknowledgedByEmail, formatScheduleDateTime(detail.acknowledgedAt, timezone))}</p>
      )}

      <div className="modal-actions">
        {canManage && (detail.status === 'FAILED' || detail.status === 'MISSED') && (
          <button type="button" className="btn btn-secondary" onClick={() => setRetryOpen(true)}>
            {msg.detail.retryButton}
          </button>
        )}
        {canManage && detail.status === 'HELD' && (
          <button type="button" className="btn btn-secondary" onClick={() => setResumeOpen(true)}>
            {msg.detail.resumeButton}
          </button>
        )}
        {canManage && detail.needsAttention && (
          <button type="button" className="btn btn-secondary" onClick={() => void handleAcknowledge()}>
            {msg.acknowledgeButton}
          </button>
        )}
        {canManage && (detail.status === 'PENDING' || detail.status === 'HELD') && (
          <button type="button" className="btn btn-secondary" onClick={() => setCancelOpen(true)}>
            {msg.cancelButton}
          </button>
        )}
      </div>

      <ConfirmDialog
        isOpen={cancelOpen}
        title={msg.cancelConfirmTitle}
        description={msg.cancelConfirmDesc}
        confirmLabel={msg.cancelButton}
        danger
        onConfirm={() => void handleCancelConfirm()}
        onCancel={() => setCancelOpen(false)}
      />

      {meta && (
        <ScheduleDeployDialog
          chatbotId={chatbot.id}
          isOpen={retryOpen}
          onClose={() => setRetryOpen(false)}
          onCreated={handleDialogCreated}
          timezone={meta.timezone}
          chatbotStatus={chatbot.status}
          initialAction={detail.action}
          versionId={detail.targetVersionId ?? undefined}
          versionNo={detail.targetVersionNo ?? undefined}
          enabled={detail.action === 'SET_WEB_CHANNEL' ? (detail.channelEnabled ?? undefined) : undefined}
          environmentStatus={environmentStatus}
        />
      )}

      {meta && (
        <ScheduleDeployDialog
          chatbotId={chatbot.id}
          isOpen={resumeOpen}
          onClose={() => setResumeOpen(false)}
          onCreated={handleDialogCreated}
          timezone={meta.timezone}
          chatbotStatus={chatbot.status}
          mode="RESUME"
          resumeScheduleId={detail.id}
          initialAction={detail.action}
          versionId={detail.targetVersionId ?? undefined}
          versionNo={detail.targetVersionNo ?? undefined}
          enabled={detail.action === 'SET_WEB_CHANNEL' ? (detail.channelEnabled ?? undefined) : undefined}
          environmentStatus={environmentStatus}
        />
      )}
    </div>
  );
}
