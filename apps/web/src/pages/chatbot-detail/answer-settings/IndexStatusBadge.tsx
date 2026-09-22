import type { EmbeddingIndexStatus } from '@chat-bot/shared-types';
import { MESSAGES } from '../../../constants/messages';

/** 색인 상태 배지(4상태 + `staleModel`, ui-spec §4.1.2). 판정 우선순위는 표 순서 그대로다. */
export function IndexStatusBadge({ status }: { status: EmbeddingIndexStatus }): JSX.Element {
  const msg = MESSAGES.answerSettings.semantic.indexStatusLabel;

  let icon = '🟢';
  let label = msg.fresh(status.indexed, status.totalTargets);
  if (status.staleModel) {
    icon = '🔴';
    label = msg.staleModel;
  } else if (!status.providerHealthy) {
    icon = '🟡';
    label = msg.unhealthy;
  } else if (status.failed > 0) {
    icon = '🟡';
    label = msg.failed(status.failed);
  } else if (status.pending > 0) {
    icon = '🔵';
    label = msg.pending(status.pending);
  }

  return (
    <span className="index-status-badge">
      <span aria-hidden="true">{icon}</span> {label}
    </span>
  );
}
