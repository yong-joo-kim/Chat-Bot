import type { DeployScheduleAction } from '@chat-bot/shared-types';
import { MESSAGES } from '../constants/messages';

export interface DeployScheduleActionLabelProps {
  action: DeployScheduleAction;
  targetVersionNo?: number | null;
  enableWebChannel?: boolean | null;
  channelEnabled?: boolean | null;
}

/** 동작 3종 라벨(`scheduled-deploy-ui-spec.md` §3.3-(2)). */
export function deployScheduleActionText({ action, targetVersionNo, enableWebChannel, channelEnabled }: DeployScheduleActionLabelProps): string {
  const msg = MESSAGES.deploySchedules.actionLabel;
  if (action === 'RESTORE_VERSION') return msg.RESTORE_VERSION(targetVersionNo ?? null);
  if (action === 'PUBLISH') return enableWebChannel ? msg.PUBLISH_WITH_CHANNEL : msg.PUBLISH;
  return channelEnabled ? msg.SET_WEB_CHANNEL_OPEN : msg.SET_WEB_CHANNEL_CLOSE;
}

export function DeployScheduleActionLabel(props: DeployScheduleActionLabelProps): JSX.Element {
  return <span className="deploy-schedule-action-label">{deployScheduleActionText(props)}</span>;
}
