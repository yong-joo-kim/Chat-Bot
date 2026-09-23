import { useState } from 'react';
import { ApiError } from '../../../../api/client';
import { testCasesApi } from '../../../../api/validation';
import { ConfirmDialog } from '../../../../components/Modal';
import { useToast } from '../../../../components/Toast';
import { MESSAGES } from '../../../../constants/messages';

/** `UNRESOLVED` TC 일괄 비활성(ui-spec §4.4.1, S-4). `UnresolvedGroupPanel` 안에서 호출된다. */
export function TestCaseBulkDisableButton({
  chatbotId,
  setId,
  caseIds,
  onDone,
}: {
  chatbotId: string;
  setId: string;
  caseIds: string[];
  onDone: () => void;
}): JSX.Element {
  const msg = MESSAGES.validation.bulkDisable;
  const { showToast } = useToast();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function handleConfirm(): Promise<void> {
    setBusy(true);
    try {
      const res = await testCasesApi.bulkDisable(chatbotId, setId, { caseIds });
      showToast(msg.success(res.updated));
      setConfirmOpen(false);
      onDone();
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : MESSAGES.errors.generic);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" className="btn btn-secondary" onClick={() => setConfirmOpen(true)}>
        {msg.button}
      </button>
      <ConfirmDialog
        isOpen={confirmOpen}
        title={msg.confirmTitle}
        description={msg.confirmDesc(caseIds.length)}
        confirmLabel={msg.button}
        confirmDisabled={busy}
        onConfirm={handleConfirm}
        onCancel={() => setConfirmOpen(false)}
      />
    </>
  );
}
