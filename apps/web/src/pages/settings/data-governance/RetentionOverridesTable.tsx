import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CONVERSATION_RETENTION_KINDS, type RetentionOverrideItem } from '@chat-bot/shared-types';
import { governanceApi } from '../../../api/governance';
import { ErrorState } from '../../../components/ErrorState';
import { EmptyState } from '../../../components/EmptyState';
import { SkeletonRow } from '../../../components/Skeleton';
import { Pagination } from '../../../components/Pagination';
import { StatusBadge } from '../../../components/StatusBadge';
import { MESSAGES } from '../../../constants/messages';

const PAGE_SIZE = 20;
const KNOWN_CHATBOT_STATUSES = ['DRAFT', 'ACTIVE', 'ARCHIVED'] as const;

function kindDisplay(item: RetentionOverrideItem, kind: (typeof CONVERSATION_RETENTION_KINDS)[number]): string {
  const msg = MESSAGES.dataGovernance.retention;
  const k = item.kinds.find((entry) => entry.kind === kind);
  if (!k || k.source !== 'CHATBOT') return msg.followGlobalShortLabel;
  return k.days === null ? msg.unlimitedDaysLabel : `${k.days}${msg.daysUnit}`;
}

/** G1-b "챗봇별 재정의" 목록(`GET /governance/retention/overrides`, `security:read`, data-governance-ui-spec.md §3.2.1). */
export function RetentionOverridesTable(): JSX.Element {
  const msg = MESSAGES.dataGovernance.retention;
  const [items, setItems] = useState<RetentionOverrideItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError(false);
    governanceApi.retention
      .overrides({ page, pageSize: PAGE_SIZE })
      .then((res) => {
        setItems(res.items);
        setTotal(res.total);
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [page]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <section className="settings-card retention-overrides-table">
      <h2>{msg.overridesSectionTitle}</h2>
      {loading && <SkeletonRow />}
      {!loading && error && <ErrorState title={msg.loadFailed} onRetry={load} />}
      {!loading && !error && items.length === 0 && <EmptyState title={msg.overridesEmptyTitle} />}
      {!loading && !error && items.length > 0 && (
        <div className="dialogue-table-wrap">
          <table className="dialogue-table desktop-only">
            <thead>
              <tr>
                <th scope="col">챗봇</th>
                <th scope="col">상태</th>
                {CONVERSATION_RETENTION_KINDS.map((kind) => (
                  <th key={kind} scope="col">
                    {msg.kindLabels[kind]}
                  </th>
                ))}
                <th scope="col">
                  <span className="sr-only">{msg.overridesDetailColumnLabel}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.chatbotId}>
                  <td>{item.chatbotName}</td>
                  <td>
                    {(KNOWN_CHATBOT_STATUSES as readonly string[]).includes(item.status) ? (
                      <StatusBadge status={item.status as (typeof KNOWN_CHATBOT_STATUSES)[number]} size="sm" />
                    ) : (
                      item.status
                    )}
                  </td>
                  {CONVERSATION_RETENTION_KINDS.map((kind) => (
                    <td key={kind}>{kindDisplay(item, kind)}</td>
                  ))}
                  <td>
                    <Link to={`/chatbots/${item.chatbotId}/settings?section=retention`}>{msg.overridesDetailLink}</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <ul className="settings-card-list mobile-only">
            {items.map((item) => (
              <li key={item.chatbotId} className="settings-card">
                <div className="settings-card-header">
                  <span className="settings-card-title">{item.chatbotName}</span>
                  {(KNOWN_CHATBOT_STATUSES as readonly string[]).includes(item.status) ? (
                    <StatusBadge status={item.status as (typeof KNOWN_CHATBOT_STATUSES)[number]} size="sm" />
                  ) : (
                    item.status
                  )}
                </div>
                <dl className="settings-card-fields">
                  {CONVERSATION_RETENTION_KINDS.map((kind) => (
                    <div key={kind}>
                      <dt>{msg.kindLabels[kind]}</dt>
                      <dd>{kindDisplay(item, kind)}</dd>
                    </div>
                  ))}
                </dl>
                <Link to={`/chatbots/${item.chatbotId}/settings?section=retention`}>{msg.overridesDetailLink}</Link>
              </li>
            ))}
          </ul>
          <p className="field-hint">{msg.overridesTotalCount(total)}</p>
          <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} />
        </div>
      )}
    </section>
  );
}
