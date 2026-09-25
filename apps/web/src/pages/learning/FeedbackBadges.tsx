import type { UnansweredSource } from '@chat-bot/shared-types';
import { MESSAGES } from '../../constants/messages';

/**
 * [신규 No.44] "출처" 배지(feedback-loop-ui-spec.md §2.1) — `UnansweredStatusBadge`(상태)와는 다른 축.
 * 색상+아이콘+텍스트 3중으로 구분한다(UIUX §1, 색상 단독 금지).
 */
export function FeedbackSourceBadge({ source }: { source: UnansweredSource | undefined }): JSX.Element {
  if (source === 'NEGATIVE_FEEDBACK') {
    return (
      <span className="status-badge status-badge--sm feedback-source-badge feedback-source-badge--negative" style={{ backgroundColor: '#FFEDD5', color: '#9A3412' }}>
        <span aria-hidden="true">👎</span> {MESSAGES.learning.sourceBadgeNegativeFeedback}
      </span>
    );
  }
  return (
    <span className="status-badge status-badge--sm feedback-source-badge" style={{ backgroundColor: '#F3F4F6', color: '#374151' }}>
      {MESSAGES.learning.sourceBadgeUnanswered}
    </span>
  );
}

/**
 * [신규 No.44] 추천 후보 중 `lastFeedback.matchedIntentId`(또는 목록의 `lastFeedbackMatchedIntentId`)와
 * 같은 항목에 붙는 "현재 매칭" 배지 — 서버는 비교하지 않는다(콘솔이 클라이언트에서 비교, D-21).
 */
export function CurrentMatchBadge(): JSX.Element {
  return (
    <span className="dialogue-badge current-match-badge" style={{ color: '#1D4ED8' }}>
      <span aria-hidden="true">✓</span> {MESSAGES.learning.currentMatchBadge}
    </span>
  );
}
