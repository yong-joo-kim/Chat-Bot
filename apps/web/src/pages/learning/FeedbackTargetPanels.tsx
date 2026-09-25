import { Link } from 'react-router-dom';
import type { FeedbackTargetRef, UnansweredSource, UnansweredQuestionStatus } from '@chat-bot/shared-types';
import { UNANSWERED_STATUS_LABELS, UNANSWERED_SOURCE_LABELS } from '@chat-bot/shared-types';
import { MESSAGES } from '../../constants/messages';
import { formatDateTime } from '../../lib/date';

/** [신규 No.44] 답변 대상 유형 라벨(`FeedbackTargetRef.kind`) — `feedback-loop-ui-spec.md` §2.2 공용. */
function targetKindLabel(kind: FeedbackTargetRef['kind']): string {
  return MESSAGES.stats.feedbackTargetKind[kind] ?? kind;
}

/**
 * [신규 No.44] FAQ/노드/의도면 해당 편집 화면 href 링크. RAG·폴백·연동 안내·기타·삭제됨이면 링크 없음
 * (FR-FB7-7, feedback-loop-ui-spec.md §2.2).
 */
export function FeedbackTargetEditLink({ chatbotId, target }: { chatbotId: string; target: FeedbackTargetRef }): JSX.Element | null {
  if (target.deleted || !target.id) return null;
  switch (target.kind) {
    case 'FAQ':
      return <Link to={`/chatbots/${chatbotId}/dialogue/faqs?edit=${target.id}`}>{MESSAGES.learning.targetEditLinkFaq}</Link>;
    case 'NODE':
      return <Link to={`/chatbots/${chatbotId}/dialogue/nodes/${target.id}`}>{MESSAGES.learning.targetEditLinkNode}</Link>;
    case 'INTENT':
      return (
        <Link to={`/chatbots/${chatbotId}/dialogue/intents?resource=intent&edit=${target.id}`}>{MESSAGES.learning.targetEditLinkIntent}</Link>
      );
    default:
      return null;
  }
}

/** [신규 No.44] 답변 대상 표시 텍스트 — "FAQ '환불 안내'" 또는 삭제됨. */
export function feedbackTargetLabel(target: FeedbackTargetRef): string {
  if (target.deleted || !target.name) return `${targetKindLabel(target.kind)} · ${MESSAGES.learning.targetDeletedLabel}`;
  return MESSAGES.learning.lastFeedbackTargetPrefix(targetKindLabel(target.kind), target.name);
}

/**
 * [신규 No.44] FB-L1D — "당시 봇 답변" 인용 블록 + 매칭 대상 유형·이름(feedback-loop-ui-spec.md §3.3).
 * `botResponse`는 이미 마스킹본·2,000자 절단 상태로 서버가 내려준다(추가 가공 없음).
 */
export function LastFeedbackAnswerPanel({
  chatbotId,
  botResponse,
  turnAt,
  target,
}: {
  chatbotId: string;
  botResponse: string;
  turnAt: string | Date;
  target: FeedbackTargetRef;
}): JSX.Element {
  return (
    <div className="last-feedback-answer-panel">
      <h4>{MESSAGES.learning.lastFeedbackAnswerTitle}</h4>
      <p className="last-feedback-answer-text">
        &ldquo;{botResponse}&rdquo; ({feedbackTargetLabel(target)})
        {' '}
        <FeedbackTargetEditLink chatbotId={chatbotId} target={target} />
      </p>
      <p className="field-hint">{formatDateTime(turnAt)}</p>
    </div>
  );
}

/**
 * [신규 No.44] FB-L1D — "같은 질문의 {소스} 항목({상태}) →" 링크(FR-FB7-5, EX-FB-22). 클릭 시 L1을
 * 그 항목으로 필터+하이라이트 이동한다(기존 `highlightId` 쿼리 패턴 재사용).
 */
export function CounterpartLink({
  chatbotId,
  counterpart,
}: {
  chatbotId: string;
  counterpart: { id: string; source: UnansweredSource; status: UnansweredQuestionStatus };
}): JSX.Element {
  const sourceLabel = UNANSWERED_SOURCE_LABELS[counterpart.source];
  const statusLabel = UNANSWERED_STATUS_LABELS[counterpart.status];
  return (
    <p className="counterpart-link">
      <Link to={`/chatbots/${chatbotId}/stats/learning?highlightId=${counterpart.id}`}>
        {MESSAGES.learning.counterpartLink(sourceLabel, statusLabel)}
      </Link>
    </p>
  );
}
