import { MESSAGES } from '../../../../constants/messages';

/** 진행률 바 — `aria-live="polite"`(UIUX §8, ui-spec §4.4). `TestRunListPage`/`TestRunDetailPage` 공유. */
export function TestRunProgressBar({ processed, total, progress }: { processed: number; total: number; progress: number }): JSX.Element {
  return (
    <div className="async-job-progress" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      <progress className="async-job-progress-bar" value={progress} max={100}>
        {progress}%
      </progress>
      <span>{MESSAGES.validation.result.progressText(processed, total)}</span>
    </div>
  );
}
