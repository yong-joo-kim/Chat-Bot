import { useEffect, useRef, useState } from 'react';
import type { IntegratedGroupOptions } from '@chat-bot/shared-types';
import { MESSAGES } from '../../constants/messages';
import { ErrorState } from '../../components/ErrorState';
import { SkeletonBlock } from '../../components/Skeleton';
import { toKstDateInputValue } from '../../lib/date';

export type GroupOption = IntegratedGroupOptions['items'][number];

export interface ScopeSelectorProps {
  scope: 'ALL' | 'GROUP';
  groupId?: string;
  groups: GroupOption[];
  groupsLoading: boolean;
  groupsError: boolean;
  truncated: boolean;
  onRetryGroups: () => void;
  onChange: (scope: 'ALL' | 'GROUP', groupId?: string) => void;
}

function buildDuplicateNameSet(groups: GroupOption[]): Set<string> {
  const counts = new Map<string, number>();
  for (const g of groups) counts.set(g.name, (counts.get(g.name) ?? 0) + 1);
  return new Set([...counts.entries()].filter(([, n]) => n > 1).map(([name]) => name));
}

function optionLabel(g: GroupOption, duplicateNames: Set<string>): string {
  return duplicateNames.has(g.name) ? `${g.name}${MESSAGES.integratedStats.scopeDuplicateNameSuffix(toKstDateInputValue(g.createdAt))}` : g.name;
}

/** §2.1 `GroupOptionSelect` — 활성 그룹(생성일 오름차순) → `<optgroup>` → 보관 그룹(보관일 내림차순). */
function GroupOptionSelect({
  groups,
  value,
  onChange,
  truncated,
}: {
  groups: GroupOption[];
  value?: string;
  onChange: (groupId: string) => void;
  truncated: boolean;
}): JSX.Element {
  const duplicateNames = buildDuplicateNameSet(groups);
  const active = groups
    .filter((g) => !g.archivedAt)
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const archived = groups
    .filter((g) => g.archivedAt)
    .sort((a, b) => (b.archivedAt as Date).getTime() - (a.archivedAt as Date).getTime());

  return (
    <div className="scope-group-select-wrap">
      <label htmlFor="scope-group-select" className="sr-only">
        {MESSAGES.integratedStats.scopeGroupSelectLabel}
      </label>
      <select id="scope-group-select" value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
        <option value="" disabled>
          {MESSAGES.integratedStats.scopeGroupPlaceholder}
        </option>
        {active.map((g) => (
          <option key={g.id} value={g.id}>
            {optionLabel(g, duplicateNames)}
          </option>
        ))}
        {archived.length > 0 && (
          <optgroup label={MESSAGES.integratedStats.scopeArchivedSectionLabel}>
            {archived.map((g) => (
              <option key={g.id} value={g.id}>
                {optionLabel(g, duplicateNames)}
              </option>
            ))}
          </optgroup>
        )}
      </select>
      {truncated && <p className="field-hint">{MESSAGES.integratedStats.scopeTruncatedNotice}</p>}
    </div>
  );
}

/** G0 통계 범위 선택기(`integrated-stats-ui-spec.md` §2.1). 세그먼트(라디오 2) + 조건부 그룹 콤보박스. */
export function ScopeSelector({
  scope,
  groupId,
  groups,
  groupsLoading,
  groupsError,
  truncated,
  onRetryGroups,
  onChange,
}: ScopeSelectorProps): JSX.Element {
  const [announce, setAnnounce] = useState('');
  const isFirstRender = useRef(true);

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    const label = scope === 'ALL' ? MESSAGES.integratedStats.scopeAll : groups.find((g) => g.id === groupId)?.name;
    if (scope === 'ALL' || label) {
      setAnnounce(MESSAGES.integratedStats.scopeChangeAnnounce(label ?? MESSAGES.integratedStats.scopeGroup));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, groupId]);

  return (
    <div className="scope-selector">
      <fieldset className="period-selector">
        <legend>{MESSAGES.integratedStats.scopeLegend}</legend>
        <div className="period-selector-options scope-selector-options" role="radiogroup" aria-label={MESSAGES.integratedStats.scopeLegend}>
          <label className="period-radio">
            <input type="radio" name="integrated-stats-scope" checked={scope === 'ALL'} onChange={() => onChange('ALL')} />
            {MESSAGES.integratedStats.scopeAll}
          </label>
          <label className="period-radio">
            <input
              type="radio"
              name="integrated-stats-scope"
              checked={scope === 'GROUP'}
              onChange={() => onChange('GROUP', groupId)}
            />
            {MESSAGES.integratedStats.scopeGroup}
          </label>
          {scope === 'GROUP' &&
            (groupsLoading ? (
              <SkeletonBlock height={36} />
            ) : groupsError ? (
              <ErrorState title={MESSAGES.stats.errorTitle} onRetry={onRetryGroups} />
            ) : (
              <GroupOptionSelect groups={groups} value={groupId} onChange={(gid) => onChange('GROUP', gid)} truncated={truncated} />
            ))}
        </div>
      </fieldset>
      <p className="field-hint scope-selector-live-hint">{MESSAGES.integratedStats.scopeLiveRegionHint}</p>
      <p className="sr-only" role="status" aria-live="polite">
        {announce}
      </p>
    </div>
  );
}
