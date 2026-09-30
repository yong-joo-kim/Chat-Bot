import { NavLink } from 'react-router-dom';
import { useAuth } from '../../../context/AuthContext';
import { MESSAGES } from '../../../constants/messages';
import { useUtteranceCapability } from './useUtteranceCapability';

type NavClassName = (p: { isActive: boolean }) => string;

function Inner({ chatbotId, className }: { chatbotId: string; className: NavClassName }): JSX.Element | null {
  const { state } = useUtteranceCapability(chatbotId);
  // 조회 중·기능 꺼짐(404)은 링크를 숨긴다. 그 밖의 실패는 링크를 보이고 페이지에서 오류를 처리한다(§1.2).
  if (state.status === 'loading' || state.status === 'off') return null;
  return (
    <NavLink to={`/chatbots/${chatbotId}/stats/utterance-analyses`} className={className}>
      {MESSAGES.utteranceAnalysis.navLabel}
    </NavLink>
  );
}

/** 통계 서브내비 4번째 링크(`deep-clustering-ui-spec.md` §1.2) — `dialogue:read` ∧ 기능 켜짐일 때만 보인다. */
export function UtteranceAnalysisNavLink({ chatbotId, className }: { chatbotId: string; className: NavClassName }): JSX.Element | null {
  const { can } = useAuth();
  if (!can('dialogue:read')) return null;
  return <Inner chatbotId={chatbotId} className={className} />;
}
