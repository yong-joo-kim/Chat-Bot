import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChatbotStatus, DeployScheduleAction, DeploySchedulePreconditionReason, DeploySchedulePreviewResponse, TestCaseSet } from '@chat-bot/shared-types';
import { DEPLOY_SCHEDULE_LIMITS } from '@chat-bot/shared-types';
import { Modal } from '../../../components/Modal';
import { ScheduledAtField } from '../../../components/ScheduledAtField';
import { MESSAGES } from '../../../constants/messages';
import { ApiError } from '../../../api/client';
import { deploySchedulesApi } from '../../../api/deploySchedules';
import { testSetsApi } from '../../../api/validation';
import { useAuth } from '../../../context/AuthContext';
import { canManageDeploySchedule } from '../../../lib/deploySchedulePermissions';
import { BlockerText, summaryLine } from '../versions/restore/restorePreviewText';
import { ReadinessWarningList } from './ReadinessWarningList';
import { ChainBasisNotice } from './ChainBasisNotice';
import { ActionPickerStep, type ActionPickerOption } from './ActionPickerStep';
import { defaultScheduledAt, formatInZone, localPartsToInstant, relativeFutureText, timezoneLabel } from '../../../lib/scheduleTime';

export interface ScheduleDeployDialogProps {
  chatbotId: string;
  isOpen: boolean;
  onClose: () => void;
  /** 성공 시 목록 새로고침 + Toast를 호출부가 담당한다(§4.3 "제출 성공"). */
  onCreated: (confirmLabel: string) => void;
  timezone: string;
  chatbotStatus: ChatbotStatus;
  mode?: 'CREATE' | 'RESUME';
  /** 진입 문맥이 고정하는 값(§4.3 진입 경로별 사전 채움). 지정하지 않으면 `ActionPickerStep`부터 시작한다. */
  initialAction?: DeployScheduleAction;
  versionId?: string;
  versionNo?: number;
  /** `SET_WEB_CHANNEL`의 목표 방향. 진입 문맥이 고정하지 않으면(S1 "+ 예약 만들기") 사용자가 선택한다. */
  enabled?: boolean;
  /** 재개(HELD→PENDING) 대상 예약 id(`mode='RESUME'`일 때 필수). */
  resumeScheduleId?: string;
}

type LocalTime = { date: string; hour: string; minute: string };

function toLocalTime(instant: Date, timezone: string): LocalTime {
  const s = formatInZone(instant, timezone);
  const [date, time] = s.split(' ');
  const [hour, minute] = time.split(':');
  return { date, hour, minute };
}

function preconditionMessage(code: DeploySchedulePreconditionReason): string | null {
  const msg = MESSAGES.deploySchedules.dialog;
  switch (code) {
    case 'CHAIN_ORDER':
      return msg.chainOrderBlocked;
    case 'DUPLICATE_PUBLISH':
      return msg.duplicatePublish;
    case 'ALREADY_ACTIVE':
      return msg.alreadyActive;
    case 'TEST_SET_INVALID':
      return msg.testSetInvalid;
    case 'TEST_SET_NOT_APPLICABLE':
      return msg.testSetNotApplicable;
    default:
      // RESTORE_BLOCKED/RESTORE_NO_CHANGES/ORDER_CHANGE는 blockers 목록 또는 시각 오류로 이미 표시된다.
      return null;
  }
}

/**
 * S3 예약 생성/재개 대화상자(`scheduled-deploy-ui-spec.md` §4.3). No.25 `RestoreDialog`의
 * blockers/warnings/diff요약 렌더 로직(`restorePreviewText.tsx`)을 재사용한다.
 */
export function ScheduleDeployDialog(props: ScheduleDeployDialogProps): JSX.Element {
  const { chatbotId, isOpen, onClose, onCreated, timezone, chatbotStatus, mode = 'CREATE', initialAction, versionId, versionNo, resumeScheduleId } = props;
  const { can } = useAuth();
  const msg = MESSAGES.deploySchedules.dialog;
  const tzLabel = useMemo(() => timezoneLabel(timezone), [timezone]);

  const [action, setAction] = useState<DeployScheduleAction | undefined>(initialAction);
  const [direction, setDirection] = useState<boolean>(props.enabled ?? true);
  const [enableWebChannel, setEnableWebChannel] = useState(false);
  const [local, setLocal] = useState<LocalTime>({ date: '', hour: '', minute: '' });
  const [memo, setMemo] = useState('');
  const [acknowledgeActive, setAcknowledgeActive] = useState(false);
  const [ackError, setAckError] = useState(false);
  const [postRunTestEnabled, setPostRunTestEnabled] = useState(false);
  const [postRunTestSetId, setPostRunTestSetId] = useState('');
  const [testSets, setTestSets] = useState<TestCaseSet[]>([]);

  const [preview, setPreview] = useState<DeploySchedulePreviewResponse | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [staleBanner, setStaleBanner] = useState(false);
  const [limitExceeded, setLimitExceeded] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    setAction(initialAction);
    setDirection(props.enabled ?? true);
    setEnableWebChannel(false);
    setMemo('');
    setAcknowledgeActive(false);
    setAckError(false);
    setPostRunTestEnabled(false);
    setPostRunTestSetId('');
    setPreview(null);
    setStaleBanner(false);
    setLimitExceeded(false);
    setSubmitError(null);
    const now = new Date();
    setLocal(toLocalTime(defaultScheduledAt(now, DEPLOY_SCHEDULE_LIMITS.minLeadMinutes), timezone));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, initialAction]);

  const instant = useMemo(() => localPartsToInstant(local.date, local.hour, local.minute, timezone), [local, timezone]);

  const buildDto = useCallback((): Record<string, unknown> | null => {
    if (!action || !instant) return null;
    const scheduledAt = instant.toISOString();
    if (action === 'RESTORE_VERSION') {
      if (!versionId) return null;
      return { action, versionId, scheduledAt, acknowledgeActive: acknowledgeActive || undefined };
    }
    if (action === 'PUBLISH') {
      return { action, enableWebChannel, scheduledAt };
    }
    return { action: 'SET_WEB_CHANNEL', enabled: direction, scheduledAt };
  }, [action, instant, versionId, acknowledgeActive, enableWebChannel, direction]);

  const fetchPreview = useCallback(async () => {
    const dto = buildDto();
    if (!dto) return;
    // H-1(리뷰 2라운드) — 재개(RESUME) 미리보기는 자기 자신을 선행 예약으로 오인하지 않도록
    // excludeScheduleId를 함께 보낸다(신규 생성 미리보기에는 넣지 않는다).
    const previewDto = mode === 'RESUME' && resumeScheduleId ? { ...dto, excludeScheduleId: resumeScheduleId } : dto;
    setPreviewLoading(true);
    setPreviewError(false);
    try {
      const res = await deploySchedulesApi.preview(chatbotId, previewDto as never);
      if (!isMountedRef.current) return;
      setPreview(res);
    } catch {
      if (!isMountedRef.current) return;
      setPreviewError(true);
    } finally {
      if (isMountedRef.current) setPreviewLoading(false);
    }
  }, [chatbotId, buildDto, mode, resumeScheduleId]);

  // 시각/방향/채널 옵션 변경 시 디바운스 재조회(§4.3 "값 변경 시 즉시 보조문 갱신" + 서버 재검증).
  useEffect(() => {
    if (!isOpen || !action) return undefined;
    const timer = window.setTimeout(() => void fetchPreview(), 400);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, action, local, enableWebChannel, direction]);

  useEffect(() => {
    if (!postRunTestEnabled || testSets.length > 0) return;
    testSetsApi
      .list(chatbotId, { pageSize: 20 })
      .then((res) => {
        if (isMountedRef.current) setTestSets(res.items);
      })
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [postRunTestEnabled]);

  function handleClose(): void {
    if (submitting) return;
    onClose();
  }

  function confirmLabel(): string {
    if (!instant) return '';
    const [, mo, da] = local.date.split('-');
    const formatted = `${Number(mo)}/${Number(da)} ${local.hour}:${local.minute}`;
    if (mode === 'RESUME') return msg.confirmButtonByAction.RESUME(formatted);
    if (action === 'RESTORE_VERSION') return msg.confirmButtonByAction.RESTORE_VERSION(formatted, versionNo ?? 0);
    if (action === 'PUBLISH') return enableWebChannel ? msg.confirmButtonByAction.PUBLISH_WITH_CHANNEL(formatted) : msg.confirmButtonByAction.PUBLISH(formatted);
    if (action === 'SET_WEB_CHANNEL') return direction ? msg.confirmButtonByAction.SET_WEB_CHANNEL_OPEN(formatted) : msg.confirmButtonByAction.SET_WEB_CHANNEL_CLOSE(formatted);
    return '';
  }

  async function handleConfirm(): Promise<void> {
    if (!preview || !action || !instant || submitting) return;
    if (preview.restore?.requiresAcknowledgeActive && !acknowledgeActive) {
      setAckError(true);
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      const label = confirmLabel();
      if (mode === 'RESUME' && resumeScheduleId) {
        const previewedContentHash = preview.restore?.base.contentHash;
        await deploySchedulesApi.resume(chatbotId, resumeScheduleId, {
          scheduledAt: instant.toISOString() as never,
          previewedContentHash: previewedContentHash as never,
        });
      } else {
        const dto = buildDto();
        if (!dto) return;
        const previewedContentHash = action === 'RESTORE_VERSION' ? preview.restore?.base.contentHash : undefined;
        await deploySchedulesApi.create(chatbotId, {
          ...dto,
          previewedContentHash,
          memo: memo.trim() ? memo.trim() : undefined,
          postRunTestSetId: postRunTestEnabled && postRunTestSetId ? postRunTestSetId : undefined,
        } as never);
      }
      if (!isMountedRef.current) return;
      onCreated(label);
    } catch (e) {
      if (!isMountedRef.current) return;
      if (e instanceof ApiError && (e.code === 'RESTORE_PREVIEW_STALE' || e.code === 'RESTORE_BLOCKED_BY_ACTIVE_JOB' || e.code === 'RESTORE_BUSY')) {
        setStaleBanner(true);
        await fetchPreview();
      } else if (e instanceof ApiError && e.code === 'DEPLOY_SCHEDULE_LIMIT_EXCEEDED') {
        setLimitExceeded(true);
      } else if (e instanceof ApiError && e.code === 'DEPLOY_SCHEDULE_PRECONDITION_FAILED') {
        const reason = e.details?.[0]?.message as DeploySchedulePreconditionReason | undefined;
        setSubmitError((reason && preconditionMessage(reason)) ?? e.message);
      } else if (e instanceof ApiError && e.code === 'VALIDATION_FAILED') {
        setAckError(true);
      } else if (e instanceof ApiError) {
        setSubmitError(e.message);
      } else {
        setSubmitError(MESSAGES.errors.generic);
      }
    } finally {
      if (isMountedRef.current) setSubmitting(false);
    }
  }

  const relativeText = instant ? relativeFutureText(instant, new Date()) : undefined;
  const timeError = (() => {
    if (!preview) return undefined;
    if (preview.timeViolations.some((v) => v.rule === 'LEAD')) return msg.timeErrors.LEAD(formatInZone(defaultScheduledAt(new Date(), DEPLOY_SCHEDULE_LIMITS.minLeadMinutes), timezone));
    if (preview.timeViolations.some((v) => v.rule === 'HORIZON')) {
      const max = new Date(Date.now() + DEPLOY_SCHEDULE_LIMITS.maxHorizonDays * 86_400_000);
      return msg.timeErrors.HORIZON(formatInZone(max, timezone));
    }
    if (preview.timeViolations.some((v) => v.rule === 'SPACING')) return msg.timeErrors.SPACING(local.date ? `${local.date} ${local.hour}:${local.minute}` : '');
    return undefined;
  })();

  const nonBlockerPreconditionMessages = (preview?.preconditionFailures ?? [])
    .map((f) => preconditionMessage(f.code))
    .filter((m): m is string => Boolean(m));

  const hasBlockers = (preview?.restore?.blockers.length ?? 0) > 0;
  const canSubmit = Boolean(preview && preview.creatable && !previewLoading && !submitting);

  // No.28 리뷰 2라운드 M-3 — 동작별 필요 권한도 카드 단계에서 선제 차단한다(서버가 최종 통제하지만
  // 화면이 애초에 만들 수 없는 예약을 제시하지 않는다, §6).
  const actionOptions: ActionPickerOption[] = [
    {
      action: 'RESTORE_VERSION',
      disabled: !versionId || !canManageDeploySchedule(can, 'RESTORE_VERSION'),
      disabledHint: !versionId
        ? MESSAGES.deploySchedules.actionPicker.RESTORE_VERSION_DISABLED_HINT
        : !canManageDeploySchedule(can, 'RESTORE_VERSION')
          ? MESSAGES.deploySchedules.actionPicker.NO_PERMISSION_HINT
          : undefined,
    },
    {
      action: 'PUBLISH',
      disabled: chatbotStatus !== 'DRAFT' || !canManageDeploySchedule(can, 'PUBLISH'),
      disabledHint:
        chatbotStatus !== 'DRAFT'
          ? MESSAGES.deploySchedules.actionPicker.PUBLISH_DISABLED_HINT
          : !canManageDeploySchedule(can, 'PUBLISH')
            ? MESSAGES.deploySchedules.actionPicker.NO_PERMISSION_HINT
            : undefined,
    },
    {
      action: 'SET_WEB_CHANNEL',
      disabled: !canManageDeploySchedule(can, 'SET_WEB_CHANNEL'),
      disabledHint: !canManageDeploySchedule(can, 'SET_WEB_CHANNEL') ? MESSAGES.deploySchedules.actionPicker.NO_PERMISSION_HINT : undefined,
    },
  ];

  const title = mode === 'RESUME' ? msg.resumeTitle : action ? msg.titleByAction[action] : MESSAGES.deploySchedules.createButton;
  // No.28 리뷰 2라운드 L — G3(반영 직후 TC)는 SET_WEB_CHANNEL에는 적용할 수 없다
  // (백엔드 `isPostRunTestApplicable` 판정과 정합 — 서버가 최종 409로도 막지만 화면에서 먼저 숨긴다).
  const canG3 = can('simulation:write') && action !== 'SET_WEB_CHANNEL';

  return (
    <Modal isOpen={isOpen} title={title} onClose={handleClose} closeOnEsc={!submitting} initialFocusSelector='[data-autofocus="cancel"]'>
      {!action ? (
        <ActionPickerStep options={actionOptions} onSelect={setAction} />
      ) : (
        <div>
          {staleBanner && (
            <p className="modal-banner modal-banner--warning" role="status" aria-live="polite">
              {msg.staleBanner}
            </p>
          )}
          {limitExceeded && (
            <p className="modal-banner modal-banner--error" role="alert">
              {msg.limitExceeded}
            </p>
          )}
          {submitError && (
            <p className="modal-banner modal-banner--error" role="alert">
              {submitError}
            </p>
          )}
          {nonBlockerPreconditionMessages.map((m, i) => (
            <p key={i} className="modal-banner modal-banner--error" role="alert">
              {m}
            </p>
          ))}

          {action === 'RESTORE_VERSION' && versionNo !== undefined && <p className="field-label-static">{msg.targetLabel(versionNo)}</p>}
          {preview?.restore && <ChainBasisNotice base={preview.restore.base} timezone={timezone} />}
          {preview?.restore && !hasBlockers && <p className="restore-diff-summary">{summaryLine(preview.restore.diffSummary.rows)}</p>}
          {preview?.restore && hasBlockers && (
            <ul className="restore-blocker-list">
              {preview.restore.blockers.map((b, i) => (
                <li key={i}>
                  <span aria-hidden="true">⚠</span> <BlockerText blocker={b} />
                </li>
              ))}
            </ul>
          )}

          {action === 'PUBLISH' && (
            <label className="form-field--inline">
              <input type="checkbox" checked={enableWebChannel} onChange={(e) => setEnableWebChannel(e.target.checked)} />
              {msg.enableWebChannelLabel}
            </label>
          )}

          {action === 'SET_WEB_CHANNEL' && props.enabled === undefined && (
            <fieldset className="form-field">
              <legend>{MESSAGES.deploySchedules.actionPicker.directionLabel}</legend>
              <label>
                <input type="radio" name="schedule-direction" checked={direction} onChange={() => setDirection(true)} />
                {MESSAGES.deploySchedules.actionPicker.directionOpen}
              </label>
              <label>
                <input type="radio" name="schedule-direction" checked={!direction} onChange={() => setDirection(false)} />
                {MESSAGES.deploySchedules.actionPicker.directionClose}
              </label>
            </fieldset>
          )}

          <ScheduledAtField
            idPrefix="schedule-deploy"
            timezoneLabel={tzLabel}
            date={local.date}
            hour={local.hour}
            minute={local.minute}
            onDateChange={(v) => setLocal((p) => ({ ...p, date: v }))}
            onHourChange={(v) => setLocal((p) => ({ ...p, hour: v }))}
            onMinuteChange={(v) => setLocal((p) => ({ ...p, minute: v }))}
            relativeText={relativeText}
            error={timeError}
            disabled={submitting}
          />

          {mode !== 'RESUME' && (
            <div className="form-field">
              <label htmlFor="schedule-deploy-memo">{msg.memoLabel}</label>
              <textarea
                id="schedule-deploy-memo"
                value={memo}
                maxLength={DEPLOY_SCHEDULE_LIMITS.memoMaxCodePoints}
                onChange={(e) => setMemo(e.target.value)}
              />
              <p className="char-counter">{msg.memoCount(Array.from(memo).length, DEPLOY_SCHEDULE_LIMITS.memoMaxCodePoints)}</p>
            </div>
          )}

          {preview && preview.readinessWarnings.length > 0 && (
            <div className="readiness-block">
              <p className="restore-warning-heading">{MESSAGES.deploySchedules.detail.readinessHeading}</p>
              <ReadinessWarningList warnings={preview.readinessWarnings} />
            </div>
          )}

          {preview?.restore?.requiresAcknowledgeActive && (
            <div>
              <label className="restore-ack-checkbox">
                <input
                  type="checkbox"
                  checked={acknowledgeActive}
                  onChange={(e) => {
                    setAcknowledgeActive(e.target.checked);
                    setAckError(false);
                  }}
                />
                {msg.acknowledgeActiveLabel}
              </label>
              {ackError && (
                <p className="field-error" role="alert">
                  {msg.acknowledgeActiveError}
                </p>
              )}
            </div>
          )}

          {mode !== 'RESUME' && canG3 && (
            <div className="form-field">
              <label>
                <input type="checkbox" checked={postRunTestEnabled} onChange={(e) => setPostRunTestEnabled(e.target.checked)} />
                {msg.postRunTestOptionLabel}
              </label>
              {postRunTestEnabled && (
                <label className="form-field--inline">
                  {msg.postRunTestSetLabel}
                  <select value={postRunTestSetId} onChange={(e) => setPostRunTestSetId(e.target.value)}>
                    <option value="">—</option>
                    {testSets.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
          )}

          {previewLoading && (
            <p role="status" aria-live="polite">
              {msg.previewLoading}
            </p>
          )}
          {!previewLoading && previewError && (
            <p className="modal-banner modal-banner--error" role="alert">
              {msg.loadFailed}
            </p>
          )}

          <div className="modal-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={submitting} data-autofocus="cancel">
              {msg.cancelButton}
            </button>
            <button type="button" className="btn btn-primary" onClick={() => void handleConfirm()} disabled={!canSubmit} aria-disabled={!canSubmit}>
              {submitting ? msg.confirming : confirmLabel()}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
