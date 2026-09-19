import { MESSAGES } from '../../constants/messages';

/** 변경 없으면 저장 비활성, 저장 중에는 스피너 텍스트 + disabled로 중복 제출을 막는다(UIUX §4). */
export function FormActions({
  dirty,
  saving,
  onCancel,
}: {
  dirty: boolean;
  saving: boolean;
  onCancel: () => void;
}): JSX.Element {
  return (
    <div className="form-actions">
      <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={!dirty || saving}>
        {MESSAGES.common.cancel}
      </button>
      <button type="submit" className="btn btn-primary" disabled={!dirty || saving}>
        {saving ? MESSAGES.common.saving : MESSAGES.common.save}
      </button>
    </div>
  );
}
