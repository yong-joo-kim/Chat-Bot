import type { KbSourceListItem } from '@chat-bot/shared-types';
import { ConfirmDialog } from '../../../components/Modal';
import { MESSAGES } from '../../../constants/messages';

export interface DeleteKbSourceConfirmDialogProps {
  source: KbSourceListItem | null;
  submitting: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** KB7 — 소스 삭제 확인 다이얼로그(`kb-crawling-ui-spec.md` §3.6). 외부 RAG 문서는 지워지지 않는다는 안내를 항상 포함한다(AC-KB7-4). */
export function DeleteKbSourceConfirmDialog({ source, submitting, onConfirm, onCancel }: DeleteKbSourceConfirmDialogProps): JSX.Element {
  const msg = MESSAGES.kbSources;
  return (
    <ConfirmDialog
      isOpen={Boolean(source)}
      title={msg.deleteConfirmTitle}
      description={source ? msg.deleteConfirmBody(source.name) : ''}
      confirmLabel={MESSAGES.common.delete}
      danger
      onConfirm={onConfirm}
      onCancel={onCancel}
      confirmDisabled={submitting}
    >
      <p className="field-hint field-hint--warning">
        <span aria-hidden="true">⚠</span> {msg.deleteConfirmExternalNotice}
      </p>
    </ConfirmDialog>
  );
}
