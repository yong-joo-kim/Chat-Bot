import { CHATBOT_STATUS_TRANSITIONS, type ChatbotStatus } from '@chat-bot/shared-types';
import { MESSAGES } from '../../constants/messages';

export interface StatusTransitionControlsProps {
  status: ChatbotStatus;
  onActivate: () => void;
  onArchiveRequest: () => void;
  onRestore: () => void;
}

/**
 * 상태 전이 버튼 3종(FR-1-17, AC-1-13, ui-spec §5).
 * `CHATBOT_STATUS_TRANSITIONS` 공용 상수로 허용 여부를 선제 판단해 불필요한 400 요청을 줄인다.
 */
export function StatusTransitionControls({
  status,
  onActivate,
  onArchiveRequest,
  onRestore,
}: StatusTransitionControlsProps): JSX.Element {
  const allowed = CHATBOT_STATUS_TRANSITIONS[status];
  const canActivate = status !== 'ACTIVE' && allowed.includes('ACTIVE');
  const canArchive = status !== 'ARCHIVED' && allowed.includes('ARCHIVED');
  const canRestore = status !== 'DRAFT' && allowed.includes('DRAFT');

  const activateTitle = status === 'ACTIVE' ? undefined : status === 'ARCHIVED' ? MESSAGES.detail.activateFromArchivedTooltip : undefined;
  const restoreTitle = status === 'ACTIVE' ? MESSAGES.detail.archivedTooltip : undefined;

  return (
    <div className="status-transition-controls">
      <button type="button" className="btn btn-secondary" disabled={!canActivate} title={activateTitle} onClick={onActivate}>
        {MESSAGES.detail.activate}
      </button>
      <button type="button" className="btn btn-secondary" disabled={!canArchive} onClick={onArchiveRequest}>
        {MESSAGES.detail.archive}
      </button>
      <button type="button" className="btn btn-secondary" disabled={!canRestore} title={restoreTitle} onClick={onRestore}>
        {MESSAGES.detail.restoreToDraft}
      </button>
    </div>
  );
}
