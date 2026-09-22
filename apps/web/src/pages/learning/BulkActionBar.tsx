import { MESSAGES } from '../../constants/messages';
import { LEARNING_LIMITS } from '@chat-bot/shared-types';

export interface BulkActionBarProps {
  selectedCount: number;
  onBulkResolve: () => void;
  onBulkIgnore: () => void;
  onClearSelection: () => void;
}

/** 선택 1건 이상일 때만 렌더(FR-C-9, §4.4). 51건 이상 선택 시 사전 유효성 검사로 버튼을 막는다(§4.6-5). */
export function BulkActionBar({ selectedCount, onBulkResolve, onBulkIgnore, onClearSelection }: BulkActionBarProps): JSX.Element | null {
  if (selectedCount === 0) return null;
  const tooMany = selectedCount > LEARNING_LIMITS.bulkMaxItems;

  return (
    <div className="bulk-action-bar" role="group" aria-label={MESSAGES.learning.selectedCount(selectedCount)}>
      <span>{MESSAGES.learning.selectedCount(selectedCount)}</span>
      {tooMany && <span className="field-error" role="alert">{MESSAGES.learning.bulkTooManyNotice(selectedCount, LEARNING_LIMITS.bulkMaxItems)}</span>}
      <button type="button" className="btn btn-primary" onClick={onBulkResolve} disabled={tooMany}>
        {MESSAGES.learning.bulkResolveButton}
      </button>
      <button type="button" className="btn btn-secondary" onClick={onBulkIgnore} disabled={tooMany}>
        {MESSAGES.learning.bulkIgnoreButton}
      </button>
      <button type="button" className="btn btn-secondary" onClick={onClearSelection}>
        {MESSAGES.learning.clearSelectionButton}
      </button>
    </div>
  );
}
