import { useMemo, useState } from 'react';
import type { IntegratedBreakdown, IntegratedBreakdownItem } from '@chat-bot/shared-types';
import { MESSAGES } from '../../constants/messages';
import { StatusBadge } from '../../components/StatusBadge';
import { EmptyState } from '../../components/EmptyState';
import { formatDate, formatPercent } from '../../lib/date';

type SortColumn = 'name' | 'turnCount' | 'share' | 'responseRate' | 'sessionCount' | 'unansweredCount';
type SortDir = 'asc' | 'desc';

type OthersRow = NonNullable<IntegratedBreakdown['othersRow']>;
type UnassignedRow = NonNullable<IntegratedBreakdown['unassignedRow']>;

export interface SortableBreakdownTableProps {
  items: IntegratedBreakdownItem[];
  othersRow?: OthersRow | null;
  unassignedRow?: UnassignedRow | null;
  kind: 'CHATBOT' | 'GROUP';
  onRowClick: (item: IntegratedBreakdownItem) => void;
}

const SORT_COLUMN_LABEL: Record<SortColumn, string> = {
  name: MESSAGES.integratedStats.breakdownColumnName,
  turnCount: MESSAGES.integratedStats.breakdownColumnTurn,
  share: MESSAGES.integratedStats.breakdownColumnShare,
  responseRate: MESSAGES.integratedStats.breakdownColumnResponseRate,
  sessionCount: MESSAGES.integratedStats.breakdownColumnSession,
  unansweredCount: MESSAGES.integratedStats.breakdownColumnUnanswered,
};

function sortValue(item: IntegratedBreakdownItem, col: SortColumn): number | string {
  if (col === 'name') return item.kind === 'GROUP' && item.missing ? item.id : (item.name ?? '');
  return item[col];
}

/** §2.5 — 기여 표. 클라이언트 메모리 정렬(추가 요청 없음), `othersRow`/`unassignedRow`는 정렬 제외 + 항상 맨 아래. */
export function SortableBreakdownTable({ items, othersRow, unassignedRow, kind, onRowClick }: SortableBreakdownTableProps): JSX.Element {
  const [sortCol, setSortCol] = useState<SortColumn>('turnCount');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [announce, setAnnounce] = useState('');

  const sortedItems = useMemo(() => {
    const copy = [...items];
    copy.sort((a, b) => {
      const av = sortValue(a, sortCol);
      const bv = sortValue(b, sortCol);
      const cmp = typeof av === 'string' && typeof bv === 'string' ? av.localeCompare(bv, 'ko') : Number(av) - Number(bv);
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return copy;
  }, [items, sortCol, sortDir]);

  function handleSort(col: SortColumn): void {
    const nextDir: SortDir = sortCol === col ? (sortDir === 'asc' ? 'desc' : 'asc') : col === 'name' ? 'asc' : 'desc';
    setSortCol(col);
    setSortDir(nextDir);
    setAnnounce(
      MESSAGES.integratedStats.breakdownSortAnnounce(
        SORT_COLUMN_LABEL[col],
        nextDir === 'asc' ? MESSAGES.integratedStats.breakdownSortAscending : MESSAGES.integratedStats.breakdownSortDescending,
      ),
    );
  }

  function renderSortableHeader(col: SortColumn): JSX.Element {
    const active = sortCol === col;
    const ariaSort = active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none';
    return (
      <th scope="col" aria-sort={ariaSort}>
        <button type="button" className="breakdown-sort-button" onClick={() => handleSort(col)}>
          {SORT_COLUMN_LABEL[col]}
          <span aria-hidden="true">{active ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}</span>
        </button>
      </th>
    );
  }

  function renderStatusCell(item: IntegratedBreakdownItem): JSX.Element {
    if (item.kind === 'CHATBOT') {
      if (item.status === 'ARCHIVED') {
        return (
          <span className="status-badge breakdown-archived-badge">
            <span aria-hidden="true">▤</span> {MESSAGES.integratedStats.breakdownArchivedBadge(item.archivedAt ? formatDate(item.archivedAt) : '')}
          </span>
        );
      }
      return <StatusBadge status={item.status} size="sm" />;
    }
    if (item.missing) {
      return (
        <span className="status-badge breakdown-missing-badge">
          <span aria-hidden="true">?</span> {MESSAGES.integratedStats.breakdownMissingGroupBadge}
        </span>
      );
    }
    if (item.archived) {
      return (
        <span className="status-badge breakdown-archived-badge">
          <span aria-hidden="true">▤</span> {MESSAGES.integratedStats.breakdownArchivedGroupBadge}
        </span>
      );
    }
    return <span aria-hidden="true">{MESSAGES.integratedStats.breakdownNoStatusValue}</span>;
  }

  function renderNameCell(item: IntegratedBreakdownItem): JSX.Element {
    if (item.kind === 'GROUP' && item.missing) {
      return <span>{item.id.slice(0, 8)}</span>;
    }
    const hint = item.kind === 'CHATBOT' ? MESSAGES.integratedStats.breakdownRowClickHintChatbot : MESSAGES.integratedStats.breakdownRowClickHintGroup;
    const label = item.name ?? item.id.slice(0, 8);
    return (
      <button type="button" className="link-button breakdown-row-link" onClick={() => onRowClick(item)} aria-label={`${label} — ${hint}`}>
        {label}
      </button>
    );
  }

  const hasRows = sortedItems.length > 0 || Boolean(othersRow) || Boolean(unassignedRow);

  return (
    <section className="sortable-breakdown-table-section">
      <h2>{kind === 'CHATBOT' ? MESSAGES.integratedStats.breakdownTitleGroup : MESSAGES.integratedStats.breakdownTitleAll}</h2>
      <p className="sr-only" role="status" aria-live="polite">
        {announce}
      </p>
      {!hasRows ? (
        <EmptyState title={MESSAGES.integratedStats.breakdownEmptyTitle} />
      ) : (
        <div className="table-scroll-container">
          <table className="chatbot-table breakdown-table">
            <thead>
              <tr>
                {renderSortableHeader('name')}
                <th scope="col">{MESSAGES.integratedStats.breakdownColumnStatus}</th>
                {kind === 'CHATBOT' && <th scope="col">{MESSAGES.integratedStats.breakdownColumnCurrentGroup}</th>}
                {renderSortableHeader('turnCount')}
                {renderSortableHeader('share')}
                {renderSortableHeader('responseRate')}
                {renderSortableHeader('sessionCount')}
                {renderSortableHeader('unansweredCount')}
              </tr>
            </thead>
            <tbody>
              {sortedItems.map((item) => (
                <tr key={item.id}>
                  <th scope="row">{renderNameCell(item)}</th>
                  <td>{renderStatusCell(item)}</td>
                  {kind === 'CHATBOT' && (
                    <td>
                      {item.kind === 'CHATBOT' && item.currentGroupId ? (
                        <span className="breakdown-current-group-badge">
                          <span aria-hidden="true">↷</span> {MESSAGES.integratedStats.breakdownCurrentGroupBadge(item.currentGroupName ?? '')}
                        </span>
                      ) : (
                        <span aria-hidden="true">{MESSAGES.integratedStats.breakdownNoStatusValue}</span>
                      )}
                    </td>
                  )}
                  <td>{item.turnCount.toLocaleString('ko-KR')}</td>
                  <td>{formatPercent(item.share)}</td>
                  <td>{item.turnCount > 0 ? formatPercent(item.responseRate) : MESSAGES.integratedStats.breakdownNoStatusValue}</td>
                  <td>{item.sessionCount.toLocaleString('ko-KR')}</td>
                  <td>{item.unansweredCount.toLocaleString('ko-KR')}</td>
                </tr>
              ))}
              {othersRow && (
                <tr className="breakdown-fixed-row">
                  <th scope="row">{MESSAGES.integratedStats.breakdownOthersRow(othersRow.count)}</th>
                  <td>{MESSAGES.integratedStats.breakdownNoStatusValue}</td>
                  {kind === 'CHATBOT' && <td>{MESSAGES.integratedStats.breakdownNoStatusValue}</td>}
                  <td>{othersRow.turnCount.toLocaleString('ko-KR')}</td>
                  <td>{formatPercent(othersRow.share)}</td>
                  <td>{othersRow.turnCount > 0 ? formatPercent(othersRow.responseRate) : MESSAGES.integratedStats.breakdownNoStatusValue}</td>
                  <td>{othersRow.sessionCount.toLocaleString('ko-KR')}</td>
                  <td>{othersRow.unansweredCount.toLocaleString('ko-KR')}</td>
                </tr>
              )}
              {unassignedRow && (
                <tr className="breakdown-fixed-row">
                  <th scope="row">{MESSAGES.integratedStats.breakdownUnassignedRow}</th>
                  <td>{MESSAGES.integratedStats.breakdownNoStatusValue}</td>
                  {kind === 'CHATBOT' && <td>{MESSAGES.integratedStats.breakdownNoStatusValue}</td>}
                  <td>{unassignedRow.turnCount.toLocaleString('ko-KR')}</td>
                  <td>{formatPercent(unassignedRow.share)}</td>
                  <td>{unassignedRow.turnCount > 0 ? formatPercent(unassignedRow.responseRate) : MESSAGES.integratedStats.breakdownNoStatusValue}</td>
                  <td>{unassignedRow.sessionCount.toLocaleString('ko-KR')}</td>
                  <td>{unassignedRow.unansweredCount.toLocaleString('ko-KR')}</td>
                </tr>
              )}
            </tbody>
          </table>
          {unassignedRow && <p className="field-hint">{MESSAGES.integratedStats.breakdownUnassignedCaption}</p>}
          {kind === 'GROUP' && <p className="field-hint">{MESSAGES.integratedStats.breakdownSessionCaveat}</p>}
        </div>
      )}
    </section>
  );
}
