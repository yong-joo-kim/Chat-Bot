import { Link } from 'react-router-dom';
import { ErrorState } from '../../../components/ErrorState';
import { MESSAGES } from '../../../constants/messages';

/** 기능 꺼짐(capability 404) 화면 — 재시도 없이 통계로 돌아가는 링크만(`KbFeatureOffState` 선례, 서버 설정 문제라 재시도로 풀리지 않는다). */
export function UtteranceAnalysisFeatureOffState({ chatbotId }: { chatbotId: string }): JSX.Element {
  const msg = MESSAGES.utteranceAnalysis;
  return (
    <div className="kb-feature-off-state">
      <ErrorState title={msg.featureOffTitle} />
      <p>{msg.featureOffDesc}</p>
      <Link to={`/chatbots/${chatbotId}/stats/overview`} className="btn btn-secondary">
        {msg.featureOffBackLink}
      </Link>
    </div>
  );
}
