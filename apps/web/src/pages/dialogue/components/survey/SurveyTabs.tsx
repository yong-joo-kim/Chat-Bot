import { Link } from 'react-router-dom';
import { MESSAGES } from '../../../../constants/messages';

/** SV2 상단 탭("기본 정보"/"결과") — SV3로 전환(ui-spec §3.2 레이아웃). 신규 생성 중에는 "결과" 비활성. */
export function SurveyTabs({ chatbotId, surveyId, active }: { chatbotId: string; surveyId?: string; active: 'basic' | 'results' }): JSX.Element {
  const msg = MESSAGES.surveys;
  return (
    <div className="tab-nav" role="tablist" aria-label={msg.pageTitle}>
      <span role="tab" aria-selected={active === 'basic'} className={`tab-link${active === 'basic' ? ' tab-link--active' : ''}`}>
        {surveyId ? (
          <Link to={`/chatbots/${chatbotId}/dialogue/surveys/${surveyId}`}>{msg.tabBasic}</Link>
        ) : (
          msg.tabBasic
        )}
      </span>
      <span role="tab" aria-selected={active === 'results'} className={`tab-link${active === 'results' ? ' tab-link--active' : ''}`}>
        {surveyId ? (
          <Link to={`/chatbots/${chatbotId}/dialogue/surveys/${surveyId}/results`}>{msg.tabResults}</Link>
        ) : (
          <span aria-disabled="true">{msg.tabResults}</span>
        )}
      </span>
    </div>
  );
}
