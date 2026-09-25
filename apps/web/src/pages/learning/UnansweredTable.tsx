import { Fragment } from 'react';
import type { IntentSuggestion, ProdReflection, Topic, UnansweredQuestionDetail, UnansweredQuestionListItem, UnansweredQuestionStatus } from '@chat-bot/shared-types';
import { UNANSWERED_STATUS_LABELS, shouldShowRecurredAfterApply } from '@chat-bot/shared-types';
import { MESSAGES } from '../../constants/messages';
import { formatDate, formatRelativeTime } from '../../lib/date';
import { SkeletonRow } from '../../components/Skeleton';
import { ChartFrame } from '../stats/ChartFrame';
import { BarChartSvg, type BarDatum } from '../stats/BarChartSvg';
import { buildTrendSummary } from '../stats/chartSummary';
import { SuggestionSourceBadge } from './ClassifierBadges';
import { topicStatusLabel } from '../dialogue/components/topicBadges';
import { FeedbackSourceBadge, CurrentMatchBadge } from './FeedbackBadges';
import { LastFeedbackAnswerPanel, CounterpartLink, feedbackTargetLabel } from './FeedbackTargetPanels';
import { MarkAddressedButton } from './MarkAddressedButton';

/** [신규 No.22] 추천 의도 토픽 배지 — 값이 없으면(공통) 아무것도 렌더하지 않는다(§3.10). */
function SuggestionTopicBadge({ suggestion, topicsById }: { suggestion: IntentSuggestion; topicsById: Map<string, Topic> }): JSX.Element | null {
  if (!suggestion.topicId) return null;
  const topic = topicsById.get(suggestion.topicId);
  if (!topic) return null;
  return (
    <span className="dialogue-badge dialogue-badge--neutral">
      {MESSAGES.topics.suggestedIntentTopicBadge(topic.name, topicStatusLabel(topic.enabled ? 'ACTIVE' : 'INACTIVE'))}
    </span>
  );
}

const STATUS_ICON: Record<UnansweredQuestionStatus, string> = { PENDING: '●', RESOLVED: '✓', IGNORED: '⊘' };
const STATUS_COLOR: Record<UnansweredQuestionStatus, { bg: string; fg: string }> = {
  PENDING: { bg: '#F3F4F6', fg: '#374151' },
  RESOLVED: { bg: '#DCFCE7', fg: '#166534' },
  IGNORED: { bg: '#F3F4F6', fg: '#6B7280' },
};

/**
 * 색상+아이콘+텍스트 병기(UIUX §1, NFR-A4). [신규 No.44] `resolvedDirectly === true`인 RESOLVED
 * 행만 "반영 완료(직접 수정)"로 라벨을 교체한다(같은 색·아이콘, 새 상태값이 아니라 표시 분기 — §2.1).
 */
function UnansweredStatusBadge({ status, resolvedDirectly }: { status: UnansweredQuestionStatus; resolvedDirectly?: boolean }): JSX.Element {
  const c = STATUS_COLOR[status];
  const label = resolvedDirectly && status === 'RESOLVED' ? MESSAGES.learning.resolvedDirectlyLabel : UNANSWERED_STATUS_LABELS[status];
  return (
    <span className="status-badge status-badge--sm" style={{ backgroundColor: c.bg, color: c.fg }}>
      <span aria-hidden="true">{STATUS_ICON[status]}</span> {label}
    </span>
  );
}

/**
 * FR-15-5 — 반영 후 재발생 신호. [신규 No.40 — §4.16, §15.1] 렌더 조건을
 * `shouldShowRecurredAfterApply()`(shared-types 순수 함수, FE/BE 공용)로 교체했다 — 모드 켜진
 * 챗봇에서는 "운영 미반영" 동안의 재발생을 재유입으로 오표시하지 않는다. 모드 꺼진 챗봇
 * (`item.prodReflection`이 아예 없음)은 함수 내부에서 기존 규칙(`recurredCount > 0`)으로 폴백하므로
 * 동작이 완전히 같다(AC-EN1-1 무회귀).
 */
function RecurredBadge({
  recurredCount,
  lastOccurredAt,
  reflection,
}: {
  recurredCount: number;
  lastOccurredAt: Date;
  reflection?: ProdReflection;
}): JSX.Element | null {
  if (!shouldShowRecurredAfterApply({ recurredCount, lastOccurredAt, reflection })) return null;
  return (
    <span className="recurred-badge">
      <span aria-hidden="true">⚠</span> {MESSAGES.learning.recurredBadge(recurredCount)}
    </span>
  );
}

/** [신규 No.40 — §4.16] "운영 미반영" 배지. `PENDING_SWITCH`일 때만(`REFLECTED`·모드 꺼짐 = 렌더 안 함). */
function ProdReflectionBadge({ reflection }: { reflection?: ProdReflection }): JSX.Element | null {
  if (!reflection || reflection.status !== 'PENDING_SWITCH') return null;
  return (
    <span className="prod-reflection-badge" aria-label={MESSAGES.learning.prodReflectionAriaLabel}>
      <span aria-hidden="true">🕓</span> {MESSAGES.learning.prodReflectionBadge}
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
  onResolveClick: (question: UnansweredQuestionListItem, initialIntentName?: string, currentMatchWarning?: boolean) => void;
  onIgnoreClick: (question: UnansweredQuestionListItem) => void;
  onReopenClick: (question: UnansweredQuestionListItem) => void;
  highlightId?: string;
  /** [신규 No.22] 추천 의도 토픽 배지용(§3.10). */
  topicsById: Map<string, Topic>;
  /** [신규 No.44] 편집 링크·큐 딥링크 구성용(§2.2). */
  chatbotId: string;
  /** [신규 No.44] "직접 수정 완료" — 클릭한 항목 id만 전달한다(§11.3). */
  onMarkAddressedClick: (item: UnansweredQuestionListItem) => void;
  /** [신규 No.44] 요청 진행 중인 항목 id(중복 클릭 방지). */
  markAddressedSubmittingId?: string | null;
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
  topicsById,
  chatbotId,
  onMarkAddressedClick,
  markAddressedSubmittingId,
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
          {/* [신규 No.44] 출처 열(feedback-loop-ui-spec.md §3.3). */}
          <th scope="col">{MESSAGES.learning.columnSource}</th>
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
          const isNegativeFeedback = item.source === 'NEGATIVE_FEEDBACK';
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
                  <RecurredBadge recurredCount={item.recurredCount} lastOccurredAt={item.lastOccurredAt} reflection={item.prodReflection} />
                  <ProdReflectionBadge reflection={item.prodReflection} />
                  {/* [신규 No.44] 목록 단계에서도 원인을 가늠할 수 있게(FR-FB7-2). 답변 본문 자체는 없다. */}
                  {isNegativeFeedback && item.lastFeedbackTarget && (
                    <p className="field-hint negative-feedback-list-target">
                      {MESSAGES.learning.negativeFeedbackAnswerTitle}: {feedbackTargetLabel(item.lastFeedbackTarget)}
                    </p>
                  )}
                </td>
                <td>
                  <FeedbackSourceBadge source={item.source} />
                </td>
                <td>{item.occurredCount}</td>
                <td>{formatDate(item.firstOccurredAt)}</td>
                <td>
                  <time dateTime={new Date(item.lastOccurredAt).toISOString()} title={formatDate(item.lastOccurredAt)}>
                    {formatRelativeTime(item.lastOccurredAt)}
                  </time>
                </td>
                <td>
                  <UnansweredStatusBadge status={item.status} resolvedDirectly={item.resolvedDirectly} />
                </td>
                <td>
                  {topSuggestion ? (
                    <>
                      {topSuggestion.intentName} {topSuggestion.score.toFixed(2)}{' '}
                      {item.lastFeedbackMatchedIntentId === topSuggestion.intentId && <CurrentMatchBadge />}{' '}
                      <SuggestionTopicBadge suggestion={topSuggestion} topicsById={topicsById} />
                    </>
                  ) : (
                    '—'
                  )}
                </td>
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
                  <td colSpan={canWrite ? 10 : 8}>
                    <UnansweredDetailPanel
                      item={item}
                      detail={detailById.get(item.id) ?? null}
                      loading={detailLoadingId === item.id}
                      canWrite={canWrite}
                      onResolveClick={onResolveClick}
                      topicsById={topicsById}
                      chatbotId={chatbotId}
                      onMarkAddressedClick={onMarkAddressedClick}
                      markAddressedSubmittingId={markAddressedSubmittingId}
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
  topicsById,
  chatbotId,
  onMarkAddressedClick,
  markAddressedSubmittingId,
}: {
  item: UnansweredQuestionListItem;
  detail: UnansweredQuestionDetail | null;
  loading: boolean;
  canWrite: boolean;
  onResolveClick: (question: UnansweredQuestionListItem, initialIntentName?: string, currentMatchWarning?: boolean) => void;
  topicsById: Map<string, Topic>;
  chatbotId: string;
  onMarkAddressedClick: (item: UnansweredQuestionListItem) => void;
  markAddressedSubmittingId?: string | null;
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
      {/* [신규 No.44] 부정 평가 전용 확장 — 당시 봇 답변(마스킹본)·매칭 대상(feedback-loop-ui-spec.md §3.3). */}
      {detail.lastFeedback && (
        <LastFeedbackAnswerPanel
          chatbotId={chatbotId}
          botResponse={detail.lastFeedback.botResponse}
          turnAt={detail.lastFeedback.turnAt}
          target={detail.lastFeedback.target}
        />
      )}
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
                {s.intentName} {s.score.toFixed(2)} <SuggestionSourceBadge source={s.source} />{' '}
                {detail.lastFeedback?.matchedIntentId === s.intentId && <CurrentMatchBadge />}{' '}
                <SuggestionTopicBadge suggestion={s} topicsById={topicsById} /> (
                {MESSAGES.learning.suggestionExample(s.matchedExample)})
                {canWrite && item.status === 'PENDING' && (
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => onResolveClick(item, s.intentName, detail.lastFeedback?.matchedIntentId === s.intentId)}
                  >
                    {MESSAGES.learning.suggestionApply}
                  </button>
                )}
                {/* [신규 No.44] 현재 답하고 있는 의도를 다시 선택하면 비차단 경고(FR-FB7-4) — 목록에서 미리 보이고,
                    반영 모달을 열면(§3.3) 모달 상단에도 같은 경고가 다시 뜬다(ResolveModal currentMatchWarning). */}
                {detail.lastFeedback?.matchedIntentId === s.intentId && <p className="field-hint">{MESSAGES.learning.currentMatchWarning}</p>}
              </li>
            ))}
          </ul>
        )}
      </div>
      {/* [신규 No.44] 같은 정규화 질문의 다른 소스 항목(EX-FB-22). */}
      {detail.counterpart && <CounterpartLink chatbotId={chatbotId} counterpart={detail.counterpart} />}
      <div>
        <ChartFrame title={MESSAGES.learning.trendTitle} summary={trendSummary} chart={<BarChartSvg data={trendBars} height={80} />} table={trendTable} />
        {/* [신규 No.44] 부정 평가는 원장 기반 정확 집계 — 기존 근사 캡션 대신 별도 문구(§3.3). */}
        {detail.trendSource === 'FEEDBACK_LEDGER' ? (
          <p className="field-hint">{MESSAGES.learning.trendSourceLedger}</p>
        ) : (
          detail.trendApproximated && <p className="field-hint">{MESSAGES.learning.trendApproxNotice}</p>
        )}
      </div>
      {canWrite && (
        <div className="learning-detail-actions">
          {item.status === 'PENDING' && (
            <button type="button" className="btn btn-primary" onClick={() => onResolveClick(item)}>
              {MESSAGES.learning.resolveAction}
            </button>
          )}
          {/* [신규 No.44] "직접 수정 완료" — NEGATIVE_FEEDBACK ∧ PENDING일 때만 활성(§3.3). */}
          <MarkAddressedButton
            item={item}
            submitting={markAddressedSubmittingId === item.id}
            onClick={() => onMarkAddressedClick(item)}
          />
        </div>
      )}
    </div>
  );
}
