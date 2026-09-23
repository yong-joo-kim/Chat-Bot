import { Link } from 'react-router-dom';
import type { DeployScheduleDetail } from '@chat-bot/shared-types';
import { DEPLOY_SCHEDULE_ACTION_LABELS } from '@chat-bot/shared-types';
import { DeployScheduleStatusBadge } from '../../../components/DeployScheduleStatusBadge';
import { MESSAGES } from '../../../constants/messages';
import { formatScheduleDateTime } from '../../../lib/scheduleTime';

/** 선행/후속 체인 표시(`scheduled-deploy-ui-spec.md` §3.2). `timezone`은 호출부(S2)가 이미 가진 값. */
export function ScheduleChainPanel({ chatbotId, detail, timezone }: { chatbotId: string; detail: DeployScheduleDetail; timezone: string }): JSX.Element {
  const msg = MESSAGES.deploySchedules.detail;
  return (
    <div className="schedule-chain-panel">
      <p>
        {detail.predecessor ? (
          <Link to={`/chatbots/${chatbotId}/deploy-schedules/${detail.predecessor.id}`}>
            {msg.chainPredecessor(formatScheduleDateTime(detail.predecessor.scheduledAt, timezone))} (<DeployScheduleStatusBadge status={detail.predecessor.status} />)
          </Link>
        ) : (
          msg.chainPredecessorNone
        )}
      </p>
      {detail.heldBy && (
        <p>
          <Link to={`/chatbots/${chatbotId}/deploy-schedules/${detail.heldBy.id}`}>
            {DEPLOY_SCHEDULE_ACTION_LABELS[detail.heldBy.action]} · {formatScheduleDateTime(detail.heldBy.scheduledAt, timezone)} ({detail.heldBy.status})
          </Link>
        </p>
      )}
    </div>
  );
}
