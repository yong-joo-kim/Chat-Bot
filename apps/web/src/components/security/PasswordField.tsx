import { useState } from 'react';
import { MESSAGES } from '../../constants/messages';
import { InlineFieldError } from '../InlineFieldError';

export interface PasswordFieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete?: string;
  errorMessage?: string;
  required?: boolean;
  readOnly?: boolean;
}

/**
 * 표시/숨김 토글 텍스트 버튼(아이콘 단독 금지, NFR-A1). `aria-pressed`로 현재 상태를 알린다
 * (security-audit-ui-spec.md §2.2).
 */
export function PasswordField({
  id,
  label,
  value,
  onChange,
  autoComplete,
  errorMessage,
  required = false,
  readOnly = false,
}: PasswordFieldProps): JSX.Element {
  const [visible, setVisible] = useState(false);
  const errorId = `${id}-error`;

  return (
    <div className="form-field password-field">
      <div className="password-field-label-row">
        <label htmlFor={id}>
          {label} {required && <span className="required-mark" aria-hidden="true">*</span>}
        </label>
        <button type="button" className="link-button" aria-pressed={visible} onClick={() => setVisible((v) => !v)}>
          {visible ? MESSAGES.auth.hidePassword : MESSAGES.auth.showPassword}
        </button>
      </div>
      <input
        id={id}
        type={visible ? 'text' : 'password'}
        value={value}
        readOnly={readOnly}
        autoComplete={autoComplete}
        aria-describedby={errorMessage ? errorId : undefined}
        aria-invalid={Boolean(errorMessage)}
        onChange={(e) => onChange(e.target.value)}
      />
      <InlineFieldError id={errorId} message={errorMessage} />
    </div>
  );
}
