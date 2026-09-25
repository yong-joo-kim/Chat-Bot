import { Link } from 'react-router-dom';
import type { EnvironmentStatus } from '@chat-bot/shared-types';
import { MESSAGES } from '../constants/messages';

/**
 * 콘솔 공통 헤더 환경 배지(`environment-separation-ui-spec.md` §4.17). 모드 꺼진 챗봇은 렌더하지
 * 않는다(FR-EN4-7). 텍스트만으로 의미를 전달한다(NFR-ENA1 — 색상 단독 금지).
 */
export function EnvironmentHeaderBadge({ chatbotId, status }: { chatbotId: string; status: EnvironmentStatus | null }): JSX.Element | null {
  if (!status || !status.enabled) return null;
  const text = MESSAGES.environment.headerBadge(status.prod.versionNo, status.staging?.versionNo ?? status.prod.versionNo, status.draft.sameAsProd);
  return (
    <Link to={`/chatbots/${chatbotId}/environment`} className="detail-header-environment-badge">
      {text}
    </Link>
  );
}
