import { useNavigate } from 'react-router-dom';
import { AttentionCountBadge } from '../../components/AttentionCountBadge';

/** E5 — 챗봇 목록 "확인 필요" 셀(`scheduled-deploy-ui-spec.md` §4.6.3). 0건이면 빈칸. */
export function NeedsAttentionBadgeCell({ chatbotId, count }: { chatbotId: string; count: number }): JSX.Element | null {
  const navigate = useNavigate();
  if (count === 0) return null;
  return (
    <button
      type="button"
      className="needs-attention-badge-cell-button"
      onClick={() => navigate(`/chatbots/${chatbotId}/deploy-schedules?needsAttention=true`)}
    >
      <AttentionCountBadge count={count} />
    </button>
  );
}
