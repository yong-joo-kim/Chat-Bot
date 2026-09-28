import type { KbAuth } from '@chat-bot/shared-types';
import { InlineFieldError } from '../../../components/InlineFieldError';
import { MESSAGES } from '../../../constants/messages';

export interface KbAuthFieldProps {
  value: KbAuth;
  onChange: (value: KbAuth) => void;
  disabled?: boolean;
  headerNameError?: string;
  secretRefError?: string;
}

/**
 * [신규 No.43] 인증 선택(`kb-crawling-ui-spec.md` §2.2 `KbAuthField`) — "인증 없음"/"고정 헤더" 라디오.
 * 고정 헤더 선택 시 헤더 이름 + **비밀 참조 이름**(값 아님) 입력을 보여준다. 실제 비밀 값 입력란은
 * 이 화면 어디에도 없다(No.26 방식 그대로).
 */
export function KbAuthField({ value, onChange, disabled, headerNameError, secretRefError }: KbAuthFieldProps): JSX.Element {
  const msg = MESSAGES.kbSources;
  return (
    <fieldset className="form-field">
      <legend>{msg.formAuthLabel}</legend>
      <label className="form-field--inline">
        <input type="radio" name="kb-auth-kind" checked={value.kind === 'NONE'} disabled={disabled} onChange={() => onChange({ kind: 'NONE' })} />
        {msg.authLabel.NONE}
      </label>
      <label className="form-field--inline">
        <input
          type="radio"
          name="kb-auth-kind"
          checked={value.kind === 'STATIC_HEADER'}
          disabled={disabled}
          onChange={() => onChange({ kind: 'STATIC_HEADER', headerName: value.kind === 'STATIC_HEADER' ? value.headerName : '', secretRef: value.kind === 'STATIC_HEADER' ? value.secretRef : '' })}
        />
        {msg.authLabel.STATIC_HEADER}
      </label>
      {value.kind === 'STATIC_HEADER' && (
        <>
          <div className="form-field">
            <label htmlFor="kb-auth-header-name">{msg.formAuthHeaderNameLabel}</label>
            <input
              id="kb-auth-header-name"
              type="text"
              maxLength={64}
              disabled={disabled}
              value={value.headerName}
              aria-invalid={Boolean(headerNameError)}
              onChange={(e) => onChange({ kind: 'STATIC_HEADER', headerName: e.target.value, secretRef: value.secretRef })}
            />
            <InlineFieldError id="kb-auth-header-name-error" message={headerNameError} />
          </div>
          <div className="form-field">
            <label htmlFor="kb-auth-secret-ref">{msg.formAuthSecretRefLabel}</label>
            <input
              id="kb-auth-secret-ref"
              type="text"
              maxLength={64}
              disabled={disabled}
              value={value.secretRef}
              aria-invalid={Boolean(secretRefError)}
              onChange={(e) => onChange({ kind: 'STATIC_HEADER', headerName: value.headerName, secretRef: e.target.value.toUpperCase() })}
            />
            <p className="field-hint">{msg.formAuthSecretRefHelp(value.secretRef)}</p>
            <InlineFieldError id="kb-auth-secret-ref-error" message={secretRefError} />
          </div>
        </>
      )}
    </fieldset>
  );
}
