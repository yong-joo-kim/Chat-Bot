import { CopyButton } from '../CopyButton';
import { MESSAGES } from '../../constants/messages';

/**
 * 임시 비밀번호 1회 노출(security-audit-ui-spec.md §2.2). "확인했습니다" 버튼을 눌러야만
 * 닫히는 모달의 **본문**이다 — 모달 자체(Esc/배경클릭 비활성)는 호출부(`Modal` + `closeOnEsc=false`
 * + 배경 클릭 무시)가 구성한다.
 */
export function TemporaryPasswordReveal({
  title,
  temporaryPassword,
  onAcknowledge,
  notice,
}: {
  title: string;
  temporaryPassword: string;
  onAcknowledge: () => void;
  notice?: string;
}): JSX.Element {
  return (
    <div className="temporary-password-reveal">
      <p>{title}</p>
      <div className="form-field">
        <label htmlFor="temporary-password-value">{MESSAGES.users.temporaryPasswordLabel}</label>
        <div className="public-url-row">
          <input id="temporary-password-value" type="text" readOnly value={temporaryPassword} className="public-url-text" />
          <CopyButton text={temporaryPassword} />
        </div>
      </div>
      <p className="form-banner form-banner--info">
        <span aria-hidden="true">⚠</span> {MESSAGES.users.temporaryPasswordWarning}
      </p>
      {notice && <p className="field-hint">{notice}</p>}
      <div className="modal-actions">
        <button type="button" className="btn btn-primary" onClick={onAcknowledge}>
          {MESSAGES.users.temporaryPasswordAcknowledge}
        </button>
      </div>
      <p className="field-hint temporary-password-reason">{MESSAGES.users.temporaryPasswordAcknowledgeReason}</p>
    </div>
  );
}
