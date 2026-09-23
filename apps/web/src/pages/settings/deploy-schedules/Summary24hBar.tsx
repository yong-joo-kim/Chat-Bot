import { Link } from 'react-router-dom';
import type { DeployScheduleSummary } from '@chat-bot/shared-types';
import { SkeletonBlock } from '../../../components/Skeleton';
import { MESSAGES } from '../../../constants/messages';
import { formatScheduleDateTime } from '../../../lib/scheduleTime';
import { useDeployScheduleTimezone } from '../../../lib/useDeployScheduleMeta';

/** S4 상단 — 24시간 요약 + 확인 필요 챗봇별 목록(`scheduled-deploy-ui-spec.md` §4.4.1). */
export function Summary24hBar({ summary, loading }: { summary: DeployScheduleSummary | null; loading: boolean }): JSX.Element {
  const msg = MESSAGES.deploySchedules.summary;
  const timezone = useDeployScheduleTimezone();
  if (loading || !summary) return <SkeletonBlock height={48} />;

  const shown = summary.needsAttention.byChatbot.slice(0, 5);
  const restCount = summary.needsAttention.byChatbot.length - shown.length;

  return (
    <div className="summary-24h-bar">
      <p>
        {msg.last24hText(summary.last24h.succeeded, summary.last24h.failed, summary.last24h.missed)} {msg.generatedAt(formatScheduleDateTime(summary.generatedAt, timezone))}
      </p>
      <p>
        {msg.needsAttentionText(summary.needsAttention.total)}{' '}
        {shown.map((c, i) => (
          <span key={c.chatbotId}>
            <Link to={`/chatbots/${c.chatbotId}/deploy-schedules?needsAttention=true`}>
              {c.chatbotName} {c.count}
            </Link>
            {i < shown.length - 1 ? ' · ' : ''}
          </span>
        ))}
        {restCount > 0 && ` ${msg.moreChatbots(restCount)}`}
      </p>
    </div>
  );
}
