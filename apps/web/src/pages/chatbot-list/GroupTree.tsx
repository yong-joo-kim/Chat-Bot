import type { ChatbotGroupWithCount } from '@chat-bot/shared-types';
import { KebabMenu } from '../../components/KebabMenu';
import { MESSAGES } from '../../constants/messages';

export interface GroupTreeProps {
  groups: ChatbotGroupWithCount[];
  selectedGroupId?: string;
  onSelect: (groupId: string | undefined) => void;
  onCreate: () => void;
  /** No.29 — 그룹 kebab 메뉴 최상단 "그룹 통계 보기"(읽기 동작, FR-I8-2). */
  onViewStats: (group: ChatbotGroupWithCount) => void;
  onEdit: (group: ChatbotGroupWithCount) => void;
  onCopy: (group: ChatbotGroupWithCount) => void;
  onDelete: (group: ChatbotGroupWithCount) => void;
  loading: boolean;
}

/** 좌측 그룹 트리(ui-spec §3.1). "전체" 고정 항목 = `groupId` 미지정 필터. */
export function GroupTree({
  groups,
  selectedGroupId,
  onSelect,
  onCreate,
  onViewStats,
  onEdit,
  onCopy,
  onDelete,
  loading,
}: GroupTreeProps): JSX.Element {
  const totalCount = groups.reduce((sum, g) => sum + g.chatbotCount, 0);

  return (
    <nav className="group-tree" aria-label={MESSAGES.group.treeTitle}>
      <button type="button" className="btn btn-secondary group-tree-add" onClick={onCreate}>
        {MESSAGES.group.addGroup}
      </button>

      {loading ? (
        <p role="status">{MESSAGES.common.loading}</p>
      ) : groups.length === 0 ? (
        <p className="group-tree-empty">{MESSAGES.group.emptyGroups}</p>
      ) : (
        <ul className="group-tree-list">
          <li>
            <button
              type="button"
              className={`group-tree-item${selectedGroupId === undefined ? ' group-tree-item--selected' : ''}`}
              onClick={() => onSelect(undefined)}
              aria-current={selectedGroupId === undefined ? 'true' : undefined}
            >
              {MESSAGES.group.allGroups} <span className="group-count-badge">{totalCount}</span>
            </button>
          </li>
          {groups.map((group) => (
            <li key={group.id} className="group-tree-row">
              <button
                type="button"
                className={`group-tree-item${selectedGroupId === group.id ? ' group-tree-item--selected' : ''}`}
                onClick={() => onSelect(group.id)}
                aria-current={selectedGroupId === group.id ? 'true' : undefined}
              >
                {group.name} <span className="group-count-badge">{group.chatbotCount}</span>
              </button>
              <KebabMenu
                label={MESSAGES.group.kebabLabel(group.name)}
                items={[
                  { label: MESSAGES.group.menuStats, onSelect: () => onViewStats(group) },
                  { label: MESSAGES.group.menuEdit, onSelect: () => onEdit(group) },
                  { label: MESSAGES.group.menuCopy, onSelect: () => onCopy(group) },
                  { label: MESSAGES.group.menuDelete, onSelect: () => onDelete(group) },
                ]}
              />
            </li>
          ))}
        </ul>
      )}
    </nav>
  );
}
