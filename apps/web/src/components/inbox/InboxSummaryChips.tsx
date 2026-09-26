import type { InboxSummaryResponse } from '@chat-bot/shared-types';
import { MESSAGES } from '../../constants/messages';

export interface InboxSummaryFilterState {
  status: Array<'OPEN' | 'PENDING' | 'CLOSED'>;
  assignee?: 'ME' | 'NONE' | string;
  activeHandoff: boolean;
}

/**
 * OI-1 요약 칩 5개(`omnichannel-inbox-ui-spec.md` §2.3 `InboxSummaryChips`) — `LiveSessionTable`의
 * `SessionSummaryBar` 패턴 확장판. 클릭 시 목록 필터에 반영한다.
 */
export function InboxSummaryChips({
  summary,
  onFilter,
}: {
  summary: InboxSummaryResponse;
  onFilter: (patch: Partial<InboxSummaryFilterState>) => void;
}): JSX.Element {
  const msg = MESSAGES.inbox;
  return (
    <div className="session-summary-bar" role="group" aria-label={msg.title}>
      <button type="button" className="btn btn-secondary" onClick={() => onFilter({ status: ['OPEN'] })}>
        {msg.summaryOpen} {summary.open}
      </button>
      <button type="button" className="btn btn-secondary" onClick={() => onFilter({ status: ['PENDING'] })}>
        {msg.summaryPending} {summary.pending}
      </button>
      <button type="button" className="btn btn-secondary" onClick={() => onFilter({ assignee: 'ME' })}>
        {msg.summaryMine} {summary.mine}
      </button>
      <button type="button" className="btn btn-secondary" onClick={() => onFilter({ assignee: 'NONE' })}>
        {msg.summaryUnassigned} {summary.unassigned}
      </button>
      <button type="button" className="btn btn-secondary" onClick={() => onFilter({ activeHandoff: true })}>
        {msg.summaryActiveHandoff} {summary.activeHandoff}
      </button>
    </div>
  );
}
