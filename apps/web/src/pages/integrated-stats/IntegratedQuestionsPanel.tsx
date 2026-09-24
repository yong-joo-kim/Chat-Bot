import { Link } from 'react-router-dom';
import type { IntegratedQuestionItem, IntegratedQuestions } from '@chat-bot/shared-types';
import { MESSAGES } from '../../constants/messages';

function TopChatbotLine({ item }: { item: IntegratedQuestionItem }): JSX.Element | null {
  if (item.topChatbotId && item.topChatbotName) {
    return (
      <p className="questions-top-chatbot-line">
        {MESSAGES.integratedStats.questionsTopChatbotColumn}:{' '}
        <Link to={`/chatbots/${item.topChatbotId}/stats/overview`}>{MESSAGES.integratedStats.questionsTopChatbotLink(item.topChatbotName)}</Link>
      </p>
    );
  }
  if (item.topChatbotName) {
    return (
      <p className="questions-top-chatbot-line">
        {MESSAGES.integratedStats.questionsTopChatbotColumn}: {item.topChatbotName}
      </p>
    );
  }
  return (
    <p className="questions-top-chatbot-line field-hint">
      {MESSAGES.integratedStats.questionsTopChatbotColumn}: {MESSAGES.integratedStats.questionsNoTopChatbot}
    </p>
  );
}

/**
 * §2.6 — 통합 스코프 질문 순위(`TopQuestionsPanel`과 같은 시각 언어를 공유하는 별도 컴포넌트).
 * `IntegratedQuestionItem`은 `unansweredQuestionId`가 없어 학습현황 딥링크 대신 "최다 챗봇" 링크를 제공한다.
 */
export function IntegratedQuestionsPanel({
  questions,
  includeArchivedChatbots,
  onIncludeArchivedChange,
}: {
  questions: IntegratedQuestions;
  includeArchivedChatbots: boolean;
  onIncludeArchivedChange: (value: boolean) => void;
}): JSX.Element {
  const { topQuestions, topUnansweredQuestions, approximated, candidateLimit } = questions;
  const approxCaption = approximated ? ` ${MESSAGES.stats.approximatedCaption(candidateLimit)}` : '';

  return (
    <div className="integrated-questions-panel-wrap">
      <label className="integrated-questions-toggle">
        <input
          type="checkbox"
          checked={includeArchivedChatbots}
          onChange={(e) => onIncludeArchivedChange(e.target.checked)}
        />
        {MESSAGES.integratedStats.questionsIncludeArchivedLabel}
      </label>
      <section className="top-questions-panel">
        <div className="top-questions-col">
          <h2>
            {MESSAGES.stats.topQuestionsTitle(topQuestions.length)}
            {approxCaption}
          </h2>
          {topQuestions.length === 0 ? (
            <p className="field-hint">{MESSAGES.stats.noDataShort}</p>
          ) : (
            <ol className="top-questions-list">
              {topQuestions.map((q, idx) => (
                <li key={`${q.question}-${idx}`}>
                  {idx + 1}. {q.question} · {MESSAGES.stats.questionCount(q.count)}
                  <TopChatbotLine item={q} />
                </li>
              ))}
            </ol>
          )}
        </div>
        <div className="top-questions-col">
          <h2>
            {MESSAGES.stats.topUnansweredTitle(topUnansweredQuestions.length)}
            {approxCaption}
          </h2>
          {topUnansweredQuestions.length === 0 ? (
            <p className="field-hint">{MESSAGES.stats.noDataShort}</p>
          ) : (
            <ol className="top-questions-list">
              {topUnansweredQuestions.map((q, idx) => (
                <li key={`${q.question}-${idx}`}>
                  {idx + 1}. {q.question} · {MESSAGES.stats.questionCount(q.count)}
                  <TopChatbotLine item={q} />
                </li>
              ))}
            </ol>
          )}
        </div>
      </section>
    </div>
  );
}
