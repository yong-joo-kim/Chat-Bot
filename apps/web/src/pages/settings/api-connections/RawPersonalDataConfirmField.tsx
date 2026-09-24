import { InlineFieldError } from '../../../components/InlineFieldError';
import { MESSAGES } from '../../../constants/messages';

export interface RawPersonalDataConfirmFieldProps {
  connectionName: string;
  value: string;
  onChange: (value: string) => void;
}

/**
 * `allowRawPersonalData`를 켤 때만 노출된다(ui-spec §2.2). `PermanentDeleteModal`의 확인문구
 * 재입력 패턴과 동일 — 값이 연결 이름과 다르면 저장 버튼을 막는다(부모가 `aria-disabled` 처리).
 */
export function RawPersonalDataConfirmField({ connectionName, value, onChange }: RawPersonalDataConfirmFieldProps): JSX.Element {
  const msg = MESSAGES.apiConnections;
  const mismatch = value.length > 0 && value !== connectionName;
  return (
    <div className="form-field">
      <label htmlFor="api-connection-confirm-raw">{msg.confirmRawPersonalDataLabel}</label>
      <input
        id="api-connection-confirm-raw"
        type="text"
        maxLength={200}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={mismatch}
      />
      <InlineFieldError id="api-connection-confirm-raw-error" message={mismatch ? msg.confirmRawPersonalDataMismatch : undefined} />
    </div>
  );
}
