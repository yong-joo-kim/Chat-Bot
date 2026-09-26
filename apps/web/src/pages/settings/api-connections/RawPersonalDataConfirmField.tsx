import { InlineFieldError } from '../../../components/InlineFieldError';

export interface RawPersonalDataConfirmFieldProps {
  /** DOM id 접두어(예: `api-connection` · `workflow-target`) — 화면마다 유일해야 한다. */
  idPrefix: string;
  /** 확인 재입력이 일치해야 하는 대상 이름(연결 이름 · 발송 대상 이름 등). */
  entityName: string;
  value: string;
  onChange: (value: string) => void;
  /** 라벨 문구(화면별 `MESSAGES` 네임스페이스에서 주입) — 예: "원문 송신을 켜려면 연결 이름을 다시 입력하세요". */
  label: string;
  /** 불일치 인라인 오류 문구(화면별 `MESSAGES` 네임스페이스에서 주입). */
  mismatchMessage: string;
}

/**
 * [No.26 → 코드리뷰 R1 M-2 일반화] `allowRawPersonalData`류 토글을 켤 때만 노출되는 확인 재입력
 * 필드(ui-spec §2.2) — `PermanentDeleteModal`의 확인문구 재입력 패턴과 동일. 값이 대상 이름과 다르면
 * 저장 버튼을 막는다(부모가 `aria-disabled` 처리). No.26(API 연결)·No.41(업무 자동화 발송 대상) 등
 * "원문 개인정보 전송 허용" 토글을 쓰는 모든 화면이 문구만 주입해 공유한다(복제 컴포넌트 금지).
 */
export function RawPersonalDataConfirmField({ idPrefix, entityName, value, onChange, label, mismatchMessage }: RawPersonalDataConfirmFieldProps): JSX.Element {
  const mismatch = value.length > 0 && value !== entityName;
  const inputId = `${idPrefix}-confirm-raw`;
  const errorId = `${idPrefix}-confirm-raw-error`;
  return (
    <div className="form-field">
      <label htmlFor={inputId}>{label}</label>
      <input id={inputId} type="text" maxLength={200} value={value} onChange={(e) => onChange(e.target.value)} aria-invalid={mismatch} />
      <InlineFieldError id={errorId} message={mismatch ? mismatchMessage : undefined} />
    </div>
  );
}
