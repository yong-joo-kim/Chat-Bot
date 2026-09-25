import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type {
  ChatbotStatus,
  DeployScheduleAction,
  DeploySchedulePreconditionReason,
  DeploySchedulePreviewResponse,
  EnvironmentStatus,
  EnvironmentSwitchLogItem,
  TestCaseSet,
} from '@chat-bot/shared-types';
import { DEPLOY_SCHEDULE_LIMITS } from '@chat-bot/shared-types';
import { Modal } from '../../../components/Modal';
import { ScheduledAtField } from '../../../components/ScheduledAtField';
import { GateResultBadge } from '../../../components/GateResultBadge';
import { MESSAGES } from '../../../constants/messages';
import { formatDateTime } from '../../../lib/date';
import { ApiError } from '../../../api/client';
import { deploySchedulesApi } from '../../../api/deploySchedules';
import { environmentApi } from '../../../api/environment';
import { testSetsApi } from '../../../api/validation';
import { useAuth } from '../../../context/AuthContext';
import { canManageDeploySchedule } from '../../../lib/deploySchedulePermissions';
import { BlockerText, summaryLine } from '../versions/restore/restorePreviewText';
import { SwitchBlockerText, SwitchWarningText, type ProdSwitchBlockerCode } from '../environment/lib/switchPreviewText';
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
  /** `SWITCH_PROD_VERSION`일 때는 대상 버전 id로도 쓰인다. */
  versionId?: string;
  versionNo?: number;
  /** `SET_WEB_CHANNEL`의 목표 방향. 진입 문맥이 고정하지 않으면(S1 "+ 예약 만들기") 사용자가 선택한다. */
  enabled?: boolean;
  /** 재개(HELD→PENDING) 대상 예약 id(`mode='RESUME'`일 때 필수). */
  resumeScheduleId?: string;
  /**
   * [신규 No.40] `SWITCH_PROD_VERSION` 카드 gating(§4.9)·`previewedProdVersionId` 산출에 쓴다.
   * `ChatbotDetailContext.environmentStatus`를 그대로 넘긴다 — 이 다이얼로그가 별도로 조회하지 않는다.
   */
  environmentStatus?: EnvironmentStatus | null;
}

type LocalTime = { date: string; hour: string; minute: string };

function toLocalTime(instant: Date, timezone: string): LocalTime {
  const s = formatInZone(instant, timezone);
  const [date, time] = s.split(' ');
  const [hour, minute] = time.split(':');
  return { date, hour, minute };
}

function preconditionMessage(code: DeploySchedulePreconditionReason, switchBlockerCode?: ProdSwitchBlockerCode): string | null {
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
    // [신규 No.40] 운영 전환 미리보기가 blocker를 낸 상태에서 예약을 생성하려는 경우(§4.9 "전제 조건 사유").
    // 생성 시점 409 상세에는 blocker 세부 코드가 없을 수 있어, 직전 미리보기(`preview.switchProd.blockers[0]`)로
    // 보강한다(호출부가 넘긴다) — §3.3-5 매핑 재사용, 새 매핑을 만들지 않는다.
    case 'SWITCH_BLOCKED':
      return SwitchBlockerText(switchBlockerCode ?? 'TARGET_NOT_ALLOWED');
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
  const { chatbotId, isOpen, onClose, onCreated, timezone, chatbotStatus, mode = 'CREATE', initialAction, versionId, versionNo, resumeScheduleId, environmentStatus } = props;
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

  // [신규 No.40] SWITCH_PROD_VERSION — 진입 문맥이 대상을 고정하지 않았을 때(S1)만 쓰는 선택 상태.
  const [pickedTarget, setPickedTarget] = useState<{ id: string; no: number } | null>(null);
  const [targetHistory, setTargetHistory] = useState<EnvironmentSwitchLogItem[]>([]);
  const [targetHistoryLoading, setTargetHistoryLoading] = useState(false);
  const [acknowledgeSwitchWarnings, setAcknowledgeSwitchWarnings] = useState(false);
  const [switchAckError, setSwitchAckError] = useState(false);

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
    setPickedTarget(null);
    setAcknowledgeSwitchWarnings(false);
    setSwitchAckError(false);
    setPreview(null);
    setStaleBanner(false);
    setLimitExceeded(false);
    setSubmitError(null);
    const now = new Date();
    setLocal(toLocalTime(defaultScheduledAt(now, DEPLOY_SCHEDULE_LIMITS.minLeadMinutes), timezone));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, initialAction]);

  // [신규 No.40] S1 진입(대상 미고정)일 때만 스테이징+운영 이력에서 고를 대상 목록을 불러온다.
  useEffect(() => {
    if (!isOpen || action !== 'SWITCH_PROD_VERSION' || versionId) return;
    setTargetHistoryLoading(true);
    environmentApi
      .history(chatbotId, { environment: 'PROD', pageSize: 20 })
      .then((res) => {
        if (isMountedRef.current) setTargetHistory(res.items);
      })
      .catch(() => undefined)
      .finally(() => {
        if (isMountedRef.current) setTargetHistoryLoading(false);
      });
  }, [isOpen, action, versionId, chatbotId]);

  const instant = useMemo(() => localPartsToInstant(local.date, local.hour, local.minute, timezone), [local, timezone]);
  const switchTargetId = versionId ?? pickedTarget?.id;
  const switchTargetNo = versionNo ?? pickedTarget?.no;

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
    if (action === 'SWITCH_PROD_VERSION') {
      if (!switchTargetId) return null;
      return { action, targetVersionId: switchTargetId, scheduledAt, acknowledgeWarnings: acknowledgeSwitchWarnings || undefined };
    }
    return { action: 'SET_WEB_CHANNEL', enabled: direction, scheduledAt };
  }, [action, instant, versionId, acknowledgeActive, enableWebChannel, direction, switchTargetId, acknowledgeSwitchWarnings]);

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
    if (action === 'SWITCH_PROD_VERSION' && !switchTargetId) return undefined;
    const timer = window.setTimeout(() => void fetchPreview(), 400);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, action, local, enableWebChannel, direction, switchTargetId]);

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
    if (action === 'SWITCH_PROD_VERSION' && switchTargetNo !== undefined) return msg.confirmButtonByAction.SWITCH_PROD_VERSION(formatted, switchTargetNo);
    return '';
  }

  async function handleConfirm(): Promise<void> {
    if (!preview || !action || !instant || submitting) return;
    if (preview.restore?.requiresAcknowledgeActive && !acknowledgeActive) {
      setAckError(true);
      return;
    }
    if (action === 'SWITCH_PROD_VERSION' && (preview.switchProd?.warnings.length ?? 0) > 0 && !acknowledgeSwitchWarnings) {
      setSwitchAckError(true);
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
        // [신규 No.40 — 2026-09-25 계약 보강 반영] `previewedProdVersionId` — 미리보기 시점의 기준(체인이면
        // 선행 예약의 대상 버전, 아니면 지금의 실제 운영 버전) 확인용. `preview.switchProd.expectedProdVersionId`가
        // 트랜잭션에서 실제로 비교되는 값이다 — `environmentStatus.prod.versionId`(지금의 실제 운영만 아는 값)를
        // 쓰면 체인 예약에서 기준이 달라 `409 ENV_POINTER_STALE`가 났다(수정 전 우회 코드).
        const previewedProdVersionId = action === 'SWITCH_PROD_VERSION' ? preview.switchProd?.expectedProdVersionId : undefined;
        await deploySchedulesApi.create(chatbotId, {
          ...dto,
          previewedContentHash,
          previewedProdVersionId,
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
        const switchBlockerCode = preview?.switchProd?.blockers[0] as ProdSwitchBlockerCode | undefined;
        setSubmitError((reason && preconditionMessage(reason, switchBlockerCode)) ?? e.message);
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

  const switchBlockerForPrecondition = preview?.switchProd?.blockers[0] as ProdSwitchBlockerCode | undefined;
  const nonBlockerPreconditionMessages = (preview?.preconditionFailures ?? [])
    .map((f) => preconditionMessage(f.code, switchBlockerForPrecondition))
    .filter((m): m is string => Boolean(m));

  const hasBlockers = (preview?.restore?.blockers.length ?? 0) > 0 || (preview?.switchProd?.blockers.length ?? 0) > 0;
  const needsTargetPick = action === 'SWITCH_PROD_VERSION' && !switchTargetId;
  const canSubmit = Boolean(preview && preview.creatable && !previewLoading && !submitting && !needsTargetPick);

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
    // [신규 No.40] 환경 분리 — 운영 버전 전환 예약 카드(§4.9).
    {
      action: 'SWITCH_PROD_VERSION',
      disabled: !environmentStatus?.enabled || !canManageDeploySchedule(can, 'SWITCH_PROD_VERSION'),
      disabledHint: !environmentStatus?.enabled
        ? MESSAGES.deploySchedules.actionPicker.SWITCH_PROD_VERSION_DISABLED_HINT_OFF
        : !canManageDeploySchedule(can, 'SWITCH_PROD_VERSION')
          ? MESSAGES.deploySchedules.actionPicker.SWITCH_PROD_VERSION_DISABLED_HINT_PERM
          : undefined,
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
          {action === 'SWITCH_PROD_VERSION' && switchTargetNo !== undefined && <p className="field-label-static">{msg.targetLabel(switchTargetNo)}</p>}
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

          {/* [신규 No.40] 운영 버전 전환 예약 — 게이트 판정 + 차단/경고(§4.9, §3.3-3~5 매핑 재사용) */}
          {preview?.switchProd && !needsTargetPick && (
            <>
              {/* [R1 — 백엔드 리뷰 L-1] 아래 게이트·경고는 "지금(생성 시점)" 기준이다 — 실행 시점에는
                  게이트 차단만 다시 검사하고, 여기서 확인한 경고는 다시 보여주지 않는다는 점을 안내한다. */}
              <p className="field-hint">{MESSAGES.deploySchedules.dialog.switchProdPreviewTimingNotice}</p>
              <p>
                <GateResultBadge gate={preview.switchProd.gate} />
              </p>
              {preview.switchProd.blockers.length > 0 ? (
                <ul className="restore-blocker-list">
                  {preview.switchProd.blockers.map((b, i) => (
                    <li key={i}>
                      <span aria-hidden="true">⚠</span> {SwitchBlockerText(b as ProdSwitchBlockerCode, preview.switchProd?.gate)}
                      {/* [신규 No.40 — §4.6(c), R1 M-1] ProdSwitchDialog와 같은 패턴 — 게이트 설정 섹션을 펼친 채로
                          연다. `Link`로 SPA 내 이동만 수행해 전체 새로고침을 피한다(ProdSwitchDialog와 동일 방식). */}
                      {b === 'GATE_CONFIG_ERROR' && (
                        <>
                          {' '}
                          <Link to={`/chatbots/${chatbotId}/environment?openGate=1`}>{MESSAGES.environment.switchDialog.gateGoToSettingsLink}</Link>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                preview.switchProd.warnings.length > 0 && (
                  <div className="restore-warning-block">
                    <p className="restore-warning-heading">{MESSAGES.environment.switchDialog.warningsHeading}</p>
                    <ul className="restore-warning-list">
                      {preview.switchProd.warnings.map((w, i) => (
                        <li key={i}>{SwitchWarningText(w)}</li>
                      ))}
                    </ul>
                  </div>
                )
              )}
              {preview.switchProd.blockers.length === 0 && preview.switchProd.warnings.length > 0 && (
                <div>
                  <label className="restore-ack-checkbox" id="schedule-switch-ack-label">
                    <input
                      type="checkbox"
                      checked={acknowledgeSwitchWarnings}
                      onChange={(e) => {
                        setAcknowledgeSwitchWarnings(e.target.checked);
                        setSwitchAckError(false);
                      }}
                    />
                    {MESSAGES.environment.switchDialog.acknowledgeLabel}
                  </label>
                  {switchAckError && (
                    <p className="field-error" role="alert">
                      {MESSAGES.environment.switchDialog.acknowledgeError}
                    </p>
                  )}
                </div>
              )}
            </>
          )}

          {/* [신규 No.40] S1 진입(대상 미고정)에서만 뜨는 서브스텝 — 스테이징 + 운영 이력 중 선택 */}
          {action === 'SWITCH_PROD_VERSION' && !switchTargetId && (
            <fieldset className="form-field">
              <legend>{MESSAGES.environment.targetVersionPicker.heading}</legend>
              {targetHistoryLoading && (
                <p role="status" aria-live="polite">
                  {MESSAGES.common.loading}
                </p>
              )}
              {environmentStatus?.enabled && environmentStatus.staging && (
                <label>
                  <input
                    type="radio"
                    name="schedule-switch-target"
                    onChange={() => setPickedTarget({ id: environmentStatus.staging!.versionId, no: environmentStatus.staging!.versionNo })}
                  />
                  {MESSAGES.environment.targetVersionPicker.stagingOption(environmentStatus.staging.versionNo)}
                </label>
              )}
              {targetHistory
                .filter((h) => h.toVersionId && h.toVersionId !== (environmentStatus?.enabled ? environmentStatus.prod.versionId : undefined))
                .filter((h, i, arr) => arr.findIndex((x) => x.toVersionId === h.toVersionId) === i)
                .map((h) => (
                  <label key={h.id}>
                    <input type="radio" name="schedule-switch-target" onChange={() => setPickedTarget({ id: h.toVersionId as string, no: h.toVersionNo as number })} />
                    {MESSAGES.environment.targetVersionPicker.prodHistoryOption(h.toVersionNo as number, formatDateTime(h.createdAt))}
                  </label>
                ))}
            </fieldset>
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
