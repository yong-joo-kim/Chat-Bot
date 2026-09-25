import { useCallback, useEffect, useState } from 'react';
import type { EnvironmentKind, EnvironmentSwitchLogItem } from '@chat-bot/shared-types';
import { ENVIRONMENT_LIMITS } from '@chat-bot/shared-types';
import { MESSAGES } from '../../../constants/messages';
import { formatDateTime } from '../../../lib/date';
import { environmentApi } from '../../../api/environment';
import { SkeletonRow } from '../../../components/Skeleton';
import { ErrorState } from '../../../components/ErrorState';
import { EmptyState } from '../../../components/EmptyState';
import { Pagination } from '../../../components/Pagination';
import { KebabMenu } from '../../../components/KebabMenu';

export interface EnvironmentHistoryTableProps {
  chatbotId: string;
  canDeploy: boolean;
  onRollbackRequested: (item: EnvironmentSwitchLogItem) => void;
  onScheduleSwitchRequested: (item: EnvironmentSwitchLogItem) => void;
  currentProdVersionId?: string;
}

/** EN1-f 전환 이력(`environment-separation-ui-spec.md` §4.8). append-only — 삭제·수정 액션 없음. */
export function EnvironmentHistoryTable({
  chatbotId,
  canDeploy,
  onRollbackRequested,
  onScheduleSwitchRequested,
  currentProdVersionId,
}: EnvironmentHistoryTableProps): JSX.Element {
  const msg = MESSAGES.environment.history;
  const [envFilter, setEnvFilter] = useState<EnvironmentKind | 'ALL'>('ALL');
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<EnvironmentSwitchLogItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const res = await environmentApi.history(chatbotId, {
        page,
        pageSize: ENVIRONMENT_LIMITS.historyPageSizeDefault,
        environment: envFilter === 'ALL' ? undefined : (envFilter as Exclude<EnvironmentKind, 'DRAFT'>),
      });
      setItems(res.items);
      setTotal(res.total);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [chatbotId, page, envFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="environment-history-table">
      <div className="environment-history-header">
        <h2>{msg.sectionTitle}</h2>
        <label htmlFor="environment-history-filter">
          {msg.envFilterLabel}
          <select
            id="environment-history-filter"
            value={envFilter}
            onChange={(e) => {
              setEnvFilter(e.target.value as EnvironmentKind | 'ALL');
              setPage(1);
            }}
          >
            <option value="ALL">{msg.envFilterAll}</option>
            <option value="STAGING">{msg.envFilterStaging}</option>
            <option value="PROD">{msg.envFilterProd}</option>
          </select>
        </label>
      </div>

      {loading ? (
        <>
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
        </>
      ) : error ? (
        <ErrorState title={msg.loadFailed} onRetry={load} />
      ) : items.length === 0 ? (
        <EmptyState title={msg.emptyTitle} />
      ) : (
        <>
          {/* [신규 No.40 — §11 1차 편차 (a)] 데스크톱은 표, 640px 미만은 카드 목록으로 전환한다
              (ui-spec §11 — `ChatbotCardList.tsx`/`AuditLogCard.tsx`와 같은 `desktop-only`/`mobile-only`
              토글 관행). 가로 스크롤 표는 만들지 않는다. */}
          <table className="environment-history-table-el desktop-only">
            <thead>
              <tr>
                <th scope="col">{msg.columns.time}</th>
                <th scope="col">{msg.columns.environment}</th>
                <th scope="col">{msg.columns.method}</th>
                <th scope="col">{msg.columns.version}</th>
                <th scope="col">{msg.columns.actor}</th>
                <th scope="col">{msg.columns.reason}</th>
                {canDeploy && (
                  <th scope="col">
                    <span className="sr-only">{MESSAGES.common.actionsColumnLabel}</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const isPastProdEntry = item.environment === 'PROD' && item.toVersionId !== null && item.toVersionId !== currentProdVersionId;
                return (
                  <tr key={item.id}>
                    <td>{formatDateTime(item.createdAt)}</td>
                    <td>{msg.environmentLabel[item.environment]}</td>
                    <td>
                      {msg.methodLabel[item.method]}
                      {item.method === 'DISABLE' && item.disableMode && ` (${msg.disableModeLabel[item.disableMode]})`}
                    </td>
                    <td>{msg.versionArrow(item.toVersionNo, item.fromVersionNo)}</td>
                    <td>{item.actorEmail ?? '—'}</td>
                    <td>{item.reason ?? '—'}</td>
                    {canDeploy && (
                      <td>
                        {isPastProdEntry && item.toVersionNo !== null && (
                          <KebabMenu
                            label={msg.kebabLabel(item.toVersionNo)}
                            items={[
                              { label: msg.rollbackAction, onSelect: () => onRollbackRequested(item) },
                              { label: msg.scheduleAction, onSelect: () => onScheduleSwitchRequested(item) },
                            ]}
                          />
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>

          <ul className="settings-card-list mobile-only">
            {items.map((item) => {
              const isPastProdEntry = item.environment === 'PROD' && item.toVersionId !== null && item.toVersionId !== currentProdVersionId;
              return (
                <li key={item.id} className="settings-card">
                  <div className="settings-card-header">
                    <span className="settings-card-title">{formatDateTime(item.createdAt)}</span>
                  </div>
                  <dl className="settings-card-fields">
                    <div>
                      <dt>{msg.columns.environment}</dt>
                      <dd>{msg.environmentLabel[item.environment]}</dd>
                    </div>
                    <div>
                      <dt>{msg.columns.method}</dt>
                      <dd>
                        {msg.methodLabel[item.method]}
                        {item.method === 'DISABLE' && item.disableMode && ` (${msg.disableModeLabel[item.disableMode]})`}
                      </dd>
                    </div>
                    <div>
                      <dt>{msg.columns.version}</dt>
                      <dd>{msg.versionArrow(item.toVersionNo, item.fromVersionNo)}</dd>
                    </div>
                    <div>
                      <dt>{msg.columns.actor}</dt>
                      <dd>{item.actorEmail ?? '—'}</dd>
                    </div>
                    <div>
                      <dt>{msg.columns.reason}</dt>
                      <dd>{item.reason ?? '—'}</dd>
                    </div>
                  </dl>
                  {canDeploy && isPastProdEntry && item.toVersionNo !== null && (
                    <div className="settings-card-actions">
                      <KebabMenu
                        label={msg.kebabLabel(item.toVersionNo)}
                        items={[
                          { label: msg.rollbackAction, onSelect: () => onRollbackRequested(item) },
                          { label: msg.scheduleAction, onSelect: () => onScheduleSwitchRequested(item) },
                        ]}
                      />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>

          <Pagination page={page} pageSize={ENVIRONMENT_LIMITS.historyPageSizeDefault} total={total} onPageChange={setPage} />
        </>
      )}
    </div>
  );
}
