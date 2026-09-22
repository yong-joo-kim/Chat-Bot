import type { BannedWord } from '@chat-bot/shared-types';
import { KebabMenu } from '../../../components/KebabMenu';
import { SkeletonCard } from '../../../components/Skeleton';
import { MatchTypeBadge, BannedWordPolicyBadge } from '../../../components/security/badges';
import { MESSAGES } from '../../../constants/messages';
import { formatDate } from '../../../lib/date';

export interface BannedWordCardListProps {
  items: BannedWord[];
  loading: boolean;
  canWrite: boolean;
  onToggleEnabled: (item: BannedWord) => void;
  onEdit: (item: BannedWord) => void;
  onDelete: (item: BannedWord) => void;
}

/** B1 모바일 카드뷰(<640px, security-audit-ui-spec.md §9). 표(`BannedWordTable`)와 동일한 정보를 라벨+값 스택으로 표시한다. */
export function BannedWordCardList({ items, loading, canWrite, onToggleEnabled, onEdit, onDelete }: BannedWordCardListProps): JSX.Element {
  const msg = MESSAGES.bannedWords;

  if (loading) {
    return (
      <ul className="settings-card-list mobile-only">
        <li>
          <SkeletonCard />
        </li>
        <li>
          <SkeletonCard />
        </li>
      </ul>
    );
  }

  return (
    <ul className="settings-card-list mobile-only">
      {items.map((item) => (
        <li key={item.id} className="settings-card">
          <div className="settings-card-header">
            <span className="settings-card-title">{item.word}</span>
            <BannedWordPolicyBadge policy={item.policy} />
          </div>
          <dl className="settings-card-fields">
            <div>
              <dt>{msg.columnMatchType}</dt>
              <dd>
                <MatchTypeBadge matchType={item.matchType} />
              </dd>
            </div>
            <div>
              <dt>{msg.columnEnabled}</dt>
              <dd>
                <button
                  type="button"
                  className="link-button"
                  disabled={!canWrite}
                  aria-pressed={item.enabled}
                  onClick={() => onToggleEnabled(item)}
                >
                  {item.enabled ? msg.inUse : msg.notInUse}
                </button>
              </dd>
            </div>
            <div>
              <dt>{msg.columnDescription}</dt>
              <dd>{item.description || '—'}</dd>
            </div>
            <div>
              <dt>{msg.columnUpdatedAt}</dt>
              <dd>{formatDate(item.updatedAt)}</dd>
            </div>
          </dl>
          {canWrite && (
            <div className="settings-card-actions">
              <KebabMenu
                label={`${item.word} 관리`}
                items={[
                  { label: '편집', onSelect: () => onEdit(item) },
                  { label: MESSAGES.common.delete, onSelect: () => onDelete(item) },
                ]}
              />
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
