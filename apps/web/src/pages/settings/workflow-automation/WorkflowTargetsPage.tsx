import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { ApiErrorDetail, WorkflowTarget } from '@chat-bot/shared-types';
import { workflowTargetsApi } from '../../../api/workflowTargets';
import { workflowRunsApi } from '../../../api/workflowRuns';
import { ApiError } from '../../../api/client';
import { useAuth } from '../../../context/AuthContext';
import { useToast } from '../../../components/Toast';
import { EmptyState } from '../../../components/EmptyState';
import { ErrorState } from '../../../components/ErrorState';
import { SkeletonRow } from '../../../components/Skeleton';
import { KebabMenu } from '../../../components/KebabMenu';
import { MESSAGES } from '../../../constants/messages';
import { RawPersonalDataBadge, SecretStatusBadge } from '../api-connections/badges';
import { ConsecutiveFailureBadge, SigningWeakBadge, TargetEnabledBadge, TargetPausedBadge } from './badges';
import { WorkflowTargetFilterBar } from './WorkflowTargetFilterBar';
import { WorkflowTargetEditModal } from './WorkflowTargetEditModal';
import { DeleteWorkflowTargetConfirmDialog } from './DeleteWorkflowTargetConfirmDialog';

/** WF1 — 발송 대상 관리(`/settings/workflow-automation/targets`, `workflow-automation-ui-spec.md` §3.1). */
export function WorkflowTargetsPage(): JSX.Element {
  const { can } = useAuth();
  const { showToast } = useToast();
  const msg = MESSAGES.workflowTargets;
  const canWrite = can('security:write');

  // [코드리뷰 R1 M-1] WF1-c "확인 필요" 항목이 쿼리스트링으로 필터를 실어 이 화면에 이동시킨다
  // (ui-spec §3.3 — 예: "연속 실패 대상 N개" 클릭 → `?attention=consecutiveFailures`).
  const [searchParams] = useSearchParams();
  const [q, setQ] = useState(() => searchParams.get('q') ?? '');
  const [enabledFilter, setEnabledFilter] = useState<boolean[]>([true, false]);
  const [includePaused, setIncludePaused] = useState(true);
  const attentionFilter = searchParams.get('attention');
  const [items, setItems] = useState<WorkflowTarget[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const [formOpen, setFormOpen] = useState(false);
  const [editingTarget, setEditingTarget] = useState<WorkflowTarget | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<WorkflowTarget | null>(null);
  const [deleteInUse, setDeleteInUse] = useState<ApiErrorDetail[] | null>(null);
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);

  // [신규 No.41 2차] WF1 기능 꺼짐 배너 — `WORKFLOW_ENABLED` 값은 별도 엔드포인트 없이 요약 응답
  // 최상위 `featureEnabled`로 내려온다(WF1-b/WF1-c가 각자 조회하는 것과 별개로, 이 탭은 목록만
  // 부르므로 배너 전용으로 1회 추가 조회한다 — 실패해도 목록 표시 자체는 막지 않는다).
  const [featureEnabled, setFeatureEnabled] = useState(true);
  useEffect(() => {
    workflowRunsApi
      .summary(7)
      .then((res) => setFeatureEnabled(res.featureEnabled))
      .catch(() => undefined);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const res = await workflowTargetsApi.list();
      setItems(res.items);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const lowered = q.trim().toLowerCase();
    return items.filter((it) => {
      if (lowered && !it.name.toLowerCase().includes(lowered)) return false;
      if (!enabledFilter.includes(it.enabled)) return false;
      if (!includePaused && it.pausedAt) return false;
      // [코드리뷰 R1 M-1] WF1-c에서 넘어온 `attention` 마커 — 요약 응답은 이름 없이 건수만 주므로
      // 목록 화면에서 이미 갖고 있는 대상별 값으로 같은 조건을 재현한다(추가 호출 없음).
      if (attentionFilter === 'consecutiveFailures' && it.consecutiveFailures < 10) return false;
      if (
        attentionFilter === 'secretMissing' &&
        it.secretStates.auth !== 'MISSING' &&
        it.secretStates.signing !== 'MISSING' &&
        it.secretStates.url !== 'MISSING'
      )
        return false;
      return true;
    });
  }, [items, q, enabledFilter, includePaused, attentionFilter]);

  function openCreate(): void {
    setEditingTarget(null);
    setFormOpen(true);
  }

  function openEdit(item: WorkflowTarget): void {
    setEditingTarget(item);
    setFormOpen(true);
  }

  async function handleDelete(): Promise<void> {
    if (!deleteTarget) return;
    setDeleteSubmitting(true);
    try {
      await workflowTargetsApi.remove(deleteTarget.id);
      showToast(msg.deleteSuccess);
      setDeleteTarget(null);
      setDeleteInUse(null);
      void load();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'WORKFLOW_TARGET_IN_USE') {
        setDeleteInUse(e.details ?? []);
      } else {
        showToast(e instanceof ApiError ? e.message : MESSAGES.errors.generic);
        setDeleteTarget(null);
      }
    } finally {
      setDeleteSubmitting(false);
    }
  }

  async function handlePause(item: WorkflowTarget): Promise<void> {
    try {
      const res = await workflowTargetsApi.pause(item.id);
      showToast(msg.pauseSuccess(res.heldCount));
      void load();
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : MESSAGES.errors.generic);
    }
  }

  async function handleResume(item: WorkflowTarget): Promise<void> {
    try {
      const res = await workflowTargetsApi.resume(item.id);
      showToast(msg.resumeSuccess(res.pendingCount, res.expiredCount));
      void load();
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : MESSAGES.errors.generic);
    }
  }

  const isEmpty = !loading && !error && items.length === 0;

  return (
    <div className="workflow-targets-page">
      {!featureEnabled && (
        <p className="form-banner form-banner--warning" role="status">
          <span aria-hidden="true">ⓘ</span> {msg.featureDisabledBanner}
        </p>
      )}
      <div className="dialogue-toolbar">
        <WorkflowTargetFilterBar
          q={q}
          onQChange={setQ}
          enabled={enabledFilter}
          onEnabledChange={setEnabledFilter}
          includePaused={includePaused}
          onIncludePausedChange={setIncludePaused}
        />
        {canWrite && (
          <button type="button" className="btn btn-primary" onClick={openCreate}>
            {msg.addButton}
          </button>
        )}
      </div>

      {loading && (
        <>
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
        </>
      )}
      {!loading && error && <ErrorState title={msg.loadFailed} onRetry={load} />}
      {isEmpty && (
        <EmptyState
          title={msg.emptyTitle}
          description={msg.emptyDesc}
          action={
            canWrite && (
              <button type="button" className="btn btn-primary" onClick={openCreate}>
                {msg.addButton}
              </button>
            )
          }
        />
      )}
      {!loading && !error && items.length > 0 && filtered.length === 0 && <EmptyState title={msg.emptyTitle} />}

      {!loading && !error && filtered.length > 0 && (
        <div className="dialogue-table-wrap">
          <table className="dialogue-table desktop-only">
            <caption className="sr-only">{`${msg.pageTitle} — 총 ${filtered.length}건`}</caption>
            <thead>
              <tr>
                <th scope="col">{msg.columnName}</th>
                <th scope="col">{msg.columnHost}</th>
                <th scope="col">{msg.columnAuth}</th>
                <th scope="col">{msg.columnSigning}</th>
                <th scope="col">{msg.columnSecret}</th>
                <th scope="col">{msg.columnStatus}</th>
                <th scope="col">{msg.columnReferencing}</th>
                <th scope="col">{msg.columnActions}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((item) => (
                <tr key={item.id}>
                  <td>
                    <div>{item.name}</div>
                    <div className="workflow-target-badge-row">
                      {item.allowRawPersonalData && <RawPersonalDataBadge />}
                      {item.consecutiveFailures >= 10 && <ConsecutiveFailureBadge count={item.consecutiveFailures} />}
                    </div>
                  </td>
                  <td>{item.urlSecretRef ? msg.hostSecretPlaceholder : item.baseUrlHost}</td>
                  <td>{item.authType}</td>
                  <td>
                    {item.signingEnabled ? msg.signingOn : msg.signingOff}
                    {item.secretStates.signingWeak && <SigningWeakBadge />}
                  </td>
                  <td>
                    <SecretStatusBadge status={item.secretStates.auth} />
                  </td>
                  <td>
                    <TargetEnabledBadge enabled={item.enabled} />
                    {item.pausedAt && <TargetPausedBadge />}
                  </td>
                  <td>
                    {item.referencingNodeCount + item.subscriptionCount}
                    <div className="field-hint">{msg.pendingHoldSuffix(item.pendingCount, item.heldCount)}</div>
                  </td>
                  <td>
                    <KebabMenu
                      label={`${item.name} 관리`}
                      items={[
                        { label: '수정', onSelect: () => openEdit(item), disabled: !canWrite },
                        { label: msg.testPanelTitle, onSelect: () => openEdit(item), disabled: !canWrite },
                        item.pausedAt
                          ? { label: msg.resumeButton, onSelect: () => void handleResume(item), disabled: !canWrite }
                          : { label: msg.pauseButton, onSelect: () => void handlePause(item), disabled: !canWrite },
                        { label: MESSAGES.common.delete, onSelect: () => setDeleteTarget(item), disabled: !canWrite },
                      ]}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <ul className="settings-card-list mobile-only">
            {filtered.map((item) => (
              <li key={item.id} className="settings-card">
                <div className="settings-card-header">
                  <span className="settings-card-title">{item.name}</span>
                  <TargetEnabledBadge enabled={item.enabled} />
                </div>
                <dl className="settings-card-fields">
                  <div>
                    <dt>{msg.columnHost}</dt>
                    <dd>{item.urlSecretRef ? msg.hostSecretPlaceholder : item.baseUrlHost}</dd>
                  </div>
                  <div>
                    <dt>{msg.columnSecret}</dt>
                    <dd>
                      <SecretStatusBadge status={item.secretStates.auth} />
                    </dd>
                  </div>
                  <div>
                    <dt>{msg.columnReferencing}</dt>
                    <dd>{item.referencingNodeCount + item.subscriptionCount}</dd>
                  </div>
                </dl>
                <KebabMenu
                  label={`${item.name} 관리`}
                  items={[
                    { label: '수정', onSelect: () => openEdit(item), disabled: !canWrite },
                    item.pausedAt
                      ? { label: msg.resumeButton, onSelect: () => void handleResume(item), disabled: !canWrite }
                      : { label: msg.pauseButton, onSelect: () => void handlePause(item), disabled: !canWrite },
                    { label: MESSAGES.common.delete, onSelect: () => setDeleteTarget(item), disabled: !canWrite },
                  ]}
                />
              </li>
            ))}
          </ul>
        </div>
      )}

      {formOpen && (
        <WorkflowTargetEditModal
          key={editingTarget?.id ?? 'new'}
          isOpen={formOpen}
          target={editingTarget}
          onClose={() => setFormOpen(false)}
          onSaved={() => {
            showToast(msg.saveSuccess);
            setFormOpen(false);
            void load();
          }}
        />
      )}

      <DeleteWorkflowTargetConfirmDialog
        target={deleteTarget}
        inUseDetails={deleteInUse}
        submitting={deleteSubmitting}
        onConfirm={() => void handleDelete()}
        onCancel={() => {
          setDeleteTarget(null);
          setDeleteInUse(null);
        }}
      />
    </div>
  );
}
