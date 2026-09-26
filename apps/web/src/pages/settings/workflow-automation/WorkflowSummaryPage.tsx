import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { WorkflowSummaryResponse } from '@chat-bot/shared-types';
import { workflowRunsApi } from '../../../api/workflowRuns';
import { ErrorState } from '../../../components/ErrorState';
import { SkeletonRow } from '../../../components/Skeleton';
import { MESSAGES } from '../../../constants/messages';

/**
 * [코드리뷰 R1 M-1] "확인 필요" 각 줄의 이동 대상(ui-spec §3.3 — "클릭 시 해당 조건으로 필터링된
 * §3.1(대상)·§3.2(이력) 화면으로 이동"). 요약 응답은 대상 이름이 아니라 건수만 주므로, 대상 목록
 * 화면이 이미 갖고 있는 필드(연속 실패 횟수·시크릿 상태)로 같은 조건을 재현하는 마커만 싣는다.
 */
const ATTENTION_HREF: Record<string, string> = {
  failingTargets: '/settings/workflow-automation/targets?attention=consecutiveFailures',
  secretMissingTargets: '/settings/workflow-automation/targets?attention=secretMissing',
  failedRetained: '/settings/workflow-automation/runs?status=FAILED&retryableOnly=true',
  oldestPending: '/settings/workflow-automation/runs?status=PENDING,HELD',
  // 적재 실패(enqueueFailures24h)는 발송함 행 자체가 만들어지지 않아 실행 이력에 나타나지 않는다 —
  // 필터링할 대상이 없어 이력 화면으로만 이동한다(§3.3, "이동" 자체는 여전히 유효).
  enqueueFailures: '/settings/workflow-automation/runs',
};

/** WF1-c — 요약 통계(전역, `/settings/workflow-automation/summary`, ui-spec §3.3). */
export function WorkflowSummaryPage(): JSX.Element {
  const msg = MESSAGES.workflowSummary;
  const [days, setDays] = useState<7 | 30>(7);
  const [data, setData] = useState<WorkflowSummaryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError(false);
    workflowRunsApi
      .summary(days)
      .then(setData)
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [days]);

  useEffect(() => {
    load();
  }, [load]);

  const attentionRows: { key: string; text: string }[] = [];
  if (data) {
    if (data.attention.failingTargets > 0) attentionRows.push({ key: 'failingTargets', text: msg.attentionFailingTargets(data.attention.failingTargets) });
    if (data.attention.failedRetained > 0) attentionRows.push({ key: 'failedRetained', text: msg.attentionFailedRetained(data.attention.failedRetained) });
    if (data.attention.secretMissingTargets > 0)
      attentionRows.push({ key: 'secretMissingTargets', text: msg.attentionSecretMissing(data.attention.secretMissingTargets) });
    if (data.attention.oldestPendingMinutes !== null)
      attentionRows.push({ key: 'oldestPending', text: msg.attentionOldestPending(data.attention.oldestPendingMinutes) });
    if (data.attention.enqueueFailures24h > 0)
      attentionRows.push({ key: 'enqueueFailures', text: msg.attentionEnqueueFailures(data.attention.enqueueFailures24h) });
  }

  return (
    <div className="workflow-summary-page">
      <div className="dialogue-toolbar">
        <fieldset className="form-field">
          <legend>{MESSAGES.workflowTargets.tabSummary}</legend>
          <label className="form-field--inline">
            <input type="radio" name="workflow-summary-period" checked={days === 7} onChange={() => setDays(7)} />
            {msg.periodLabel7}
          </label>
          <label className="form-field--inline">
            <input type="radio" name="workflow-summary-period" checked={days === 30} onChange={() => setDays(30)} />
            {msg.periodLabel30}
          </label>
        </fieldset>
      </div>

      {loading && (
        <>
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
        </>
      )}
      {!loading && error && <ErrorState title={msg.loadFailed} onRetry={load} />}
      {!loading && !error && data && (
        <>
          <div className="dashboard-cards stats-metric-row">
            <div className="settings-card">
              <p className="field-label-static">{msg.totalsOccurred}</p>
              <p>{data.totals.occurred}</p>
            </div>
            <div className="settings-card">
              <p className="field-label-static">{msg.totalsSucceeded}</p>
              <p>
                {data.totals.succeeded}
                {data.totals.occurred > 0 && ` (${Math.round((data.totals.succeeded / data.totals.occurred) * 1000) / 10}%)`}
              </p>
            </div>
            <div className="settings-card">
              <p className="field-label-static">{msg.totalsFailed}</p>
              <p>{data.totals.failed}</p>
            </div>
            <div className="settings-card">
              <p className="field-label-static">{msg.totalsSkipped}</p>
              <p>{data.totals.skipped}</p>
            </div>
            <div className="settings-card">
              <p className="field-label-static">{msg.retryRateLabel}</p>
              <p>{Math.round(data.retryRate * 1000) / 10}%</p>
            </div>
            <div className="settings-card">
              <p className="field-label-static">{msg.p95Label}</p>
              <p>
                {data.p95DeliveryMs !== null ? `${data.p95DeliveryMs}ms` : '—'}
                {data.approximated && (
                  <span title={msg.approximatedTooltip}> {msg.approximatedSuffix}</span>
                )}
              </p>
            </div>
          </div>

          <section className="settings-card">
            <h2>{msg.attentionTitle}</h2>
            {attentionRows.length === 0 && <p>{msg.attentionNone}</p>}
            {attentionRows.length > 0 && (
              <ul>
                {attentionRows.map((row) => (
                  <li key={row.key}>
                    <Link to={ATTENTION_HREF[row.key] ?? '/settings/workflow-automation/runs'} className="btn btn-secondary">
                      {row.text}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="settings-card">
            <h2>{msg.byTargetTitle}</h2>
            <ul>
              {data.byTarget.map((t) => (
                <li key={t.targetId}>
                  {t.targetName} 발생{t.succeeded + t.failed} 성공{t.succeeded} 실패{t.failed}
                </li>
              ))}
            </ul>
          </section>

          <section className="settings-card">
            <h2>{msg.byEventTitle}</h2>
            <ul>
              {data.byEvent.map((e) => (
                <li key={e.eventType}>
                  {MESSAGES.workflowRuns.eventTypeLabel[e.eventType]} 발생{e.succeeded + e.failed}
                </li>
              ))}
            </ul>
          </section>

          <section className="settings-card">
            <h2>{msg.dailyTrendTitle}</h2>
            <ul>
              {data.daily.map((d) => (
                <li key={d.dayBucket}>
                  {d.dayBucket} 성공{d.succeeded} 실패{d.failed} 건너뜀{d.skipped}
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
