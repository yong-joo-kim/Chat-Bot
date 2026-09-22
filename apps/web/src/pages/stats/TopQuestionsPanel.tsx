import { Link } from 'react-router-dom';
import type { StatsQuestions } from '@chat-bot/shared-types';
import { MESSAGES } from '../../constants/messages';

/** S1 질문순위(FR-14-23~27). 미응답 순위의 각 행은 학습현황 큐 항목으로 이동하는 딥링크를 갖는다(있을 때만). */
export function TopQuestionsPanel({ chatbotId, questions }: { chatbotId: string; questions: StatsQuestions }): JSX.Element {
  const { topQuestions, topUnansweredQuestions, approximated, candidateLimit } = questions;
  const approxCaption = approximated ? ` ${MESSAGES.stats.approximatedCaption(candidateLimit)}` : '';

  return (
    <section className="top-questions-panel">
      <div className="top-questions-col">
        <h2>
          {MESSAGES.stats.topQuestionsTitle(topQuestions.length)}
          {approxCaption}
        </h2>
        {topQuestions.length === 0 ? (
          <p className="field-hint">데이터가 없습니다.</p>
        ) : (
          <ol className="top-questions-list">
            {topQuestions.map((q, idx) => (
              <li key={`${q.question}-${idx}`}>
                {idx + 1}. {q.question} · {MESSAGES.stats.questionCount(q.count)}
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
          <p className="field-hint">데이터가 없습니다.</p>
        ) : (
          <ol className="top-questions-list">
            {topUnansweredQuestions.map((q, idx) => (
              <li key={`${q.question}-${idx}`}>
                {idx + 1}. {q.question} · {MESSAGES.stats.questionCount(q.count)}
                {q.unansweredQuestionId && (
                  <>
                    {' '}
                    <Link to={`/chatbots/${chatbotId}/stats/learning?highlightId=${q.unansweredQuestionId}`}>
                      {MESSAGES.stats.goToUnanswered}
                    </Link>
                  </>
                )}
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}
