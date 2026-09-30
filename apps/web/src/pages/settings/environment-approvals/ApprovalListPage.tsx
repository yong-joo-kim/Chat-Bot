import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { ProdSwitchApprovalSummary } from '@chat-bot/shared-types';
import { switchApprovalsApi } from '../../../api/switchApprovals';
import { EmptyState } from '../../../components/EmptyState';
import { ErrorState } from '../../../components/ErrorState';
import { GateResultBadge } from '../../../components/GateResultBadge';
import { Pagination } from '../../../components/Pagination';
import { SkeletonRow } from '../../../components/Skeleton';
import { MESSAGES } from '../../../constants/messages';
import { approvalActionLabel, approvalVersionArrow } from '../../../lib/approvalText';
import { useLatestRequest } from '../../../lib/useLatestRequest';
import { useMinuteClock } from '../../../lib/useApprovalPolicy';
import { ApprovalStatusText } from '../../chatbot-detail/environment/approval/ApprovalStatusText';
import { RemainingTimeText } from '../../chatbot-detail/environment/approval/RemainingTimeText';

const PAGE_SIZE = 20;
type ViewMode = 'PENDING' | 'ALL';

function todoText(r: ProdSwitchApprovalSummary): string {
  const m = MESSAGES.switchApproval.list;
  if (r.status !== 'PENDING') return m.todoNone;
  if (r.canApprove) return m.todoApprove;
  if (r.canCancel) return m.todoMine;
  return m.todoNone;
}

/** AP-1 운영 전환 승인 대기 목록(`ai-guardrails-ui-spec.md` §9.8). 목록에서 바로 승인하지 않고 반드시 상세에서 다시 확인한다. */
export function ApprovalListPage(): JSX.Element {
  const m = MESSAGES.switchApproval.list;
  const now = useMinuteClock();
  const [draftView, setDraftView] = useState<ViewMode>('PENDING');
  const [view, setView] = useState<ViewMode>('PENDING');
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<ProdSwitchApprovalSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const guard = useLatestRequest();

  const load = useCallback(async () => {
    const reqId = guard.next();
    setLoading(true);
    setError(false);
    try {
      const res = await switchApprovalsApi.listGlobal({ status: view, page, pageSize: PAGE_SIZE });
      if (guard.isStale(reqId)) return;
      setItems(res.items);
      setTotal(res.total);
    } catch {
      if (guard.isStale(reqId)) return;
      setError(true);
    } finally {
      if (!guard.isStale(reqId)) setLoading(false);
    }
  }, [view, page, guard]);

  useEffect(() => {
    void load();
  }, [load]);

  const detailHref = (r: ProdSwitchApprovalSummary): string => `/environment-approvals/${r.chatbotId}/${r.id}`;

  return (
    <div className="settings-page approval-list-page" aria-busy={loading}>
      <div className="version-list-header">
        <h1>{m.title}</h1>
        <button type="button" className="btn btn-secondary" onClick={() => void load()} disabled={loading}>
          {m.refresh}
        </button>
      </div>
      <p className="field-hint">
        <span aria-hidden="true">ⓘ</span> {m.intro}
      </p>

      <form
        className="approval-list-view"
        onSubmit={(e) => {
          e.preventDefault();
          setPage(1);
          setView(draftView);
        }}
      >
        <fieldset className="period-selector">
          <legend>{m.viewLegend}</legend>
          <label className="period-radio">
            <input type="radio" name="approval-view" checked={draftView === 'PENDING'} onChange={() => setDraftView('PENDING')} /> {m.viewPending}
          </label>
          <label className="period-radio">
            <input type="radio" name="approval-view" checked={draftView === 'ALL'} onChange={() => setDraftView('ALL')} /> {m.viewAll}
          </label>
          <button type="submit" className="btn btn-secondary">
            {m.apply}
          </button>
        </fieldset>
      </form>

      <p role="status" className="sr-only">
        {!loading && !error ? m.resultCount(total) : ''}
      </p>

      {loading ? (
        <div>
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
        </div>
      ) : error ? (
        <ErrorState title={m.loadFailed} onRetry={() => void load()} />
      ) : items.length === 0 ? (
        <EmptyState title={view === 'PENDING' ? m.emptyPending : m.emptyAll} />
      ) : (
        <>
          <table className="dialogue-table desktop-only">
            <caption>{m.caption}</caption>
            <thead>
              <tr>
                <th scope="col">{m.columns.chatbot}</th>
                <th scope="col">{m.columns.action}</th>
                <th scope="col">{m.columns.target}</th>
                <th scope="col">{m.columns.requester}</th>
                <th scope="col">{m.columns.gate}</th>
                <th scope="col">{m.columns.warnings}</th>
                <th scope="col">{m.columns.remaining}</th>
                <th scope="col">{m.columns.status}</th>
                <th scope="col">{m.columns.todo}</th>
                <th scope="col">
                  <span className="sr-only">{m.columns.operations}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((r) => (
                <tr key={r.id}>
                  <td className="guardrail-break">
                    <Link to={`/chatbots/${r.chatbotId}/environment`}>{r.chatbotName}</Link>
                  </td>
                  <td>{approvalActionLabel(r)}</td>
                  <td>{approvalVersionArrow(r)}</td>
                  <td className="guardrail-break">{r.requestedBy.email}</td>
                  <td>
                    <GateResultBadge gate={{ verdict: r.gateVerdict, run: null }} showReason={false} />
                  </td>
                  <td>{m.warningsCount(r.warningCodes.length)}</td>
                  <td>{r.status === 'PENDING' ? <RemainingTimeText expiresAt={r.expiresAt} now={now} short /> : '—'}</td>
                  <td>
                    <ApprovalStatusText request={r} />
                  </td>
                  <td>{todoText(r)}</td>
                  <td>
                    <Link to={detailHref(r)} aria-label={m.detailLinkLabel(r.chatbotName)}>
                      {m.detailLink}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <ul className="settings-card-list mobile-only">
            {items.map((r) => (
              <li key={r.id} className="settings-card">
                <div className="settings-card-header">
                  <span className="settings-card-title guardrail-break">{r.chatbotName}</span>
                </div>
                <dl className="settings-card-fields">
                  <div>
                    <dt>{m.columns.action}</dt>
                    <dd>{approvalActionLabel(r)}</dd>
                  </div>
                  <div>
                    <dt>{m.columns.target}</dt>
                    <dd>{approvalVersionArrow(r)}</dd>
                  </div>
                  <div>
                    <dt>{m.columns.requester}</dt>
                    <dd className="guardrail-break">{r.requestedBy.email}</dd>
                  </div>
                  <div>
                    <dt>{m.columns.gate}</dt>
                    <dd>
                      <GateResultBadge gate={{ verdict: r.gateVerdict, run: null }} showReason={false} />
                    </dd>
                  </div>
                  <div>
                    <dt>{m.columns.warnings}</dt>
                    <dd>{m.warningsCount(r.warningCodes.length)}</dd>
                  </div>
                  <div>
                    <dt>{m.columns.remaining}</dt>
                    <dd>{r.status === 'PENDING' ? <RemainingTimeText expiresAt={r.expiresAt} now={now} short /> : '—'}</dd>
                  </div>
                  <div>
                    <dt>{m.columns.status}</dt>
                    <dd>
                      <ApprovalStatusText request={r} />
                    </dd>
                  </div>
                  <div>
                    <dt>{m.columns.todo}</dt>
                    <dd>{todoText(r)}</dd>
                  </div>
                </dl>
                <div className="settings-card-actions">
                  <Link to={detailHref(r)} aria-label={m.detailLinkLabel(r.chatbotName)}>
                    {m.detailLink}
                  </Link>
                </div>
              </li>
            ))}
          </ul>
          <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} />
        </>
      )}
    </div>
  );
}
