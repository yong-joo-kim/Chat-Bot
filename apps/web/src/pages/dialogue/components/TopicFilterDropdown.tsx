import type { Topic } from '@chat-bot/shared-types';
import { TOPIC_FILTER_COMMON } from '@chat-bot/shared-types';
import { MultiSelectDropdown } from '../../../components/MultiSelectDropdown';
import { MESSAGES } from '../../../constants/messages';

export interface TopicFilterDropdownProps {
  topics: Topic[];
  /** 값 = uuid | 'common'. 빈 배열 = "전체"(ui-spec §3.3). */
  selected: string[];
  onChange: (selected: string[]) => void;
}

/**
 * 목록 6화면 공용 토픽 필터(`MultiSelectDropdown` 그대로 재사용 — 옵션 = "공통" + 토픽 목록).
 * [코드 리뷰 1회차 M-2] URL에 남아 있지만 더 이상 존재하지 않는 토픽 id(삭제됨, EX-TP-24)는
 * `MultiSelectDropdown` 옵션 목록에는 없으므로, 드롭다운 밖에 "삭제된 토픽" 칩으로 따로 보여주고
 * 제거할 수 있게 한다.
 */
export function TopicFilterDropdown({ topics, selected, onChange }: TopicFilterDropdownProps): JSX.Element {
  const msg = MESSAGES.topics;
  const options = [
    { value: TOPIC_FILTER_COMMON as string, label: msg.filterCommonLabel },
    ...topics.map((t) => ({ value: t.id, label: t.enabled ? t.name : msg.topicFieldInactiveSuffix(t.name) })),
  ];
  const knownIds = new Set(options.map((o) => o.value));
  const deletedIds = selected.filter((id) => !knownIds.has(id));

  return (
    <div className="topic-filter-dropdown-wrap">
      <MultiSelectDropdown label={msg.filterLabel} options={options} selected={selected} onChange={onChange} allLabel={msg.filterAllLabel} />
      {deletedIds.length > 0 && (
        <span className="resource-picker-chips">
          {deletedIds.map((id) => (
            <span key={id} className="resource-picker-chip">
              {msg.filterDeletedTopicChip}
              <button
                type="button"
                className="resource-picker-chip-remove"
                aria-label={`${msg.filterDeletedTopicChip} 제거`}
                onClick={() => onChange(selected.filter((s) => s !== id))}
              >
                ×
              </button>
            </span>
          ))}
        </span>
      )}
    </div>
  );
}
