import { MESSAGES } from '../../../constants/messages';

/**
 * `provider: pdf` 고정 표시(ui-spec §4.1.3). 폼 필드가 아니라 읽기 전용 정보 표시이며
 * 제출 payload에 포함되지 않는다(FR-N2-6, J-6) — 화면 어디에도 편집 가능한 형태로 존재하지 않는다.
 */
export function ProviderLockedField(): JSX.Element {
  const msg = MESSAGES.answerSettings.rag;
  return (
    <p className="provider-locked-field" aria-readonly="true">
      <span aria-hidden="true">🔒</span> {msg.providerLockedLabel}
      <span className="field-hint"> {msg.providerLockedCaption}</span>
    </p>
  );
}
