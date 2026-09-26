import { useCallback, useEffect, useState } from 'react';
import type { WorkflowSubscription, WorkflowSubscriptionEventType } from '@chat-bot/shared-types';
import { useChatbotDetailContext } from '../../ChatbotDetailLayout';
import { useAuth } from '../../../context/AuthContext';
import { useToast } from '../../../components/Toast';
import { ApiError } from '../../../api/client';
import { workflowSubscriptionsApi } from '../../../api/workflowSubscriptions';
import { SkeletonRow } from '../../../components/Skeleton';
import { ErrorState } from '../../../components/ErrorState';
import { WorkflowTargetPickerField } from '../../../components/WorkflowTargetPickerField';
import { MESSAGES } from '../../../constants/messages';
import { TargetPausedBadge } from '../../settings/workflow-automation/badges';

const EVENT_TYPES: WorkflowSubscriptionEventType[] = ['HANDOFF_STARTED', 'HANDOFF_ENDED', 'SURVEY_COMPLETED', 'FEEDBACK_NEGATIVE', 'UNANSWERED_STREAK'];

interface Row {
  key: string;
  eventType: WorkflowSubscriptionEventType;
  subscription: WorkflowSubscription | null;
  targetId: string | null;
  threshold: number;
  includeStructuredAnswers: boolean;
}

let rowSeq = 0;
function newBlankRow(eventType: WorkflowSubscriptionEventType): Row {
  rowSeq += 1;
  return { key: `blank-${rowSeq}`, eventType, subscription: null, targetId: null, threshold: 3, includeStructuredAnswers: false };
}

/** WF3 — 챗봇 > 업무 자동화 > 이벤트 구독(`workflow-automation-ui-spec.md` §3.5). */
export function WorkflowSubscriptionsPage(): JSX.Element {
  const { chatbot, workflowAttention } = useChatbotDetailContext();
  const { can } = useAuth();
  const { showToast } = useToast();
  const msg = MESSAGES.workflowSubscriptions;
  const canWrite = can('chatbot:write') && chatbot.status !== 'ARCHIVED';

  const [subscriptions, setSubscriptions] = useState<WorkflowSubscription[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [extraBlankRows, setExtraBlankRows] = useState<Row[]>([]);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const res = await workflowSubscriptionsApi.list(chatbot.id);
      setSubscriptions(res.items);
      setExtraBlankRows([]);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [chatbot.id]);

  useEffect(() => {
    void load();
  }, [load]);

  function rowsFor(eventType: WorkflowSubscriptionEventType): Row[] {
    const existing: Row[] = (subscriptions ?? [])
      .filter((s) => s.eventType === eventType)
      .map((s) => ({
        key: s.id,
        eventType,
        subscription: s,
        targetId: s.targetId,
        threshold: s.conditions.threshold ?? 3,
        includeStructuredAnswers: s.conditions.includeStructuredAnswers ?? false,
      }));
    const blanks = extraBlankRows.filter((r) => r.eventType === eventType);
    if (existing.length === 0 && blanks.length === 0) return [newBlankRow(eventType)];
    return [...existing, ...blanks];
  }

  function buildConditions(row: Row): { threshold?: number; includeStructuredAnswers?: boolean } {
    if (row.eventType === 'UNANSWERED_STREAK') return { threshold: row.threshold };
    if (row.eventType === 'SURVEY_COMPLETED') return { includeStructuredAnswers: row.includeStructuredAnswers };
    return {};
  }

  async function handleTargetChange(row: Row, targetId: string | null): Promise<void> {
    setRowErrors((prev) => ({ ...prev, [row.key]: '' }));
    if (!targetId) return;
    try {
      if (row.subscription) {
        const updated = await workflowSubscriptionsApi.update(chatbot.id, row.subscription.id, { targetId });
        setSubscriptions((prev) => (prev ? prev.map((s) => (s.id === updated.id ? updated : s)) : prev));
      } else {
        await workflowSubscriptionsApi.create(chatbot.id, { eventType: row.eventType, targetId, enabled: true, conditions: buildConditions(row) });
        showToast(msg.saveSuccess);
        void load();
      }
    } catch (e) {
      if (e instanceof ApiError && e.code === 'DUPLICATE_NAME') {
        setRowErrors((prev) => ({ ...prev, [row.key]: msg.duplicateSubscription }));
      } else if (e instanceof ApiError && e.code === 'LIMIT_EXCEEDED') {
        showToast(msg.limitExceeded);
      } else if (e instanceof ApiError && e.code === 'CHATBOT_ARCHIVED') {
        showToast(msg.archivedWriteBlocked);
      } else {
        showToast(e instanceof ApiError ? e.message : MESSAGES.errors.generic);
      }
    }
  }

  async function handleEnabledChange(row: Row, enabled: boolean): Promise<void> {
    if (!row.subscription) return;
    try {
      const updated = await workflowSubscriptionsApi.update(chatbot.id, row.subscription.id, { enabled });
      setSubscriptions((prev) => (prev ? prev.map((s) => (s.id === updated.id ? updated : s)) : prev));
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : MESSAGES.errors.generic);
    }
  }

  async function handlePausedChange(row: Row, paused: boolean): Promise<void> {
    if (!row.subscription) return;
    try {
      const updated = paused
        ? await workflowSubscriptionsApi.pause(chatbot.id, row.subscription.id)
        : await workflowSubscriptionsApi.resume(chatbot.id, row.subscription.id);
      setSubscriptions((prev) => (prev ? prev.map((s) => (s.id === updated.id ? updated : s)) : prev));
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : MESSAGES.errors.generic);
    }
  }

  async function handleConditionChange(row: Row, conditions: { threshold?: number; includeStructuredAnswers?: boolean }): Promise<void> {
    if (!row.subscription) return;
    try {
      const updated = await workflowSubscriptionsApi.update(chatbot.id, row.subscription.id, { conditions });
      setSubscriptions((prev) => (prev ? prev.map((s) => (s.id === updated.id ? updated : s)) : prev));
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : MESSAGES.errors.generic);
    }
  }

  async function handleRemove(row: Row): Promise<void> {
    if (!row.subscription) {
      setExtraBlankRows((prev) => prev.filter((r) => r.key !== row.key));
      return;
    }
    try {
      await workflowSubscriptionsApi.remove(chatbot.id, row.subscription.id);
      void load();
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : MESSAGES.errors.generic);
    }
  }

  if (loading) {
    return (
      <>
        <SkeletonRow />
        <SkeletonRow />
        <SkeletonRow />
        <SkeletonRow />
        <SkeletonRow />
      </>
    );
  }
  if (error) return <ErrorState title={msg.loadFailed} onRetry={load} />;

  return (
    <div className="workflow-subscriptions-page">
      {/* [신규 No.41 2차] WF3 기능 꺼짐 배너 — `ChatbotDetailLayout`이 탭 배지용으로 이미 조회한
          `workflowAttention.featureEnabled`를 재사용한다(추가 호출 없음). 아직 조회 전(null)이면
          렌더하지 않는다 — 잠깐의 깜빡임보다 확정된 값만 보여주는 쪽을 택한다. */}
      {workflowAttention?.featureEnabled === false && (
        <p className="form-banner form-banner--warning" role="status">
          <span aria-hidden="true">ⓘ</span> {MESSAGES.workflowTargets.featureDisabledBanner}
        </p>
      )}
      {/* [No.40] `EnvironmentScopeNotice` 컴포넌트의 role="status" 패턴을 그대로 따르되(무변경 재사용
          대상은 컴포넌트 자체), 이 화면 전용 문구("다른 서버 인스턴스 반영 지연" 포함)는 이 화면이
          직접 렌더한다 — variant를 추가하지 않고 문구 중복도 없앤다. */}
      <p className="environment-scope-notice" role="status">
        <span aria-hidden="true">ⓘ</span> {msg.scopeNotice}
      </p>
      <table className="dialogue-table">
        <thead>
          <tr>
            <th scope="col">{msg.columnEvent}</th>
            <th scope="col">{msg.columnTarget}</th>
            <th scope="col">{msg.columnCondition}</th>
            <th scope="col">{msg.columnEnabled}</th>
            <th scope="col">{msg.columnPaused}</th>
            <th scope="col">{msg.columnActions}</th>
          </tr>
        </thead>
        <tbody>
          {EVENT_TYPES.map((eventType) => {
            const rows = rowsFor(eventType);
            return rows.map((row, i) => (
              <tr key={row.key}>
                <td>{i === 0 ? msg.eventLabel[eventType] : ''}</td>
                <td>
                  <WorkflowTargetPickerField
                    id={`workflow-sub-target-${row.key}`}
                    label={msg.columnTarget}
                    value={row.targetId}
                    onChange={(v) => void handleTargetChange(row, v)}
                    disabled={!canWrite}
                    errorMessage={rowErrors[row.key] || undefined}
                  />
                  {!row.targetId && !row.subscription && <p className="field-hint">{msg.notSubscribed}</p>}
                </td>
                <td>
                  {eventType === 'UNANSWERED_STREAK' && (
                    <div className="form-field">
                      <label htmlFor={`workflow-sub-threshold-${row.key}`}>{msg.conditionThresholdLabel}</label>
                      <input
                        id={`workflow-sub-threshold-${row.key}`}
                        type="number"
                        min={2}
                        max={10}
                        value={row.threshold}
                        disabled={!canWrite}
                        onChange={(e) => void handleConditionChange(row, { threshold: Number(e.target.value) })}
                      />
                    </div>
                  )}
                  {eventType === 'SURVEY_COMPLETED' && (
                    <label className="form-field--inline">
                      <input
                        type="checkbox"
                        checked={row.includeStructuredAnswers}
                        disabled={!canWrite}
                        onChange={(e) => void handleConditionChange(row, { includeStructuredAnswers: e.target.checked })}
                      />
                      {msg.conditionIncludeAnswers}
                    </label>
                  )}
                  {eventType !== 'UNANSWERED_STREAK' && eventType !== 'SURVEY_COMPLETED' && '—'}
                </td>
                <td>
                  <input
                    type="checkbox"
                    aria-label={msg.columnEnabled}
                    checked={row.subscription?.enabled ?? false}
                    disabled={!canWrite || !row.subscription}
                    onChange={(e) => void handleEnabledChange(row, e.target.checked)}
                  />
                </td>
                <td>
                  <input
                    type="checkbox"
                    aria-label={msg.columnPaused}
                    checked={Boolean(row.subscription?.pausedAt)}
                    disabled={!canWrite || !row.subscription}
                    onChange={(e) => void handlePausedChange(row, e.target.checked)}
                  />
                  {row.subscription?.pausedAt && <TargetPausedBadge />}
                </td>
                <td>
                  {canWrite && (row.subscription || row.targetId) && (
                    <button type="button" className="btn btn-secondary" onClick={() => void handleRemove(row)} aria-label={msg.removeRow}>
                      {MESSAGES.common.delete}
                    </button>
                  )}
                </td>
              </tr>
            ));
          })}
        </tbody>
      </table>
      {canWrite && (
        <div className="reorderable-add-row">
          {EVENT_TYPES.map((eventType) => (
            <button
              key={eventType}
              type="button"
              className="btn btn-secondary"
              onClick={() => setExtraBlankRows((prev) => [...prev, newBlankRow(eventType)])}
            >
              {msg.eventLabel[eventType]} {msg.addAnotherTarget}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
