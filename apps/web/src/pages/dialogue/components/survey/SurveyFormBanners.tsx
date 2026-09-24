import { MESSAGES } from '../../../../constants/messages';

/** ui-spec §2.2 `SurveyStructureLockBanner` — 편집기 상단 상시 배너(응답 1건 이상일 때만). */
export function SurveyStructureLockBanner({ responseCount, onDuplicate }: { responseCount: number; onDuplicate: () => void }): JSX.Element {
  const msg = MESSAGES.surveys;
  return (
    <div className="form-banner form-banner--warning" role="status">
      <span aria-hidden="true">⚠</span> {msg.structureLockBanner(responseCount)}{' '}
      <button type="button" className="btn btn-secondary" onClick={onDuplicate}>
        {msg.structureLockDuplicateButton}
      </button>
    </div>
  );
}

/** ui-spec §2.2 `SurveyTimeoutRetroactiveHint` — 응답이 있을 때만 노출(K-3). */
export function SurveyTimeoutRetroactiveHint({ hasResponses }: { hasResponses: boolean }): JSX.Element | null {
  if (!hasResponses) return null;
  return <p className="field-hint field-hint--warning">{MESSAGES.surveys.timeoutRetroactiveHint}</p>;
}
