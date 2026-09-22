import type { AugmentationSuggestion } from '@chat-bot/shared-types';
import { MESSAGES } from '../../../constants/messages';
import { ConflictBadge, ProviderBadge, SimilarityBadge } from './AugmentationBadges';

const msg = MESSAGES.augmentation;

export interface AugmentationSuggestionTableProps {
  items: AugmentationSuggestion[];
  selected: Set<string>;
  canWrite: boolean;
  onToggle: (id: string) => void;
  onToggleAll: () => void;
  onAcceptOne: (id: string) => void;
  onRejectOne: (id: string) => void;
  busyIds: Set<string>;
}

/**
 * A1 증강 제안 표(ui-spec §4.4). `stale`(만료) 행은 체크박스가 disabled고, 전체 선택은
 * `stale===false && conflictIntent 없음`인 행만 대상으로 한다(§4.6, J-11).
 */
export function AugmentationSuggestionTable({
  items,
  selected,
  canWrite,
  onToggle,
  onToggleAll,
  onAcceptOne,
  onRejectOne,
  busyIds,
}: AugmentationSuggestionTableProps): JSX.Element {
  const selectableIds = items.filter((i) => !i.stale && !i.conflictIntent).map((i) => i.id);
  const selectedSelectableCount = selectableIds.filter((id) => selected.has(id)).length;
  const allSelected = selectableIds.length > 0 && selectedSelectableCount === selectableIds.length;
  const someSelected = selectedSelectableCount > 0 && !allSelected;

  return (
    <table className="dialogue-table augmentation-suggestion-table">
      <thead>
        <tr>
          {canWrite && (
            <th scope="col">
              <input
                type="checkbox"
                checked={allSelected}
                ref={(el) => {
                  if (el) el.indeterminate = someSelected;
                }}
                onChange={onToggleAll}
                aria-label={msg.selectAll(selectableIds.length)}
              />
            </th>
          )}
          <th scope="col">{msg.columnSuggestion}</th>
          <th scope="col">{msg.columnSimilarity}</th>
          <th scope="col">{msg.columnConflict}</th>
          <th scope="col">{msg.columnProvider}</th>
          {canWrite && <th scope="col">{msg.columnActions}</th>}
        </tr>
      </thead>
      <tbody>
        {items.map((item) => {
          const busy = busyIds.has(item.id);
          return (
            <tr key={item.id}>
              {canWrite && (
                <td>
                  <input
                    type="checkbox"
                    checked={selected.has(item.id)}
                    disabled={item.stale || busy}
                    onChange={() => onToggle(item.id)}
                    aria-label={item.text}
                  />
                </td>
              )}
              <td>
                {item.text}
                {item.stale && (
                  <span className="dialogue-badge dialogue-badge--neutral" title={msg.staleTooltip}>
                    {msg.staleBadge}
                  </span>
                )}
              </td>
              <td>
                <SimilarityBadge score={item.similarityToSeed} />
              </td>
              <td>{item.conflictIntent && <ConflictBadge intentName={item.conflictIntent.intentName} score={item.conflictIntent.score} />}</td>
              <td>
                <ProviderBadge providerId={item.providerId} />
              </td>
              {canWrite && (
                <td className="learning-row-actions">
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={item.stale || busy}
                    title={item.stale ? msg.staleTooltip : undefined}
                    onClick={() => onAcceptOne(item.id)}
                  >
                    {msg.acceptOne}
                  </button>
                  <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => onRejectOne(item.id)}>
                    {msg.rejectOne}
                  </button>
                </td>
              )}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
