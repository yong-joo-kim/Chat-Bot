import { Fragment, useCallback, useEffect, useState } from 'react';
import type { AuditChainVerifyStatus, RetentionRunItem, RetentionRunKind } from '@chat-bot/shared-types';
import { RetentionRunKind as RetentionRunKindEnum } from '@chat-bot/shared-types';
import { governanceApi } from '../../../api/governance';
import { ErrorState } from '../../../components/ErrorState';
import { EmptyState } from '../../../components/EmptyState';
import { SkeletonRow } from '../../../components/Skeleton';
import { Pagination } from '../../../components/Pagination';
import { DateRangeField } from '../../../components/DateRangeField';
import { MultiSelectDropdown } from '../../../components/MultiSelectDropdown';
import { ResourcePickerField } from '../../../components/ResourcePickerField';
import { PurgeRunResultBadge, ChainVerifyResultBadge, TruncatedHash } from '../../../components/DataGovernanceBadges';
import { DataGovernanceModeBanner } from '../../../components/DataGovernanceModeBanner';
import { useAuth } from '../../../context/AuthContext';
import { useLatestRequest } from '../../../lib/useLatestRequest';
import { MESSAGES } from '../../../constants/messages';
import { formatDateTime } from '../../../lib/date';

const PAGE_SIZE = 20;

const CHAIN_VERIFY_STATUSES: readonly AuditChainVerifyStatus[] = ['OK', 'EMPTY', 'HASH_MISMATCH', 'SEQ_GAP', 'TAIL_MISSING', 'KEY_UNAVAILABLE', 'ANCHOR_MISSING'];

/**
 * `RetentionRunItem.resultCode`는 `kind`별로 값 집합이 다르다(shared-types `governance.ts`
 * `RetentionRunItemSchema.resultCode` 주석, 2차 계약 확정 — data-governance 2차 연결 지시 §4):
 * - `CHAIN_VERIFY`: `AuditChainVerifyResponseSchema.status`(`AuditChainVerifyStatus`)와 정확히 같은
 *   값 집합('OK' 포함) — `ChainVerifyResultBadge`로 표시한다.
 * - `PURGE`: `'MAX_ROWS'`(부분 처리) 또는 `null`(성공)뿐이다.
 * - `BACKFILL`/`REENCRYPT`: 항상 `null`(성공만 기록).
 * `PURGE`/`BACKFILL`/`REENCRYPT`는 `PurgeRunResultBadge`(status 기반 + resultCode 보조 문구)로
 * 충분히 표시되므로, 이 함수는 `kind==='CHAIN_VERIFY'`일 때만 쓴다.
 */
function chainVerifyStatus(resultCode: string | null): AuditChainVerifyStatus | null {
  return resultCode && (CHAIN_VERIFY_STATUSES as readonly string[]).includes(resultCode) ? (resultCode as AuditChainVerifyStatus) : null;
}

/** G1-c — 파기 이력(`/settings/data-governance/purge-history`, `data-governance-ui-spec.md` §3.3). */
export function PurgeHistoryPage(): JSX.Element {
  const msg = MESSAGES.dataGovernance.purgeHistory;
  const { user } = useAuth();
  const guard = useLatestRequest();

  const [kind, setKind] = useState<RetentionRunKind[]>([]);
  const [chatbotId, setChatbotId] = useState<string | null>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const [items, setItems] = useState<RetentionRunItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    const reqId = guard.next();
    setLoading(true);
    setError(false);
    try {
      const res = await governanceApi.retentionRuns({
        kind: kind.length > 0 ? kind : undefined,
        chatbotId: chatbotId ?? undefined,
        from: from ? new Date(from) : undefined,
        to: to ? new Date(to) : undefined,
        page,
        pageSize: PAGE_SIZE,
      });
      if (guard.isStale(reqId)) return;
      setItems(res.items);
      setTotal(res.total);
    } catch {
      if (guard.isStale(reqId)) return;
      setError(true);
    } finally {
      if (!guard.isStale(reqId)) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind.join(','), chatbotId, from, to, page]);

  useEffect(() => {
    void load();
  }, [load]);

  const kindOptions = RetentionRunKindEnum.options.map((k) => ({ value: k, label: msg.kindLabel[k] }));

  return (
    <div className="purge-history-page">
      <DataGovernanceModeBanner visible={!(user?.governanceModeOn ?? false)} />

      <div className="dialogue-toolbar">
        <MultiSelectDropdown label={msg.filterKindLabel} options={kindOptions} selected={kind} onChange={(v) => { setKind(v); setPage(1); }} />
        <ResourcePickerField
          id="purge-history-chatbot-filter"
          label={msg.filterChatbotLabel}
          resourceType="chatbot"
          multiple={false}
          value={chatbotId}
          onChange={(v) => { setChatbotId((v as string | null) || null); setPage(1); }}
        />
        <DateRangeField from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); setPage(1); }} />
      </div>

      {loading && (
        <>
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
        </>
      )}
      {!loading && error && <ErrorState title={msg.loadFailed} onRetry={load} />}
      {!loading && !error && items.length === 0 && <EmptyState title={msg.emptyTitle} description={msg.emptyDesc} />}
      {!loading && !error && items.length > 0 && (
        <div className="dialogue-table-wrap">
          <table className="dialogue-table desktop-only">
            <thead>
              <tr>
                <th scope="col" aria-hidden="true" />
                <th scope="col">{msg.columnStartedAt}</th>
                <th scope="col">{msg.columnKind}</th>
                <th scope="col">{msg.columnTarget}</th>
                <th scope="col">{msg.columnDays}</th>
                <th scope="col">{msg.columnCutoff}</th>
                <th scope="col">{msg.columnAffectedCount}</th>
                <th scope="col">{msg.columnStatus}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const isExpanded = expandedId === item.id;
                const chainStatus = chainVerifyStatus(item.resultCode);
                return (
                  <Fragment key={item.id}>
                    <tr>
                      <td>
                        <button
                          type="button"
                          className="link-button"
                          aria-expanded={isExpanded}
                          aria-label={isExpanded ? '접기' : '펼치기'}
                          onClick={() => setExpandedId(isExpanded ? null : item.id)}
                        >
                          {isExpanded ? '▾' : '▸'}
                        </button>
                      </td>
                      <td>{formatDateTime(item.startedAt)}</td>
                      <td>{msg.kindLabel[item.kind]}</td>
                      <td>{item.target ?? '—'}</td>
                      <td>{item.days ?? '—'}</td>
                      <td>{item.cutoff ? formatDateTime(item.cutoff) : '—'}</td>
                      <td>{item.affectedCount.toLocaleString()}</td>
                      <td>
                        {item.kind === 'CHAIN_VERIFY' && chainStatus ? (
                          <ChainVerifyResultBadge status={chainStatus} />
                        ) : (
                          <PurgeRunResultBadge status={item.status} resultCode={item.resultCode} />
                        )}
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr>
                        <td colSpan={8}>
                          <p>{item.runId}</p>
                          {item.headSeq !== null && item.headHash && (
                            <p>
                              {msg.chainHeadInfoLabel}: seq {item.headSeq} / <TruncatedHash hash={item.headHash} />
                            </p>
                          )}
                          {item.anchorSeq !== null && <p>anchor seq {item.anchorSeq}</p>}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
          <ul className="settings-card-list mobile-only">
            {items.map((item) => (
              <li key={item.id} className="settings-card">
                <div className="settings-card-header">
                  <span className="settings-card-title">{formatDateTime(item.startedAt)}</span>
                  {item.kind === 'CHAIN_VERIFY' && chainVerifyStatus(item.resultCode) ? (
                    <ChainVerifyResultBadge status={chainVerifyStatus(item.resultCode) as AuditChainVerifyStatus} />
                  ) : (
                    <PurgeRunResultBadge status={item.status} resultCode={item.resultCode} />
                  )}
                </div>
                <dl className="settings-card-fields">
                  <div>
                    <dt>{msg.columnKind}</dt>
                    <dd>{msg.kindLabel[item.kind]}</dd>
                  </div>
                  <div>
                    <dt>{msg.columnTarget}</dt>
                    <dd>{item.target ?? '—'}</dd>
                  </div>
                  <div>
                    <dt>{msg.columnAffectedCount}</dt>
                    <dd>{item.affectedCount.toLocaleString()}</dd>
                  </div>
                </dl>
              </li>
            ))}
          </ul>
          <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} />
        </div>
      )}
    </div>
  );
}
