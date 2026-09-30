import { useCallback, useEffect, useRef, useState } from 'react';
import { ConfirmDialog } from '../../../components/Modal';
import { ApiError } from '../../../api/client';
import { utteranceAnalysesApi } from '../../../api/utteranceAnalyses';
import { MESSAGES } from '../../../constants/messages';

export interface DeleteAnalysisTarget {
  id: string;
  fileName: string;
}

export interface DeleteAnalysisDialogProps {
  chatbotId: string;
  target: DeleteAnalysisTarget | null;
  onClose: () => void;
  /** 삭제 성공(204). */
  onDeleted: (id: string) => void;
  /** 이미 없는 분석(404) — 호출부가 목록을 다시 읽거나 목록 화면으로 이동한다. */
  onGone: () => void;
}

/**
 * 분석 삭제 확인(UA-3b, §5.8) — 목록 행·상세 머리가 함께 쓴다. 기본 포커스는 "취소", 진행 중에는 확정 버튼이
 * `disabled`가 되어 중복 실행을 막는다. `Modal`은 `onCancel`이 바뀌면 포커스를 다시 잡으므로 콜백을 안정화한다.
 */
export function DeleteAnalysisDialog({ chatbotId, target, onClose, onDeleted, onGone }: DeleteAnalysisDialogProps): JSX.Element | null {
  const msg = MESSAGES.utteranceAnalysis;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busyRef = useRef(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    setError(null);
    busyRef.current = false;
    setBusy(false);
  }, [target?.id]);

  const handleCancel = useCallback((): void => {
    if (!busyRef.current) onCloseRef.current();
  }, []);

  async function handleConfirm(): Promise<void> {
    if (!target || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      await utteranceAnalysesApi.remove(chatbotId, target.id);
      onDeleted(target.id);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) {
        setError(msg.deleteGone);
        onGone();
      } else if (e instanceof ApiError && e.status === 409 && e.code === 'CHATBOT_ARCHIVED') {
        setError(msg.errors.CHATBOT_ARCHIVED);
      } else if (e instanceof ApiError && e.status === 409) {
        // 코드는 처리 중 삭제와 같은 INVALID_STATUS_TRANSITION이고 메시지만 다르다 — 취소 정리 중이면 전용 문구.
        setError(e.message.includes('취소를 정리하는 중') ? msg.deleteCleaningUp : msg.deleteInvalidStatus);
      } else if (e instanceof ApiError && e.status === 403) {
        setError(msg.forbiddenWrite);
      } else {
        setError(msg.genericError);
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  return (
    <ConfirmDialog
      isOpen={target !== null}
      title={msg.deleteConfirmTitle}
      description={msg.deleteConfirmDesc}
      confirmLabel={busy ? msg.deleteInProgress : msg.deleteAction}
      cancelLabel={msg.deleteConfirmCancel}
      danger
      confirmDisabled={busy}
      onConfirm={() => void handleConfirm()}
      onCancel={handleCancel}
    >
      {error && (
        <p className="field-error" role="alert">
          <span aria-hidden="true">⚠</span> {error}
        </p>
      )}
    </ConfirmDialog>
  );
}
