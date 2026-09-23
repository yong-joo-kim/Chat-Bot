import { Link } from 'react-router-dom';
import type { DeployScheduleListItem, Permission } from '@chat-bot/shared-types';
import { DeployScheduleStatusBadge } from '../../../components/DeployScheduleStatusBadge';
import { deployScheduleActionText } from '../../../components/DeployScheduleActionLabel';
import { SeverityBadge } from '../../../components/SeverityBadge';
import { MESSAGES } from '../../../constants/messages';
import { canManageDeploySchedule } from '../../../lib/deploySchedulePermissions';
import { formatScheduleDateTime } from '../../../lib/scheduleTime';
import { useDeployScheduleTimezone } from '../../../lib/useDeployScheduleMeta';

export interface DeployScheduleRowProps {
  item: DeployScheduleListItem;
  /** 전역 목록(S4)에서만 챗봇 이름 열을 함께 표시한다(§3.2 — 컴포넌트는 두 목록에서 재사용). */
  chatbotName?: string;
  /**
   * No.28 리뷰 2라운드 M-3 — 포괄 `canManage: boolean` 대신 `can()`을 그대로 내려받아 이 행의
   * 동작(+enableWebChannel)별 필요 권한으로 판정한다(`VersionRow`가 boolean prop을 받는 것과 달리
   * 행마다 동작이 달라 판정 자체가 행 단위라 함수를 내려받는 쪽이 자연스럽다 — `useAuth()`는 여전히
   * 호출하지 않는다, 기존 leaf 컴포넌트 컨벤션 유지).
   */
  can: (permission: Permission) => boolean;
  onRetry: (item: DeployScheduleListItem) => void;
  onAcknowledge: (item: DeployScheduleListItem) => void;
  onCancel: (item: DeployScheduleListItem) => void;
  detailHref: string;
}

/** S1/S4 공용 목록 1행(`scheduled-deploy-ui-spec.md` §4.1.2/§4.4.1). */
export function DeployScheduleRow({ item, chatbotName, can, onRetry, onAcknowledge, onCancel, detailHref }: DeployScheduleRowProps): JSX.Element {
  const msg = MESSAGES.deploySchedules;
  const reasons = msg.reasons;
  const timezone = useDeployScheduleTimezone();
  const canManage = canManageDeploySchedule(can, item.action, { enableWebChannel: item.enableWebChannel });

  const reasonText = item.status === 'FAILED' && item.failureReason ? reasons.failure[item.failureReason] : item.status === 'HELD' && item.heldReason ? reasons.held[item.heldReason] : undefined;

  return (
    <li className="deploy-schedule-row">
      <div className="deploy-schedule-row-main">
        <DeployScheduleStatusBadge status={item.status} attemptCount={item.attemptCount} outcome={item.outcome} delaySeconds={item.delaySeconds} />
        {item.needsAttention && <SeverityBadge severity="WARNING" label={msg.needsAttentionFlag} />}
        {chatbotName && <span className="deploy-schedule-row-chatbot">{chatbotName}</span>}
        <Link to={detailHref} className="deploy-schedule-row-action-link">
          {deployScheduleActionText({ action: item.action, targetVersionNo: item.targetVersionNo, enableWebChannel: item.enableWebChannel, channelEnabled: item.channelEnabled })}
        </Link>
        <span className="deploy-schedule-row-time">{formatScheduleDateTime(item.scheduledAt, timezone)}</span>
      </div>
      <div className="deploy-schedule-row-meta">
        <span>{item.createdByEmail}</span>
        {item.memo && <span className="deploy-schedule-row-memo">메모: "{item.memo}"</span>}
        {reasonText && <span className="deploy-schedule-row-reason">{reasonText}</span>}
      </div>
      {canManage && (
        <div className="deploy-schedule-row-actions">
          {(item.status === 'FAILED' || item.status === 'MISSED') && (
            <button type="button" className="btn btn-secondary" onClick={() => onRetry(item)}>
              {msg.retryButton}
            </button>
          )}
          {item.needsAttention && (
            <button type="button" className="btn btn-secondary" onClick={() => onAcknowledge(item)}>
              {msg.acknowledgeButton}
            </button>
          )}
          {(item.status === 'PENDING' || item.status === 'HELD') && (
            <button type="button" className="btn btn-secondary" onClick={() => onCancel(item)}>
              {msg.cancelButton}
            </button>
          )}
        </div>
      )}
    </li>
  );
}
