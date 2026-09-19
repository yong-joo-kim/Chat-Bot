import { useEffect, useState } from 'react';
import type { ChatbotStatus } from '@chat-bot/shared-types';
import { useDebouncedValue } from '../../lib/useDebouncedValue';
import { MESSAGES } from '../../constants/messages';

export interface ChatbotFilterBarProps {
  q: string;
  status: ChatbotStatus[];
  sort: 'createdAt' | 'updatedAt' | 'name';
  order: 'asc' | 'desc';
  onQChange: (q: string) => void;
  onStatusChange: (status: ChatbotStatus[]) => void;
  onSortChange: (sort: 'createdAt' | 'updatedAt' | 'name') => void;
  onOrderChange: (order: 'asc' | 'desc') => void;
}

const STATUS_OPTIONS: { value: ChatbotStatus; label: string }[] = [
  { value: 'DRAFT', label: MESSAGES.chatbot.statusDraft },
  { value: 'ACTIVE', label: MESSAGES.chatbot.statusActive },
  { value: 'ARCHIVED', label: MESSAGES.chatbot.statusArchived },
];

/** 검색(300ms 디바운스) + 상태 체크박스(보관됨 체크 = FR-1-10 "보관됨 포함") + 정렬(ui-spec §3.1). */
export function ChatbotFilterBar({
  q,
  status,
  sort,
  order,
  onQChange,
  onStatusChange,
  onSortChange,
  onOrderChange,
}: ChatbotFilterBarProps): JSX.Element {
  const [localQ, setLocalQ] = useState(q);
  const debouncedQ = useDebouncedValue(localQ, 300);

  useEffect(() => {
    if (debouncedQ !== q) onQChange(debouncedQ);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQ]);

  useEffect(() => {
    setLocalQ(q);
  }, [q]);

  function toggleStatus(value: ChatbotStatus): void {
    if (status.includes(value)) onStatusChange(status.filter((s) => s !== value));
    else onStatusChange([...status, value]);
  }

  return (
    <div className="chatbot-filter-bar">
      <div className="form-field form-field--inline">
        <label htmlFor="chatbot-search">{MESSAGES.chatbot.searchLabel}</label>
        <input
          id="chatbot-search"
          type="search"
          value={localQ}
          onChange={(e) => setLocalQ(e.target.value)}
          placeholder={MESSAGES.chatbot.searchPlaceholder}
        />
      </div>

      <fieldset className="status-filter">
        <legend>{MESSAGES.chatbot.statusFilterLabel}</legend>
        {STATUS_OPTIONS.map((opt) => (
          <label key={opt.value} className="status-filter-option">
            <input type="checkbox" checked={status.includes(opt.value)} onChange={() => toggleStatus(opt.value)} />
            {opt.label}
          </label>
        ))}
      </fieldset>

      <div className="form-field form-field--inline">
        <label htmlFor="chatbot-sort">{MESSAGES.chatbot.sortLabel}</label>
        <select id="chatbot-sort" value={sort} onChange={(e) => onSortChange(e.target.value as 'createdAt' | 'updatedAt' | 'name')}>
          <option value="updatedAt">{MESSAGES.chatbot.sortUpdatedAt}</option>
          <option value="createdAt">{MESSAGES.chatbot.sortCreatedAt}</option>
          <option value="name">{MESSAGES.chatbot.sortName}</option>
        </select>
        <label htmlFor="chatbot-order">{MESSAGES.chatbot.sortOrderLabel}</label>
        <select id="chatbot-order" value={order} onChange={(e) => onOrderChange(e.target.value as 'asc' | 'desc')}>
          <option value="desc">{MESSAGES.chatbot.sortDesc}</option>
          <option value="asc">{MESSAGES.chatbot.sortAsc}</option>
        </select>
      </div>
    </div>
  );
}
