import { Link } from 'react-router-dom';
import type { ApiErrorDetail, WorkflowTarget } from '@chat-bot/shared-types';
import { ConfirmDialog } from '../../../components/Modal';
import { MESSAGES } from '../../../constants/messages';

export interface DeleteWorkflowTargetConfirmDialogProps {
  target: WorkflowTarget | null;
  inUseDetails: ApiErrorDetail[] | null;
  submitting: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * WF1 삭제 확인(ui-spec §3.1.2) — No.26 `DeleteApiConnectionConfirmDialog`와 동일한 3단계 패턴
 * (트리거 → 확인 모달 → `409 WORKFLOW_TARGET_IN_USE` 시 참조 목록 배너).
 */
export function DeleteWorkflowTargetConfirmDialog({
  target,
  inUseDetails,
  submitting,
  onConfirm,
  onCancel,
}: DeleteWorkflowTargetConfirmDialogProps): JSX.Element {
  const msg = MESSAGES.workflowTargets;
  return (
    <ConfirmDialog
      isOpen={Boolean(target)}
      title={msg.deleteConfirmTitle}
      description={target ? msg.deleteConfirmDesc(target.name) : ''}
      confirmLabel={MESSAGES.common.delete}
      danger
      onConfirm={onConfirm}
      onCancel={onCancel}
      confirmDisabled={submitting}
    >
      {inUseDetails && inUseDetails.length > 0 && (
        <div className="form-banner form-banner--error" role="alert">
          <p>{msg.deleteInUseBanner(inUseDetails.length)}</p>
          <ul>
            {inUseDetails.map((d, i) =>
              d.chatbotId ? (
                <li key={i}>
                  <Link to={`/chatbots/${d.chatbotId}/dialogue/nodes/${d.field}`}>{d.message}</Link>
                </li>
              ) : (
                <li key={i}>{d.message}</li>
              ),
            )}
          </ul>
        </div>
      )}
      {(!inUseDetails || inUseDetails.length === 0) && <p className="field-hint">{msg.deleteRunningVersionNotice}</p>}
    </ConfirmDialog>
  );
}
