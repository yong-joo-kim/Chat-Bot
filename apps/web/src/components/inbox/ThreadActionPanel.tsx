import { useState } from 'react';
import type { CustomerLinkSource, InboxAssigneeItem, InboxThreadDetail, InboxThreadStatus } from '@chat-bot/shared-types';
import { MESSAGES } from '../../constants/messages';
import { kstTodayDateInputValue, addDaysToDateInputValue } from '../../lib/date';
import { InlineFieldError } from '../InlineFieldError';
import { TagPickerField } from './TagPickerField';

export interface LinkedConversationRow {
  /** `CustomerLink.id` — `DELETE /inbox/customers/:customerId/links/:linkId` 호출 대상(2026-09-26 계약 보강). */
  linkId: string;
  chatbotName: string;
  channelLabel: string;
  source: CustomerLinkSource;
  sessionRef: string;
}

const SOURCE_LABEL: Record<CustomerLinkSource, string> = {
  IDENTITY: '자동-식별',
  MANUAL: '수동',
  SYSTEM: '시스템',
};

/** OI-2 동작 패널(`omnichannel-inbox-ui-spec.md` §2.3 `ThreadActionPanel`). */
export function ThreadActionPanel({
  detail,
  assignees,
  allTags,
  isAdmin,
  isMine,
  canWrite,
  canManageTags,
  linkedConversations,
  onStatusChange,
  onClaim,
  onAssign,
  onRelease,
  onSetTags,
  onOpenNote,
  onOpenRecord,
  onOpenLinkForm,
  onOpenMerge,
  onUnlink,
  snoozeError,
}: {
  detail: InboxThreadDetail;
  assignees: InboxAssigneeItem[];
  allTags: Array<{ id: string; name: string; color: string }>;
  isAdmin: boolean;
  isMine: boolean;
  canWrite: boolean;
  canManageTags: boolean;
  linkedConversations: LinkedConversationRow[];
  onStatusChange: (status: InboxThreadStatus, snoozeUntil?: string) => void;
  onClaim: () => void;
  onAssign: (userId: string) => void;
  onRelease: () => void;
  onSetTags: (tagIds: string[]) => void;
  onOpenNote: () => void;
  onOpenRecord: () => void;
  onOpenLinkForm: () => void;
  onOpenMerge: () => void;
  onUnlink: (linkId: string, source: CustomerLinkSource) => void;
  snoozeError?: string;
}): JSX.Element {
  const msg = MESSAGES.inbox;
  const { thread } = detail;
  const [snoozeUntil, setSnoozeUntil] = useState('');

  const canRelease = canWrite && (isMine || isAdmin);
  const isTestCustomer = detail.thread.customer.kind === 'TEST';
  const canMerge = detail.thread.customer.kind !== 'IDENTIFIED';

  return (
    <section className="settings-card thread-action-panel">
      <h3>{msg.actionsTitle}</h3>

      <div className="form-field">
        <label htmlFor="thread-status-select">{msg.statusLabel}</label>
        <select
          id="thread-status-select"
          value={thread.status}
          disabled={!canWrite}
          onChange={(e) => {
            const next = e.target.value as InboxThreadStatus;
            onStatusChange(next, next === 'PENDING' ? snoozeUntil || undefined : undefined);
          }}
        >
          <option value="OPEN">{msg.statusOpenOption}</option>
          <option value="PENDING">{msg.statusPendingOption}</option>
          <option value="CLOSED">{msg.statusClosedOption}</option>
        </select>
        {thread.status === 'PENDING' && (
          <>
            <label htmlFor="thread-snooze-until">{msg.snoozeUntilLabel}</label>
            <input
              id="thread-snooze-until"
              type="date"
              min={kstTodayDateInputValue()}
              max={addDaysToDateInputValue(kstTodayDateInputValue(), 30)}
              value={snoozeUntil}
              disabled={!canWrite}
              onChange={(e) => setSnoozeUntil(e.target.value)}
              aria-describedby="thread-snooze-hint"
            />
            <span id="thread-snooze-hint" className="field-hint">
              {msg.snoozeUntilHint}
            </span>
            <InlineFieldError id="thread-snooze-error" message={snoozeError} />
          </>
        )}
      </div>

      <div className="form-field">
        <span className="field-label-static">{msg.assignLabel}</span>{' '}
        {thread.assignee ? (
          <span>
            {thread.assignee.name}
            {!thread.assignee.active && ` (${msg.assigneeInactiveBadge})`}
          </span>
        ) : (
          <span>{msg.assigneeNone}</span>
        )}
        {canWrite && !thread.assignee && (
          <button type="button" className="btn btn-primary" onClick={onClaim}>
            {msg.claimButton}
          </button>
        )}
        {canWrite && (
          <>
            <label htmlFor="thread-assign-select" className="sr-only">
              {msg.assignLabel}
            </label>
            <select id="thread-assign-select" defaultValue="" onChange={(e) => e.target.value && onAssign(e.target.value)}>
              <option value="">{msg.filterAssigneeAll}</option>
              {assignees.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onRelease}
              disabled={!canRelease}
              title={!canRelease ? msg.releaseDisabledReason : undefined}
            >
              {msg.releaseButton}
            </button>
            {!canRelease && <p className="field-hint">{msg.releaseDisabledReason}</p>}
          </>
        )}
      </div>

      <TagPickerField
        selected={thread.tags}
        allTags={allTags}
        readOnly={!canWrite}
        canManageTags={canManageTags}
        onChange={onSetTags}
      />

      {canWrite && !isTestCustomer && (
        <div className="form-actions">
          <button type="button" className="btn btn-secondary" onClick={onOpenNote}>
            {msg.addNoteButton}
          </button>
          <button type="button" className="btn btn-secondary" onClick={onOpenRecord}>
            {msg.addRecordButton}
          </button>
        </div>
      )}

      {canWrite && (
        <div className="form-actions">
          <button type="button" className="btn btn-secondary" onClick={onOpenLinkForm}>
            {msg.linkOtherConversationButton}
          </button>
          {canMerge && (
            <button type="button" className="btn btn-secondary" onClick={onOpenMerge}>
              {msg.mergeButton}
            </button>
          )}
        </div>
      )}

      <h4>{msg.linkedConversationsTitle}</h4>
      <ul>
        {linkedConversations.map((row) => (
          <li key={row.linkId}>
            {row.chatbotName} / {row.channelLabel} ({SOURCE_LABEL[row.source]})
            {row.source === 'IDENTITY' ? (
              isAdmin ? (
                canWrite && (
                  <button type="button" className="btn btn-secondary" onClick={() => onUnlink(row.linkId, row.source)}>
                    {msg.unlinkButton}
                  </button>
                )
              ) : (
                <span className="field-hint">
                  <span aria-hidden="true">🔒</span> {msg.unlinkDisabledReasonNonAdmin}
                </span>
              )
            ) : (
              canWrite && (
                <button type="button" className="btn btn-secondary" onClick={() => onUnlink(row.linkId, row.source)}>
                  {msg.unlinkButton}
                </button>
              )
            )}
          </li>
        ))}
      </ul>

      {detail.activeHandoffs.length > 0 && (
        <>
          <h4>{msg.activeHandoffsTitle}</h4>
          <ul>
            {detail.activeHandoffs.map((h) => (
              <li key={h.handoffId}>
                <a href={`/handoff-console/${h.chatbotId}/live/${h.sessionRef}`}>
                  {h.chatbotName} · {h.agentName} — {msg.goToConsole}
                </a>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
