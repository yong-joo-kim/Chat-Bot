import { useEffect, useMemo, useState } from 'react';
import type { UtteranceCluster } from '@chat-bot/shared-types';
import { MESSAGES } from '../../../constants/messages';
import { useDebouncedValue } from '../../../lib/useDebouncedValue';
import { sortClusters } from './ClusterTable';

export interface UtteranceFilterValue {
  cluster: string;
  candidate: boolean;
  unapplied: boolean;
  q: string;
}

const CLUSTER_SELECT_MAX = 20;

function optionLabel(c: UtteranceCluster): string {
  const msg = MESSAGES.utteranceAnalysis;
  return c.unassigned ? msg.unassignedLabel : msg.filterClusterOption(c.ordinal, c.displayName);
}

/**
 * 발화 표 필터(§5.6). 묶음이 20개 이하면 `<select>`, 초과(최대 51)면 검색 가능한 콤보박스(`<input list>` + `<datalist>` — UIUX §6).
 * 검색어는 입력 400ms 뒤 반영하고 Enter는 즉시 반영한다. 값이 바뀌면 부모가 page=1로 되돌린다.
 */
export function UtteranceFilterBar({
  clusters,
  value,
  probeDone,
  onChange,
  onClear,
}: {
  clusters: UtteranceCluster[];
  value: UtteranceFilterValue;
  probeDone: boolean;
  onChange: (patch: Partial<UtteranceFilterValue>) => void;
  onClear: () => void;
}): JSX.Element {
  const msg = MESSAGES.utteranceAnalysis;
  const sorted = useMemo(() => sortClusters(clusters), [clusters]);
  const [qDraft, setQDraft] = useState(value.q);
  const debouncedQ = useDebouncedValue(qDraft, 400);
  const selected = sorted.find((c) => c.id === value.cluster);
  const [comboText, setComboText] = useState(selected ? optionLabel(selected) : '');

  useEffect(() => {
    const next = debouncedQ.trim();
    if (next !== value.q) onChange({ q: next });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQ]);

  // 부모가 값을 바꾼 경우("발화 보기"·필터 지우기 등) 콤보박스 표시 글자를 맞춘다.
  useEffect(() => {
    setComboText(selected ? optionLabel(selected) : '');
  }, [selected?.id]);

  function handleComboChange(text: string): void {
    setComboText(text);
    if (text === '') {
      onChange({ cluster: '' });
      return;
    }
    const hit = sorted.find((c) => optionLabel(c) === text);
    if (hit) onChange({ cluster: hit.id });
  }

  return (
    <div className="ua-filter-bar">
      <div className="form-field">
        <label htmlFor="ua-filter-cluster">{msg.filterCluster}</label>
        {sorted.length <= CLUSTER_SELECT_MAX ? (
          <select id="ua-filter-cluster" value={value.cluster} onChange={(e) => onChange({ cluster: e.target.value })}>
            <option value="">{msg.filterClusterAll}</option>
            {sorted.map((c) => (
              <option key={c.id} value={c.id}>
                {optionLabel(c)}
              </option>
            ))}
          </select>
        ) : (
          <>
            <input id="ua-filter-cluster" type="text" list="ua-filter-cluster-options" value={comboText} placeholder={msg.filterClusterAll} onChange={(e) => handleComboChange(e.target.value)} />
            <datalist id="ua-filter-cluster-options">
              {sorted.map((c) => (
                <option key={c.id} value={optionLabel(c)} />
              ))}
            </datalist>
          </>
        )}
      </div>
      <div className="form-field">
        <label className="ua-checkbox-label">
          <input
            type="checkbox"
            checked={value.candidate}
            disabled={!probeDone}
            aria-describedby={!probeDone ? 'ua-filter-candidate-reason' : undefined}
            onChange={(e) => onChange({ candidate: e.target.checked })}
          />{' '}
          {msg.filterCandidateOnly}
        </label>
        {!probeDone && (
          <p id="ua-filter-candidate-reason" className="field-hint">
            {msg.filterCandidateDisabled}
          </p>
        )}
      </div>
      <div className="form-field">
        <label className="ua-checkbox-label">
          <input type="checkbox" checked={value.unapplied} onChange={(e) => onChange({ unapplied: e.target.checked })} /> {msg.filterUnappliedOnly}
        </label>
      </div>
      <div className="form-field">
        <label htmlFor="ua-filter-q">{msg.filterSearch}</label>
        <input
          id="ua-filter-q"
          type="search"
          maxLength={50}
          value={qDraft}
          aria-describedby="ua-filter-q-hint"
          onChange={(e) => setQDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              const next = qDraft.trim();
              if (next !== value.q) onChange({ q: next });
            }
          }}
        />
        <p id="ua-filter-q-hint" className="field-hint">
          {msg.filterSearchHint}
        </p>
      </div>
      <button
        type="button"
        className="btn btn-secondary ua-filter-clear"
        onClick={() => {
          setQDraft('');
          onClear();
        }}
      >
        {msg.clearFilter}
      </button>
    </div>
  );
}
