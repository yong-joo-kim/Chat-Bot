import type { ProdSwitchApprovalSummary } from '@chat-bot/shared-types';
import { MESSAGES } from '../../../../constants/messages';
import { formatDateTime } from '../../../../lib/date';
import { approvalActionLabel, approvalVersionArrow } from '../../../../lib/approvalText';
import { ApprovalStatusText } from './ApprovalStatusText';

/** 최근 승인 요청 20건 — 표(데스크톱) + 카드(640px 미만). 없으면 "아직 승인 요청이 없습니다." */
export function ApprovalRecentTable({ items }: { items: ProdSwitchApprovalSummary[] }): JSX.Element {
  const m = MESSAGES.switchApproval.policy;
  if (items.length === 0) return <p className="field-hint">{m.recentEmpty}</p>;
  return (
    <>
      <table className="dialogue-table desktop-only approval-recent-table">
        <caption>{m.recentCaption}</caption>
        <thead>
          <tr>
            <th scope="col">{m.recentColumns.at}</th>
            <th scope="col">{m.recentColumns.action}</th>
            <th scope="col">{m.recentColumns.target}</th>
            <th scope="col">{m.recentColumns.requester}</th>
            <th scope="col">{m.recentColumns.result}</th>
            <th scope="col">{m.recentColumns.decider}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((r) => (
            <tr key={r.id}>
              <td>{formatDateTime(r.createdAt)}</td>
              <td>{approvalActionLabel(r)}</td>
              <td>{approvalVersionArrow(r)}</td>
              <td className="guardrail-break">{r.requestedBy.email}</td>
              <td>
                <ApprovalStatusText request={r} />
              </td>
              <td className="guardrail-break">{r.decidedBy?.email ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <ul className="settings-card-list mobile-only">
        {items.map((r) => (
          <li key={r.id} className="settings-card">
            <div className="settings-card-header">
              <span className="settings-card-title">{formatDateTime(r.createdAt)}</span>
            </div>
            <dl className="settings-card-fields">
              <div>
                <dt>{m.recentColumns.action}</dt>
                <dd>{approvalActionLabel(r)}</dd>
              </div>
              <div>
                <dt>{m.recentColumns.target}</dt>
                <dd>{approvalVersionArrow(r)}</dd>
              </div>
              <div>
                <dt>{m.recentColumns.requester}</dt>
                <dd className="guardrail-break">{r.requestedBy.email}</dd>
              </div>
              <div>
                <dt>{m.recentColumns.result}</dt>
                <dd>
                  <ApprovalStatusText request={r} />
                </dd>
              </div>
              <div>
                <dt>{m.recentColumns.decider}</dt>
                <dd className="guardrail-break">{r.decidedBy?.email ?? '—'}</dd>
              </div>
            </dl>
          </li>
        ))}
      </ul>
    </>
  );
}
