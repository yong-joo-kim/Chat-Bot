import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { ChatbotStatus, EnvironmentStatus, EnvironmentSwitchLogItem, VersionCurrentStatus } from '@chat-bot/shared-types';
import { MESSAGES } from '../../../constants/messages';
import { formatDateTime } from '../../../lib/date';
import { useToast } from '../../../components/Toast';
import { useDeployScheduleMeta } from '../../../lib/useDeployScheduleMeta';
import { testSetsApi } from '../../../api/validation';
import { ScheduleDeployDialog } from '../deploy-schedules/ScheduleDeployDialog';
import { summaryLine } from '../versions/restore/restorePreviewText';
import { StagingPromoteDialog } from './StagingPromoteDialog';
import { ProdSwitchDialog } from './ProdSwitchDialog';
import { GateSettingsPanel } from './GateSettingsPanel';
import { EnvironmentHistoryTable } from './EnvironmentHistoryTable';
import type { UseApprovalPolicyResult } from '../../../lib/useApprovalPolicy';
import { ApprovalPolicyPanel } from './approval/ApprovalPolicyPanel';
import { ApprovalPendingCard } from './approval/ApprovalPendingCard';

type EnabledStatus = Extract<EnvironmentStatus, { enabled: true }>;

export interface EnvironmentStatusPanelProps {
  chatbotId: string;
  chatbotStatus: ChatbotStatus;
  status: EnabledStatus;
  current: VersionCurrentStatus | null;
  canDeploy: boolean;
  canPromote: boolean;
  /** [신규 No.40 — §4.6(c)] `?openGate=1`로 들어왔으면 게이트 설정 섹션을 펼친 채로 시작한다. */
  openGateOnLoad?: boolean;
  /**
   * [신규 No.36] 운영 전환 2인 승인 정책·요청 조회 결과(`EnvironmentTab`의 `useApprovalPolicy`). 생략하면(기존 소비자·시험)
   * 승인 관련 UI를 렌더하지 않고 기존과 동일하게 동작한다.
   */
  approval?: UseApprovalPolicyResult;
  isArchived?: boolean;
  onDisableRequested: () => void;
  onRefresh: () => void;
}

/** EN1 모드 켜짐 3단 현황(`environment-separation-ui-spec.md` §4.2). */
export function EnvironmentStatusPanel({
  chatbotId,
  chatbotStatus,
  status,
  current,
  canDeploy,
  canPromote,
  openGateOnLoad = false,
  approval,
  isArchived = false,
  onDisableRequested,
  onRefresh,
}: EnvironmentStatusPanelProps): JSX.Element {
  const msg = MESSAGES.environment;
  const apMsg = MESSAGES.switchApproval;
  const { showToast } = useToast();
  const deployMeta = useDeployScheduleMeta();
  // [신규 No.36] 정책이 켜졌는지 — 환경 상태 응답의 `approval`(켜졌을 때만 존재)을 우선하고, 별도 조회 결과로 보완한다.
  const approvalOn = status.approval?.required === true || approval?.status?.policy.required === true;
  const approvalTtl = status.approval?.ttlHours ?? approval?.status?.policy.ttlHours ?? null;
  // 승인 요청을 막 보낸 직후 새로 생긴 대기 카드 제목으로 포커스를 옮긴다.
  const [focusPendingCard, setFocusPendingCard] = useState(false);

  const [promoteOpen, setPromoteOpen] = useState(false);
  const [switchDialog, setSwitchDialog] = useState<{ kind: 'SWITCH' | 'ROLLBACK'; targetVersionId?: string } | null>(null);
  const [scheduleTarget, setScheduleTarget] = useState<{ versionId: string; versionNo: number } | null>(null);
  // [신규 No.40 — §4.6(d)] 게이트 요약 한 줄에 TC 세트 이름을 보이려고 1회만 더 조회한다(기존 API로
  // 이름을 얻을 수 있으므로 API 신설 없이 `testSetsApi.list()`를 재사용 — `GateSettingsPanel`도 펼칠 때
  // 같은 API를 쓰지만 그건 선택 폼을 채우는 별도 호출이라 여기서 겸용하지 않는다).
  const [gateTestSetName, setGateTestSetName] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!status.gate.testSetId) {
      setGateTestSetName(undefined);
      return;
    }
    let cancelled = false;
    testSetsApi
      .list(chatbotId, { pageSize: 100 })
      .then((res) => {
        if (cancelled) return;
        setGateTestSetName(res.items.find((s) => s.id === status.gate.testSetId)?.name);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [chatbotId, status.gate.testSetId]);

  const draftSameAsProd = status.draft.sameAsProd;
  const canPromoteNow = canPromote && !status.draft.sameAsStaging;
  const canSwitchNow = canDeploy && Boolean(status.staging) && status.staging?.versionId !== status.prod.versionId;
  const stagingDiffSummaryText = current?.stagingDiff ? summaryLine(current.stagingDiff.rows) : '';

  function handleRollbackFromHistory(item: EnvironmentSwitchLogItem): void {
    if (!item.toVersionId) return;
    setSwitchDialog({ kind: 'ROLLBACK', targetVersionId: item.toVersionId });
  }

  function handleScheduleFromHistory(item: EnvironmentSwitchLogItem): void {
    if (!item.toVersionId || !item.toVersionNo) return;
    setScheduleTarget({ versionId: item.toVersionId, versionNo: item.toVersionNo });
  }

  const gateSummary =
    status.gate.mode === 'WARN'
      ? msg.gate.summaryWarnText
      : status.gate.testSetId
        ? msg.gate.summaryBlockText(gateTestSetName ?? '—', status.gate.minPassRate)
        : msg.gate.summaryBlockNoSetText;

  const sp = msg.statusPanel;

  return (
    <div className="environment-status-panel">
      <div className="environment-status-header">
        <h1>{msg.off.title}</h1>
        {canDeploy && (
          <div className="environment-disable-wrap">
            {/* [신규 No.36] 2인 승인이 켜져 있으면 끄기를 막는다 — aria-disabled(포커스 유지) + 🔒 + 사유 글자, 클릭해도 대화상자를 열지 않는다. */}
            <button
              type="button"
              className="btn btn-secondary"
              aria-disabled={approvalOn || undefined}
              aria-describedby={approvalOn ? 'env-disable-locked-reason' : undefined}
              onClick={() => {
                if (approvalOn) return;
                onDisableRequested();
              }}
            >
              {approvalOn && <span aria-hidden="true">🔒 </span>}
              {sp.disableButton}
            </button>
            {approvalOn && (
              <p id="env-disable-locked-reason" className="field-hint">
                {apMsg.environment.disableLocked}{' '}
                <a
                  href="#approval-policy"
                  onClick={(e) => {
                    e.preventDefault();
                    const heading = document.getElementById('approval-policy-title');
                    heading?.scrollIntoView?.();
                    heading?.focus();
                  }}
                >
                  {apMsg.environment.disableLockedLink}
                </a>
              </p>
            )}
          </div>
        )}
      </div>

      <div className="environment-status-cards">
        <section className="environment-status-card" aria-label={sp.draftTitle}>
          <h2>{sp.draftTitle}</h2>
          <p className={draftSameAsProd ? 'environment-draft-same' : 'environment-draft-diff'}>{draftSameAsProd ? sp.draftSame : sp.draftDiff}</p>
          {canPromote && (
            <button type="button" className="btn btn-secondary" onClick={() => setPromoteOpen(true)} aria-disabled={!canPromoteNow} disabled={!canPromoteNow}>
              {msg.promoteDialog.confirmButton}
            </button>
          )}
        </section>

        <section className="environment-status-card" aria-label={sp.stagingTitle}>
          <h2>{sp.stagingTitle}</h2>
          {status.staging ? (
            <>
              <p>v{status.staging.versionNo}</p>
              <p className="field-hint">{formatDateTime(status.staging.capturedAt)}</p>
              {status.staging.legacyTiebreak && <p className="field-hint">ⓘ {msg.switchDialog.warnings.LEGACY_TIEBREAK}</p>}
              {status.staging.semanticPending > 0 && <p className="field-hint">{msg.targetBadge.semanticPendingHint(status.staging.semanticPending)}</p>}
              {canDeploy && (
                <>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => setSwitchDialog({ kind: 'SWITCH', targetVersionId: status.staging?.versionId })}
                    aria-disabled={!canSwitchNow}
                    disabled={!canSwitchNow}
                  >
                    {approvalOn ? apMsg.environment.switchButtonOn : sp.switchPreviewButton}
                  </button>{' '}
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => status.staging && setScheduleTarget({ versionId: status.staging.versionId, versionNo: status.staging.versionNo })}
                  >
                    {approvalOn ? apMsg.environment.scheduleButtonOn : sp.scheduleSwitchButton}
                  </button>
                </>
              )}
            </>
          ) : (
            <p>—</p>
          )}
        </section>

        <section className="environment-status-card" aria-label={sp.prodTitle}>
          <h2>{sp.prodTitle}</h2>
          <p>v{status.prod.versionNo}</p>
          <p className="field-hint">{formatDateTime(status.prod.switchedAt)}</p>
          {status.prod.readFailed && <p className="field-error">{sp.readFailed}</p>}
          {status.prod.legacyTiebreak && <p className="field-hint">ⓘ {msg.switchDialog.warnings.LEGACY_TIEBREAK}</p>}
          {status.prod.semanticPending > 0 && <p className="field-hint">{msg.targetBadge.semanticPendingHint(status.prod.semanticPending)}</p>}
          {canDeploy && (
            <>
              <button
                type="button"
                className="btn btn-secondary"
                aria-describedby={approvalOn ? 'env-rollback-hint' : undefined}
                onClick={() => setSwitchDialog({ kind: 'ROLLBACK' })}
              >
                {sp.rollbackButton}
              </button>
              {approvalOn && (
                <p id="env-rollback-hint" className="field-hint">
                  {apMsg.environment.rollbackHint}
                </p>
              )}
            </>
          )}
        </section>
      </div>

      {status.activeSwitchSchedule && (
        <p className="environment-active-schedule">
          {sp.scheduledBannerPrefix} {formatDateTime(status.activeSwitchSchedule.scheduledAt)} → v{status.activeSwitchSchedule.targetVersionNo} (
          {status.activeSwitchSchedule.status === 'PENDING' ? sp.scheduledStatusPending : sp.scheduledStatusHeld}){' '}
          <Link to={`/chatbots/${chatbotId}/deploy-schedules/${status.activeSwitchSchedule.scheduleId}`}>{sp.scheduledLink}</Link>
        </p>
      )}

      {/* [신규 No.36] 승인 대기 요청 카드(제안 · 승인 전) + 운영 전환 2인 승인 설정 패널 — 3카드와 게이트 사이(ui-spec §9.2).
          정책 조회가 실패해도 이 두 블록만 축약 오류로 대체되고 전환 흐름은 막히지 않는다. */}
      {approval && approval.status?.pending && (
        <ApprovalPendingCard
          chatbotId={chatbotId}
          request={approval.status.pending}
          focusOnMount={focusPendingCard}
          onChanged={() => {
            setFocusPendingCard(false);
            onRefresh();
          }}
        />
      )}
      {approval && approval.status && <ApprovalPolicyPanel chatbotId={chatbotId} status={approval.status} archived={isArchived} onChanged={onRefresh} />}
      {approval && !approval.status && approval.loading && <div className="skeleton skeleton-card" aria-busy="true" />}
      {approval && !approval.status && !approval.loading && approval.error && (
        <div className="error-state" role="alert">
          <p className="error-state-title">
            <span aria-hidden="true">⚠</span> {apMsg.policy.loadFailed}
          </p>
          <button type="button" className="btn btn-secondary" onClick={() => void approval.reload()}>
            {MESSAGES.common.retry}
          </button>
        </div>
      )}

      <p className="field-hint">{gateSummary}</p>
      <GateSettingsPanel
        chatbotId={chatbotId}
        gate={status.gate}
        canWrite={canDeploy}
        onSaved={onRefresh}
        initiallyExpanded={openGateOnLoad}
        currentTestSetName={gateTestSetName}
      />

      <EnvironmentHistoryTable
        chatbotId={chatbotId}
        canDeploy={canDeploy}
        currentProdVersionId={status.prod.versionId}
        onRollbackRequested={handleRollbackFromHistory}
        onScheduleSwitchRequested={handleScheduleFromHistory}
      />

      {current && (
        <StagingPromoteDialog
          chatbotId={chatbotId}
          isOpen={promoteOpen}
          onClose={() => setPromoteOpen(false)}
          nextVersionNo={(current.latestVersion?.versionNo ?? 0) + 1}
          expectedStagingVersionId={status.staging?.versionId ?? null}
          changesSummaryText={stagingDiffSummaryText}
          onPromoted={(res) => {
            setPromoteOpen(false);
            showToast(res.outcome === 'REUSED' ? msg.promoteDialog.reusedToast(res.staging.versionNo) : msg.promoteDialog.createdToast(res.staging.versionNo));
            onRefresh();
          }}
        />
      )}

      {switchDialog && (
        <ProdSwitchDialog
          chatbotId={chatbotId}
          kind={switchDialog.kind}
          targetVersionId={switchDialog.targetVersionId}
          isOpen={switchDialog !== null}
          onClose={() => setSwitchDialog(null)}
          gateSettings={status.gate}
          approvalTtlHours={approvalTtl}
          onSwitched={(res) => {
            setSwitchDialog(null);
            showToast(msg.switchDialog.successToast(res.prod.versionNo));
            onRefresh();
          }}
          onRequested={() => {
            setSwitchDialog(null);
            showToast(apMsg.dialog.requestSuccess);
            setFocusPendingCard(true);
            onRefresh();
          }}
        />
      )}

      {deployMeta && scheduleTarget && (
        <ScheduleDeployDialog
          chatbotId={chatbotId}
          isOpen={scheduleTarget !== null}
          onClose={() => setScheduleTarget(null)}
          onCreated={(label, info) => {
            setScheduleTarget(null);
            showToast(info?.approvalRequested ? apMsg.schedule.createdAndRequested : MESSAGES.deploySchedules.dialog.createSuccess(label));
            if (info?.approvalRequested) setFocusPendingCard(true);
            onRefresh();
          }}
          timezone={deployMeta.timezone}
          chatbotStatus={chatbotStatus}
          initialAction="SWITCH_PROD_VERSION"
          versionId={scheduleTarget.versionId}
          versionNo={scheduleTarget.versionNo}
          environmentStatus={status}
        />
      )}
    </div>
  );
}
