import { Link } from 'react-router-dom';
import type { ApiConnectionListItem, ApiErrorDetail } from '@chat-bot/shared-types';
import { ConfirmDialog } from '../../../components/Modal';
import { MESSAGES } from '../../../constants/messages';

export interface DeleteApiConnectionConfirmDialogProps {
  connection: ApiConnectionListItem | null;
  inUseDetails: ApiErrorDetail[] | null;
  submitting: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * AC1 삭제 확인(ui-spec §3.1.2). `dialogue-design-ui-spec.md` §4.3.2와 동일한 3단계 패턴 —
 * `409 API_CONNECTION_IN_USE` 시 모달 내 배너로 상위 5건을 나열한다. `details[].chatbotId`가 있으면
 * `{챗봇명} › {노드명}` 텍스트(`message`)를 해당 노드 편집 화면 링크(`field`=nodeId)로 만든다
 * (1차 코드리뷰 반영 — 서버가 `chatbotId`를 채워 보내도록 계약이 확장됨).
 */
export function DeleteApiConnectionConfirmDialog({
  connection,
  inUseDetails,
  submitting,
  onConfirm,
  onCancel,
}: DeleteApiConnectionConfirmDialogProps): JSX.Element {
  const msg = MESSAGES.apiConnections;
  return (
    <ConfirmDialog
      isOpen={Boolean(connection)}
      title={msg.deleteConfirmTitle}
      description={connection ? msg.deleteConfirmDesc(connection.name) : ''}
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
    </ConfirmDialog>
  );
}
