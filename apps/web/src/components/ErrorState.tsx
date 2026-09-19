import { MESSAGES } from '../constants/messages';

/** 실제 조회 실패(5xx/503/네트워크). `EmptyState`와 시각적으로 구분되는 경고색을 사용한다. */
export function ErrorState({ title, onRetry }: { title: string; onRetry?: () => void }): JSX.Element {
  return (
    <div className="error-state" role="alert">
      <p className="error-state-title">
        <span aria-hidden="true">⚠</span> {title}
      </p>
      {onRetry && (
        <button type="button" className="btn btn-secondary" onClick={onRetry}>
          {MESSAGES.common.retry}
        </button>
      )}
    </div>
  );
}
