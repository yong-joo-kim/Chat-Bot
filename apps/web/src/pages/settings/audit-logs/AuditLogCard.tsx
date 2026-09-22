import type { AuditLogDetail, AuditLogListItem } from '@chat-bot/shared-types';
import { AUDIT_TARGET_LABELS, AUDIT_TARGET_ROUTE } from '@chat-bot/shared-types';
import { AuditActionBadge } from '../../../components/security/badges';
import { SkeletonCard, SkeletonRow } from '../../../components/Skeleton';
import { MESSAGES } from '../../../constants/messages';
import { formatDateTime } from '../../../lib/date';
import { AuditLogDetailPanel } from './AuditLogDetailPanel';

export interface AuditLogCardListProps {
  items: AuditLogListItem[];
  loading: boolean;
  expandedId: string | null;
  detailCache: Record<string, AuditLogDetail>;
  detailLoading: boolean;
  chatbotId?: string;
  chatbotName?: string;
  onToggleExpand: (id: string) => void;
}

/**
 * A1 모바일 카드뷰(<640px, security-audit-ui-spec.md §9). 표(`AuditLogTable`)와 동일한 정보를
 * 라벨+값 스택으로 표시하고, 상세 확장은 표와 마찬가지로 "카드 내부 아코디언"으로 유지한다(§3.9.2).
 */
export function AuditLogCardList({
  items,
  loading,
  expandedId,
  detailCache,
  detailLoading,
  chatbotId,
  chatbotName,
  onToggleExpand,
}: AuditLogCardListProps): JSX.Element {
  const msg = MESSAGES.auditLogs;

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
      {items.map((item) => {
        const isExpanded = expandedId === item.id;
        const route = AUDIT_TARGET_ROUTE[item.targetType];
        return (
          <li key={item.id} className="settings-card">
            <div className="settings-card-header">
              <span className="settings-card-title">{formatDateTime(item.createdAt)}</span>
              <AuditActionBadge action={item.action} />
            </div>
            <dl className="settings-card-fields">
              <div>
                <dt>{msg.columnActor}</dt>
                <dd>{item.actorEmail ?? msg.unknownActor}</dd>
              </div>
              <div>
                <dt>{msg.columnTargetType}</dt>
                <dd>{AUDIT_TARGET_LABELS[item.targetType]}</dd>
              </div>
              <div>
                <dt>{msg.columnTargetName}</dt>
                <dd>
                  {item.targetName ? (
                    route ? (
                      <a href={route.replace(':chatbotId', item.chatbotId ?? '').replace(':id', item.targetId)}>{item.targetName}</a>
                    ) : (
                      item.targetName
                    )
                  ) : (
                    '—'
                  )}
                </dd>
              </div>
              <div>
                <dt>{msg.columnChatbot}</dt>
                <dd>
                  {item.chatbotId ? (item.chatbotId === chatbotId && chatbotName ? decodeURIComponent(chatbotName) : item.chatbotId) : '—'}
                </dd>
              </div>
            </dl>
            <div className="settings-card-actions">
              <button
                type="button"
                className="link-button"
                aria-expanded={isExpanded}
                onClick={() => onToggleExpand(item.id)}
              >
                <span aria-hidden="true">{isExpanded ? '▾' : '▸'}</span> {isExpanded ? msg.collapseDetail : msg.expandDetail}
              </button>
            </div>
            {isExpanded && (
              <div className="audit-log-card-detail">
                {detailLoading && !detailCache[item.id] ? (
                  <SkeletonRow />
                ) : detailCache[item.id] ? (
                  <AuditLogDetailPanel detail={detailCache[item.id]} />
                ) : null}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
