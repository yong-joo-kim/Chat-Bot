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
  onDisableRequested,
  onRefresh,
}: EnvironmentStatusPanelProps): JSX.Element {
  const msg = MESSAGES.environment;
  const { showToast } = useToast();
  const deployMeta = useDeployScheduleMeta();

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
          <button type="button" className="btn btn-secondary" onClick={onDisableRequested}>
            {sp.disableButton}
          </button>
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
                    {sp.switchPreviewButton}
                  </button>{' '}
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => status.staging && setScheduleTarget({ versionId: status.staging.versionId, versionNo: status.staging.versionNo })}
                  >
                    {sp.scheduleSwitchButton}
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
            <button type="button" className="btn btn-secondary" onClick={() => setSwitchDialog({ kind: 'ROLLBACK' })}>
              {sp.rollbackButton}
            </button>
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
          onSwitched={(res) => {
            setSwitchDialog(null);
            showToast(msg.switchDialog.successToast(res.prod.versionNo));
            onRefresh();
          }}
        />
      )}

      {deployMeta && scheduleTarget && (
        <ScheduleDeployDialog
          chatbotId={chatbotId}
          isOpen={scheduleTarget !== null}
          onClose={() => setScheduleTarget(null)}
          onCreated={(label) => {
            setScheduleTarget(null);
            showToast(MESSAGES.deploySchedules.dialog.createSuccess(label));
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
