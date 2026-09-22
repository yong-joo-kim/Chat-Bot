import type { UnansweredQuestionStatus } from '@chat-bot/shared-types';
import { UNANSWERED_STATUS_LABELS } from '@chat-bot/shared-types';
import { MESSAGES } from '../../constants/messages';
import { MultiSelectDropdown } from '../../components/MultiSelectDropdown';

export type UnansweredSort = 'occurredCount' | 'lastOccurredAt' | 'createdAt';

const SORT_OPTIONS: { value: UnansweredSort; label: string }[] = [
  { value: 'occurredCount', label: MESSAGES.learning.sortOccurredCount },
  { value: 'lastOccurredAt', label: MESSAGES.learning.sortLastOccurredAt },
  { value: 'createdAt', label: MESSAGES.learning.sortCreatedAt },
];

const STATUS_OPTIONS: { value: UnansweredQuestionStatus; label: string }[] = (
  Object.keys(UNANSWERED_STATUS_LABELS) as UnansweredQuestionStatus[]
).map((value) => ({ value, label: UNANSWERED_STATUS_LABELS[value] }));

export interface UnansweredFilterBarProps {
  q: string;
  onQChange: (q: string) => void;
  status: UnansweredQuestionStatus[];
  onStatusChange: (status: UnansweredQuestionStatus[]) => void;
  recurredOnly: boolean;
  onRecurredOnlyChange: (v: boolean) => void;
  sort: UnansweredSort;
  onSortChange: (sort: UnansweredSort) => void;
}

/** L1 필터바(FR-15-10/11, ui-spec §4.4). 검색창은 목록 최상단 좌측(ROCHA 의도관리 p.21 관용구 대조). */
export function UnansweredFilterBar({
  q,
  onQChange,
  status,
  onStatusChange,
  recurredOnly,
  onRecurredOnlyChange,
  sort,
  onSortChange,
}: UnansweredFilterBarProps): JSX.Element {
  return (
    <div className="dialogue-toolbar learning-filter-bar">
      <div className="form-field form-field--inline">
        <label htmlFor="learning-search">{MESSAGES.learning.filterSearchLabel}</label>
        <input id="learning-search" type="text" value={q} onChange={(e) => onQChange(e.target.value)} />
      </div>
      <MultiSelectDropdown
        label={MESSAGES.learning.filterStatusLabel}
        options={STATUS_OPTIONS}
        selected={status}
        onChange={onStatusChange}
      />
      <label className="learning-recurred-checkbox">
        <input type="checkbox" checked={recurredOnly} onChange={(e) => onRecurredOnlyChange(e.target.checked)} />
        {MESSAGES.learning.filterRecurredOnlyLabel}
      </label>
      <div className="form-field form-field--inline">
        <label htmlFor="learning-sort">{MESSAGES.learning.filterSortLabel}</label>
        <select id="learning-sort" value={sort} onChange={(e) => onSortChange(e.target.value as UnansweredSort)}>
          {SORT_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
