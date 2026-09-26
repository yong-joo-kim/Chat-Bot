import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { CustomerKind, InboxSourceFamily, InboxThreadStatus } from '@chat-bot/shared-types';
import { MESSAGES } from '../../constants/messages';

export interface InboxFilterState {
  status: InboxThreadStatus[];
  assignee?: 'ME' | 'NONE' | string;
  chatbotIds: string[];
  channelFamily: InboxSourceFamily[];
  tagIds: string[];
  customerKinds: CustomerKind[];
  includeTest: boolean;
  activeHandoff: boolean;
  from?: string;
  to?: string;
  q?: string;
}

export const DEFAULT_INBOX_FILTER: InboxFilterState = {
  status: ['OPEN', 'PENDING'],
  chatbotIds: [],
  channelFamily: [],
  tagIds: [],
  customerKinds: [],
  includeTest: false,
  activeHandoff: false,
};

const STATUS_OPTIONS: InboxThreadStatus[] = ['OPEN', 'PENDING', 'CLOSED'];
const CHANNEL_FAMILY_OPTIONS: InboxSourceFamily[] = ['DEPLOY', 'RECORD', 'SIMULATED'];
const CUSTOMER_KIND_OPTIONS: CustomerKind[] = ['IDENTIFIED', 'ANONYMOUS', 'TEST'];

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

/**
 * OI-1 필터바(`omnichannel-inbox-ui-spec.md` §2.3 `InboxFilterBar`) — 라벨 있는 컨트롤(체크박스 그룹·
 * 셀렉트). 모바일에서는 접이식으로 전환한다(§9).
 */
export function InboxFilterBar({
  value,
  onChange,
  participatingChatbots,
  tags,
  canManageTags,
}: {
  value: InboxFilterState;
  onChange: (patch: Partial<InboxFilterState>) => void;
  participatingChatbots: Array<{ id: string; name: string }>;
  tags: Array<{ id: string; name: string }>;
  canManageTags: boolean;
}): JSX.Element {
  const msg = MESSAGES.inbox;
  const [expanded, setExpanded] = useState(false);
  const [searchDraft, setSearchDraft] = useState(value.q ?? '');

  const statusLabels: Record<InboxThreadStatus, string> = { OPEN: msg.statusOpenOption, PENDING: msg.statusPendingOption, CLOSED: msg.statusClosedOption };
  const channelLabels: Record<InboxSourceFamily, string> = { DEPLOY: msg.filterChannelDeploy, RECORD: msg.filterChannelRecord, SIMULATED: msg.filterChannelSimulated };
  const kindLabels: Record<CustomerKind, string> = { IDENTIFIED: msg.filterKindIdentified, ANONYMOUS: msg.filterKindAnonymous, TEST: msg.filterKindTest };

  return (
    <div className="inbox-filter-bar">
      <button type="button" className="btn btn-secondary inbox-filter-toggle" onClick={() => setExpanded((e) => !e)} aria-expanded={expanded}>
        {expanded ? msg.filterCollapseButton : msg.filterExpandButton}
      </button>
      <div className={`inbox-filter-fields${expanded ? ' inbox-filter-fields--expanded' : ''}`}>
        <fieldset className="form-field">
          <legend>{msg.filterStatusLabel}</legend>
          {STATUS_OPTIONS.map((s) => (
            <label key={s}>
              <input type="checkbox" checked={value.status.includes(s)} onChange={() => onChange({ status: toggle(value.status, s) })} /> {statusLabels[s]}
            </label>
          ))}
        </fieldset>

        <div className="form-field">
          <label htmlFor="inbox-filter-assignee">{msg.filterAssigneeLabel}</label>
          <select id="inbox-filter-assignee" value={value.assignee ?? ''} onChange={(e) => onChange({ assignee: e.target.value || undefined })}>
            <option value="">{msg.filterAssigneeAll}</option>
            <option value="ME">{msg.filterAssigneeMe}</option>
            <option value="NONE">{msg.filterAssigneeNone}</option>
          </select>
        </div>

        <div className="form-field">
          <label htmlFor="inbox-filter-chatbot">{msg.filterChatbotLabel}</label>
          <select
            id="inbox-filter-chatbot"
            multiple
            value={value.chatbotIds}
            onChange={(e) => onChange({ chatbotIds: Array.from(e.target.selectedOptions).map((o) => o.value) })}
          >
            {participatingChatbots.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        <fieldset className="form-field">
          <legend>{msg.filterChannelLabel}</legend>
          {CHANNEL_FAMILY_OPTIONS.map((c) => (
            <label key={c}>
              <input type="checkbox" checked={value.channelFamily.includes(c)} onChange={() => onChange({ channelFamily: toggle(value.channelFamily, c) })} /> {channelLabels[c]}
            </label>
          ))}
        </fieldset>

        <fieldset className="form-field">
          <legend>{msg.filterTagLabel}</legend>
          {tags.length === 0 && <span className="field-hint">—</span>}
          {tags.map((t) => (
            <label key={t.id}>
              <input type="checkbox" checked={value.tagIds.includes(t.id)} onChange={() => onChange({ tagIds: toggle(value.tagIds, t.id) })} /> {t.name}
            </label>
          ))}
        </fieldset>

        <fieldset className="form-field">
          <legend>{msg.filterKindLabel}</legend>
          {CUSTOMER_KIND_OPTIONS.map((k) => (
            <label key={k}>
              <input type="checkbox" checked={value.customerKinds.includes(k)} onChange={() => onChange({ customerKinds: toggle(value.customerKinds, k) })} /> {kindLabels[k]}
            </label>
          ))}
        </fieldset>

        <div className="form-field form-field--inline">
          <label htmlFor="inbox-filter-from">{msg.filterPeriodLabel}</label>
          <input id="inbox-filter-from" type="date" value={value.from ?? ''} onChange={(e) => onChange({ from: e.target.value || undefined })} />
          <span aria-hidden="true">~</span>
          <input aria-label={msg.filterPeriodLabel} type="date" value={value.to ?? ''} onChange={(e) => onChange({ to: e.target.value || undefined })} />
        </div>

        <label className="form-field">
          <input type="checkbox" checked={value.includeTest} onChange={(e) => onChange({ includeTest: e.target.checked })} /> {msg.filterIncludeTest}
        </label>

        <label className="form-field">
          <input type="checkbox" checked={value.activeHandoff} onChange={(e) => onChange({ activeHandoff: e.target.checked })} /> {msg.filterActiveHandoffLabel}
        </label>

        <form
          className="form-field"
          onSubmit={(e) => {
            e.preventDefault();
            onChange({ q: searchDraft || undefined });
          }}
        >
          <label htmlFor="inbox-filter-search">{msg.searchPlaceholder}</label>
          <input id="inbox-filter-search" type="text" value={searchDraft} onChange={(e) => setSearchDraft(e.target.value)} placeholder={msg.searchPlaceholder} />
          <button type="submit" className="btn btn-secondary" aria-label={msg.searchPlaceholder}>
            🔍
          </button>
        </form>

        {canManageTags && (
          <Link to="/inbox/tags" className="field-hint">
            {msg.tagManageLink}
          </Link>
        )}
      </div>
    </div>
  );
}
