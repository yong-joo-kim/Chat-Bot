import { Fragment } from 'react';
import type { UnansweredQuestionDetail, UnansweredQuestionListItem, UnansweredQuestionStatus } from '@chat-bot/shared-types';
import { UNANSWERED_STATUS_LABELS } from '@chat-bot/shared-types';
import { MESSAGES } from '../../constants/messages';
import { formatDate, formatRelativeTime } from '../../lib/date';
import { SkeletonRow } from '../../components/Skeleton';
import { ChartFrame } from '../stats/ChartFrame';
import { BarChartSvg, type BarDatum } from '../stats/BarChartSvg';
import { buildTrendSummary } from '../stats/chartSummary';

const STATUS_ICON: Record<UnansweredQuestionStatus, string> = { PENDING: '●', RESOLVED: '✓', IGNORED: '⊘' };
const STATUS_COLOR: Record<UnansweredQuestionStatus, { bg: string; fg: string }> = {
  PENDING: { bg: '#F3F4F6', fg: '#374151' },
  RESOLVED: { bg: '#DCFCE7', fg: '#166534' },
  IGNORED: { bg: '#F3F4F6', fg: '#6B7280' },
};

/** 색상+아이콘+텍스트 병기(UIUX §1, NFR-A4). */
function UnansweredStatusBadge({ status }: { status: UnansweredQuestionStatus }): JSX.Element {
  const c = STATUS_COLOR[status];
  return (
    <span className="status-badge status-badge--sm" style={{ backgroundColor: c.bg, color: c.fg }}>
      <span aria-hidden="true">{STATUS_ICON[status]}</span> {UNANSWERED_STATUS_LABELS[status]}
    </span>
  );
}

/** FR-15-5 — 반영 후 재발생 신호. `recurredCount > 0`일 때만 렌더한다. */
function RecurredBadge({ recurredCount }: { recurredCount: number }): JSX.Element | null {
  if (recurredCount <= 0) return null;
  return (
    <span className="recurred-badge">
      <span aria-hidden="true">⚠</span> {MESSAGES.learning.recurredBadge(recurredCount)}
    </span>
  );
}

export interface UnansweredTableProps {
  items: UnansweredQuestionListItem[];
  selected: Set<string>;
  onToggleSelect: (id: string) => void;
  canWrite: boolean;
  expandedId: string | null;
  onToggleExpand: (item: UnansweredQuestionListItem) => void;
  detailById: Map<string, UnansweredQuestionDetail>;
  detailLoadingId: string | null;
  onResolveClick: (question: UnansweredQuestionListItem, initialIntentName?: string) => void;
  onIgnoreClick: (question: UnansweredQuestionListItem) => void;
  onReopenClick: (question: UnansweredQuestionListItem) => void;
  highlightId?: string;
}

/** L1 목록 표(FR-15-12, ui-spec §4.3~4.4). 행 펼침은 `aria-expanded` 버튼으로 Enter/Space 토글된다. */
export function UnansweredTable({
  items,
  selected,
  onToggleSelect,
  canWrite,
  expandedId,
  onToggleExpand,
  detailById,
  detailLoadingId,
  onResolveClick,
  onIgnoreClick,
  onReopenClick,
  highlightId,
}: UnansweredTableProps): JSX.Element {
  return (
    <table className="dialogue-table learning-table">
      <thead>
        <tr>
          {canWrite && (
            <th scope="col">
              <span className="sr-only">{MESSAGES.learning.columnCheckbox}</span>
            </th>
          )}
          <th scope="col">
            <span className="sr-only">{MESSAGES.learning.columnActions} 펼치기</span>
          </th>
          <th scope="col">{MESSAGES.learning.columnQuestion}</th>
          <th scope="col">{MESSAGES.learning.columnOccurred}</th>
          <th scope="col">{MESSAGES.learning.columnFirstOccurred}</th>
          <th scope="col">{MESSAGES.learning.columnLastOccurred}</th>
          <th scope="col">{MESSAGES.learning.columnStatus}</th>
          <th scope="col">{MESSAGES.learning.columnSuggested}</th>
          {canWrite && <th scope="col">{MESSAGES.learning.columnActions}</th>}
        </tr>
      </thead>
      <tbody>
        {items.map((item) => {
          const expanded = expandedId === item.id;
          const topSuggestion = item.suggestions[0];
          return (
            <Fragment key={item.id}>
              <tr className={item.id === highlightId ? 'learning-row--highlight' : undefined}>
                {canWrite && (
                  <td>
                    <input
                      type="checkbox"
                      checked={selected.has(item.id)}
                      onChange={() => onToggleSelect(item.id)}
                      aria-label={`${item.questionText} 선택`}
                    />
                  </td>
                )}
                <td>
                  <button
                    type="button"
                    className="learning-expand-toggle"
                    aria-expanded={expanded}
                    aria-label={expanded ? MESSAGES.learning.collapseLabel(item.questionText) : MESSAGES.learning.expandLabel(item.questionText)}
                    onClick={() => onToggleExpand(item)}
                  >
                    <span aria-hidden="true">{expanded ? '▾' : '▸'}</span>
                  </button>
                </td>
                <td>
                  {item.questionText}
                  <RecurredBadge recurredCount={item.recurredCount} />
                </td>
                <td>{item.occurredCount}</td>
                <td>{formatDate(item.firstOccurredAt)}</td>
                <td>
                  <time dateTime={new Date(item.lastOccurredAt).toISOString()} title={formatDate(item.lastOccurredAt)}>
                    {formatRelativeTime(item.lastOccurredAt)}
                  </time>
                </td>
                <td>
                  <UnansweredStatusBadge status={item.status} />
                </td>
                <td>{topSuggestion ? `${topSuggestion.intentName} ${topSuggestion.score.toFixed(2)}` : '—'}</td>
                {canWrite && (
                  <td className="learning-row-actions">
                    {item.status === 'PENDING' && (
                      <>
                        <button type="button" className="btn btn-primary" onClick={() => onResolveClick(item)}>
                          {MESSAGES.learning.resolveAction}
                        </button>
                        <button type="button" className="btn btn-secondary" onClick={() => onIgnoreClick(item)}>
                          {MESSAGES.learning.ignoreAction}
                        </button>
                      </>
                    )}
                    {item.status !== 'PENDING' && (
                      <button type="button" className="btn btn-secondary" onClick={() => onReopenClick(item)}>
                        {MESSAGES.learning.reopenAction}
                      </button>
                    )}
                  </td>
                )}
              </tr>
              {expanded && (
                <tr>
                  <td colSpan={canWrite ? 9 : 7}>
                    <UnansweredDetailPanel
                      item={item}
                      detail={detailById.get(item.id) ?? null}
                      loading={detailLoadingId === item.id}
                      canWrite={canWrite}
                      onResolveClick={onResolveClick}
                    />
                  </td>
                </tr>
              )}
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}

function UnansweredDetailPanel({
  item,
  detail,
  loading,
  canWrite,
  onResolveClick,
}: {
  item: UnansweredQuestionListItem;
  detail: UnansweredQuestionDetail | null;
  loading: boolean;
  canWrite: boolean;
  onResolveClick: (question: UnansweredQuestionListItem, initialIntentName?: string) => void;
}): JSX.Element {
  if (loading || !detail) {
    return <SkeletonRow />;
  }

  const trendValues = detail.trend.map((t) => t.count);
  const trendSummary = buildTrendSummary(trendValues, '미응답 발생 건수', (v) => `${v}건`);
  const trendBars: BarDatum[] = detail.trend.map((t) => ({
    key: t.dayBucket,
    label: t.dayBucket,
    segments: [{ value: t.count, className: 'bar-segment--single' }],
  }));
  const trendTable = (
    <table className="chart-frame-data-table">
      <thead>
        <tr>
          <th scope="col">일자</th>
          <th scope="col">발생 건수</th>
        </tr>
      </thead>
      <tbody>
        {detail.trend.map((t) => (
          <tr key={t.dayBucket}>
            <th scope="row">{t.dayBucket}</th>
            <td>{t.count}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  return (
    <div className="learning-detail-panel">
      <div>
        <h4>{MESSAGES.learning.variantsTitle}</h4>
        <p>{detail.variants.length > 0 ? detail.variants.join(' / ') : '—'}</p>
      </div>
      <div>
        <h4>{MESSAGES.learning.suggestionsTitle}</h4>
        {detail.suggestions.length === 0 ? (
          <p>{MESSAGES.learning.suggestionsEmpty}</p>
        ) : (
          <ul className="suggestion-list">
            {detail.suggestions.map((s) => (
              <li key={s.intentId}>
                {s.intentName} {s.score.toFixed(2)} ({MESSAGES.learning.suggestionExample(s.matchedExample)})
                {canWrite && item.status === 'PENDING' && (
                  <button type="button" className="btn btn-secondary" onClick={() => onResolveClick(item, s.intentName)}>
                    {MESSAGES.learning.suggestionApply}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div>
        <ChartFrame title={MESSAGES.learning.trendTitle} summary={trendSummary} chart={<BarChartSvg data={trendBars} height={80} />} table={trendTable} />
        {detail.trendApproximated && <p className="field-hint">{MESSAGES.learning.trendApproxNotice}</p>}
      </div>
      {canWrite && item.status === 'PENDING' && (
        <div className="learning-detail-actions">
          <button type="button" className="btn btn-primary" onClick={() => onResolveClick(item)}>
            {MESSAGES.learning.resolveAction}
          </button>
        </div>
      )}
    </div>
  );
}
