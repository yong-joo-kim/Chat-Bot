import { Fragment } from 'react';
import type { WorkflowRunItem } from '@chat-bot/shared-types';
import { formatDateTime } from '../../../lib/date';
import { MESSAGES } from '../../../constants/messages';
import { CopyButton } from '../../../components/CopyButton';
import { WorkflowOutcomeBadge, WorkflowRunStatusBadge } from './badges';

export interface WorkflowRunTableProps {
  items: WorkflowRunItem[];
  showChatbotColumn?: boolean;
  expandedId: string | null;
  onToggleExpand: (id: string) => void;
  selectable?: boolean;
  selectedIds?: string[];
  onSelectionChange?: (ids: string[]) => void;
  chatbotNameOf?: (chatbotId: string | null) => string;
}

function triggerLabel(item: WorkflowRunItem): string {
  const msg = MESSAGES.workflowRuns;
  if (item.triggerKind === 'NODE') return msg.triggerNode(item.actionKey ?? '');
  return msg.eventTypeLabel[item.eventType];
}

function isSelectable(item: WorkflowRunItem): boolean {
  return item.status === 'PENDING' || item.status === 'HELD' || item.status === 'FAILED';
}

/** WF1-b/WF3-b 공용 실행 이력 표(§3.2 `WorkflowRunTable`) — 선택 체크박스 열은 챗봇 스코프에서만 켠다. */
export function WorkflowRunTable({
  items,
  showChatbotColumn = false,
  expandedId,
  onToggleExpand,
  selectable = false,
  selectedIds = [],
  onSelectionChange,
  chatbotNameOf,
}: WorkflowRunTableProps): JSX.Element {
  const msg = MESSAGES.workflowRuns;

  function toggleSelect(id: string): void {
    if (!onSelectionChange) return;
    onSelectionChange(selectedIds.includes(id) ? selectedIds.filter((x) => x !== id) : [...selectedIds, id]);
  }

  return (
    <table className="dialogue-table">
      <caption className="sr-only">{`${msg.pageTitle} — 총 ${items.length}건`}</caption>
      <thead>
        <tr>
          {selectable && <th scope="col" aria-label="선택" />}
          <th scope="col">{msg.columnOccurredAt}</th>
          {showChatbotColumn && <th scope="col">{msg.columnChatbot}</th>}
          <th scope="col">{msg.columnTrigger}</th>
          <th scope="col">{msg.columnTarget}</th>
          <th scope="col">{msg.columnStatus}</th>
          <th scope="col">{msg.columnAttempts}</th>
          <th scope="col">{msg.columnOutcome}</th>
          <th scope="col">{msg.columnLatency}</th>
        </tr>
      </thead>
      <tbody>
        {items.map((item) => (
          <Fragment key={item.id}>
            <tr
              className="workflow-run-row"
              onClick={() => onToggleExpand(item.id)}
              aria-expanded={expandedId === item.id}
            >
              {selectable && (
                <td onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    aria-label={`${item.id} 선택`}
                    checked={selectedIds.includes(item.id)}
                    disabled={!isSelectable(item)}
                    onChange={() => toggleSelect(item.id)}
                  />
                </td>
              )}
              <td>{formatDateTime(item.createdAt)}</td>
              {showChatbotColumn && <td>{chatbotNameOf ? chatbotNameOf(item.chatbotId) : item.chatbotId ?? '—'}</td>}
              <td>{triggerLabel(item)}</td>
              <td>{item.targetName}</td>
              <td>
                <WorkflowRunStatusBadge status={item.status} />
              </td>
              <td>{item.attemptCount}</td>
              <td>{item.lastOutcome ? <WorkflowOutcomeBadge outcome={item.lastOutcome} /> : '—'}</td>
              <td>{item.lastLatencyMs !== null ? `${item.lastLatencyMs}ms` : '—'}</td>
            </tr>
            {expandedId === item.id && (
              <tr className="workflow-run-detail-row">
                <td colSpan={selectable ? 8 : 7}>
                  <WorkflowRunInlineDetail item={item} />
                </td>
              </tr>
            )}
          </Fragment>
        ))}
      </tbody>
    </table>
  );
}

function WorkflowRunInlineDetail({ item }: { item: WorkflowRunItem }): JSX.Element {
  const msg = MESSAGES.workflowRuns;
  return (
    <div className="workflow-run-detail-panel">
      <p>
        {msg.detailOccurred}: {formatDateTime(item.createdAt)}
        {item.sessionRef && ` · ${msg.detailSessionRef}: ${item.sessionRef}`}
      </p>
      <p>
        {msg.detailTrigger}: {triggerLabel(item)}
      </p>
      <p>
        {msg.detailTarget}: {item.targetName}
      </p>
      <p>
        {msg.detailFieldsLabel}: {item.fieldNames.length > 0 ? item.fieldNames.join(', ') : '—'}({msg.detailFieldsValueHidden})
      </p>
      <p>{item.personalDataMasked ? msg.detailPersonalDataMasked : msg.detailPersonalDataRaw}</p>
      <p>
        {msg.detailStatus}: <WorkflowRunStatusBadge status={item.status} /> · {msg.detailAttempt(item.attemptCount)}
        {item.lastOutcome && (
          <>
            {' '}
            · {msg.detailLastResult}: <WorkflowOutcomeBadge outcome={item.lastOutcome} />
            {item.lastHttpStatus ? `(${item.lastHttpStatus})` : ''}
          </>
        )}
        {item.lastLatencyMs !== null && ` · ${item.lastLatencyMs}ms`}
      </p>
      <p>
        {msg.detailNextAttempt}: {item.nextAttemptAt ? formatDateTime(item.nextAttemptAt) : msg.detailNextAttemptNone}
      </p>
      {item.statusReason === 'DECRYPT_FAILED' && (
        <p className="field-hint field-hint--warning">
          <span aria-hidden="true">⚠</span> {msg.detailDecryptFailed}
        </p>
      )}
      {item.payloadPurged && (
        <p className="field-hint">
          <span aria-hidden="true">🗑</span> {msg.detailPayloadPurged} {msg.detailPayloadPurgedNotRetryable}
        </p>
      )}
      <p>
        {msg.deliveryIdLabel}: {item.id.slice(0, 8)}… <CopyButton text={item.id} />
      </p>
    </div>
  );
}
