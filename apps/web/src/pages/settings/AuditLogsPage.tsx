import { Fragment, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { AuditAction, AuditLogDetail, AuditLogListItem, AuditTargetType, User } from '@chat-bot/shared-types';
import { AUDIT_TARGET_LABELS, AUDIT_TARGET_ROUTE } from '@chat-bot/shared-types';
import { auditLogsApi } from '../../api/auditLogs';
import { usersApi } from '../../api/users';
import { chatbotsApi } from '../../api/chatbots';
import { ApiError } from '../../api/client';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { SkeletonRow } from '../../components/Skeleton';
import { Pagination } from '../../components/Pagination';
import { AuditActionBadge } from '../../components/security/badges';
import { MESSAGES } from '../../constants/messages';
import { AUDIT_RETENTION_START_DATE } from '../../constants/audit';
import { formatDateTime, formatDate } from '../../lib/date';
import { AuditLogFilterBar } from './audit-logs/AuditLogFilterBar';
import { AuditLogDetailPanel } from './audit-logs/AuditLogDetailPanel';
import { AuditLogCardList } from './audit-logs/AuditLogCard';

/** A1 — 이력(감사로그) 관리(security-audit-ui-spec.md §3.9). */
export function AuditLogsPage(): JSX.Element {
  const msg = MESSAGES.auditLogs;
  const [searchParams, setSearchParams] = useSearchParams();
  const chatbotId = searchParams.get('chatbotId') ?? undefined;
  const chatbotName = searchParams.get('chatbotName') ?? undefined;

  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [actorId, setActorId] = useState('');
  const [action, setAction] = useState<AuditAction[]>([]);
  const [targetType, setTargetType] = useState<AuditTargetType[]>([]);
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);

  const [items, setItems] = useState<AuditLogListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [appliedFrom, setAppliedFrom] = useState<string | null>(null);
  const [appliedTo, setAppliedTo] = useState<string | null>(null);
  const [rangeDefaulted, setRangeDefaulted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [rangeError, setRangeError] = useState<string | undefined>();

  const [actors, setActors] = useState<User[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detailCache, setDetailCache] = useState<Record<string, AuditLogDetail>>({});
  const [detailLoading, setDetailLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    setRangeError(undefined);
    try {
      const res = await auditLogsApi.list({
        from: from || undefined,
        to: to || undefined,
        actorId: actorId || undefined,
        action: action.length > 0 ? action : undefined,
        targetType: targetType.length > 0 ? targetType : undefined,
        chatbotId,
        q: q || undefined,
        page,
        pageSize: 20,
      });
      setItems(res.items);
      setTotal(res.total);
      setAppliedFrom(String(res.appliedFrom));
      setAppliedTo(String(res.appliedTo));
      setRangeDefaulted(res.rangeDefaulted);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'AUDIT_RANGE_TOO_WIDE') {
        setRangeError(e.message);
      } else {
        setError(true);
      }
    } finally {
      setLoading(false);
    }
  }, [from, to, actorId, action, targetType, chatbotId, q, page]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    usersApi
      .list({ pageSize: 100 })
      .then((res) => setActors(res.items))
      .catch(() => setActors([]));
  }, []);

  function resetFilters(): void {
    setFrom('');
    setTo('');
    setActorId('');
    setAction([]);
    setTargetType([]);
    setQ('');
    setPage(1);
  }

  function removeChatbotFilter(): void {
    const next = new URLSearchParams(searchParams);
    next.delete('chatbotId');
    next.delete('chatbotName');
    setSearchParams(next);
    setPage(1);
  }

  /**
   * Medium #4(PM 승인): 필터바의 수동 선택기(§3.9 `ResourcePickerField` 재사용)로 챗봇을 바꾸면
   * 딥링크 진입 시와 동일한 `chatbotId`/`chatbotName` 쿼리스트링을 갱신해 상단 칩도 함께 연동된다.
   */
  async function handleChatbotIdChange(newChatbotId: string | null): Promise<void> {
    if (!newChatbotId) {
      removeChatbotFilter();
      return;
    }
    const next = new URLSearchParams(searchParams);
    next.set('chatbotId', newChatbotId);
    try {
      const chatbot = await chatbotsApi.findOne(newChatbotId);
      next.set('chatbotName', encodeURIComponent(chatbot.name));
    } catch {
      next.delete('chatbotName');
    }
    setSearchParams(next);
    setPage(1);
  }

  async function toggleExpand(id: string): Promise<void> {
    if (expandedId === id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(id);
    if (!detailCache[id]) {
      setDetailLoading(true);
      try {
        const detail = await auditLogsApi.findOne(id);
        setDetailCache((prev) => ({ ...prev, [id]: detail }));
      } finally {
        setDetailLoading(false);
      }
    }
  }

  const beforeRetention = appliedTo !== null && appliedTo.slice(0, 10) < AUDIT_RETENTION_START_DATE;
  const exportDisabled = !from && !to;

  return (
    <div className="settings-page">
      <h1>{msg.title}</h1>
      <p className="form-banner form-banner--info">{msg.retentionNotice(formatDate(AUDIT_RETENTION_START_DATE))}</p>

      {chatbotId && chatbotName && (
        <p>
          <span className="condition-chip condition-chip--context">
            {msg.chatbotFilterChipLabel(decodeURIComponent(chatbotName))}{' '}
            <button type="button" className="link-button" onClick={removeChatbotFilter} aria-label={msg.chatbotChipRemove}>
              ×
            </button>
          </span>
        </p>
      )}

      <div className="dialogue-toolbar">
        <AuditLogFilterBar
          from={from}
          to={to}
          actorId={actorId}
          action={action}
          targetType={targetType}
          chatbotId={chatbotId ?? ''}
          q={q}
          actors={actors}
          rangeError={rangeError}
          onFromToChange={(f, t) => { setFrom(f); setTo(t); setPage(1); }}
          onActorChange={(v) => { setActorId(v); setPage(1); }}
          onActionChange={(v) => { setAction(v); setPage(1); }}
          onTargetTypeChange={(v) => { setTargetType(v); setPage(1); }}
          onChatbotIdChange={(v) => void handleChatbotIdChange(v)}
          onQChange={(v) => { setQ(v); setPage(1); }}
        />
        <a
          className={`btn btn-secondary${exportDisabled ? ' btn-disabled' : ''}`}
          aria-disabled={exportDisabled}
          title={exportDisabled ? msg.exportDisabledHint : undefined}
          href={exportDisabled ? undefined : auditLogsApi.exportUrl({ from, to, actorId: actorId || undefined, action, targetType, chatbotId, q: q || undefined })}
          onClick={(e) => {
            if (exportDisabled) e.preventDefault();
          }}
        >
          {msg.exportButton}
        </a>
      </div>

      {!loading && !error && appliedFrom && appliedTo && (
        <p className="result-count-badge">
          {msg.resultSummary(formatDate(appliedFrom), formatDate(appliedTo), total)}
          {rangeDefaulted && ` ${msg.rangeDefaultedNotice}`}
        </p>
      )}

      {loading && (
        <>
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
        </>
      )}
      {!loading && error && <ErrorState title={msg.loadFailed} onRetry={load} />}
      {!loading && !error && items.length === 0 && beforeRetention && (
        <EmptyState title={msg.emptyBeforeRetentionTitle(formatDate(AUDIT_RETENTION_START_DATE))} />
      )}
      {!loading && !error && items.length === 0 && !beforeRetention && (
        <EmptyState
          title={msg.emptyFilteredTitle}
          action={
            <button type="button" className="btn btn-secondary" onClick={resetFilters}>
              {msg.resetFilter}
            </button>
          }
        />
      )}
      {!loading && !error && items.length > 0 && (
        <div className="dialogue-table-wrap">
          <table className="dialogue-table desktop-only">
            <thead>
              <tr>
                <th scope="col" aria-hidden="true" />
                <th scope="col">{msg.columnTime}</th>
                <th scope="col">{msg.columnActor}</th>
                <th scope="col">{msg.columnAction}</th>
                <th scope="col">{msg.columnTargetType}</th>
                <th scope="col">{msg.columnTargetName}</th>
                <th scope="col">{msg.columnChatbot}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const isExpanded = expandedId === item.id;
                const route = AUDIT_TARGET_ROUTE[item.targetType];
                return (
                  <Fragment key={item.id}>
                    <tr>
                      <td>
                        <button
                          type="button"
                          className="link-button"
                          aria-expanded={isExpanded}
                          aria-label={isExpanded ? '접기' : '펼치기'}
                          onClick={() => void toggleExpand(item.id)}
                        >
                          {isExpanded ? '▾' : '▸'}
                        </button>
                      </td>
                      <td>{formatDateTime(item.createdAt)}</td>
                      <td>{item.actorEmail ?? msg.unknownActor}</td>
                      <td>
                        <AuditActionBadge action={item.action} />
                      </td>
                      <td>{AUDIT_TARGET_LABELS[item.targetType]}</td>
                      <td>
                        {item.targetName ? (
                          route ? (
                            <a href={route.replace(':chatbotId', item.chatbotId ?? '').replace(':id', item.targetId)}>{item.targetName}</a>
                          ) : (
                            item.targetName
                          )
                        ) : (
                          '—'
                        )}
                      </td>
                      <td>
                        {item.chatbotId ? (item.chatbotId === chatbotId && chatbotName ? decodeURIComponent(chatbotName) : item.chatbotId) : '—'}
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr>
                        <td colSpan={7} className="audit-log-detail-cell">
                          {detailLoading && !detailCache[item.id] ? (
                            <SkeletonRow />
                          ) : detailCache[item.id] ? (
                            <AuditLogDetailPanel detail={detailCache[item.id]} />
                          ) : null}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
          <AuditLogCardList
            items={items}
            loading={false}
            expandedId={expandedId}
            detailCache={detailCache}
            detailLoading={detailLoading}
            chatbotId={chatbotId}
            chatbotName={chatbotName}
            onToggleExpand={(id) => void toggleExpand(id)}
          />
          <Pagination page={page} pageSize={20} total={total} onPageChange={setPage} />
        </div>
      )}
    </div>
  );
}
