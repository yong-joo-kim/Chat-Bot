import { MESSAGES } from '../../../constants/messages';

/**
 * 연결 점검 실행(ui-spec §4.1.3). 클릭 시 버튼 내부 스피너 + "확인 중..." 텍스트로 전환해
 * 연타를 막는다(UIUX §4). 이 버튼은 `/api/rag/query`를 호출하지 않는다(FR-N3-7) — 상시 캡션으로 안내.
 */
export function ConnectionCheckButton({ checking, disabled, onClick }: { checking: boolean; disabled?: boolean; onClick: () => void }): JSX.Element {
  const msg = MESSAGES.answerSettings.rag;
  return (
    <div className="connection-check-button-wrap">
      <button type="button" className="btn btn-secondary" disabled={disabled || checking} aria-disabled={disabled || checking} onClick={onClick}>
        {checking && <span className="spinner" aria-hidden="true" />} {checking ? msg.connectionChecking : msg.connectionCheckButton}
      </button>
      <p className="field-hint">{msg.connectionCheckCaption}</p>
    </div>
  );
}
