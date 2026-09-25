import { useEffect, useId, useState } from 'react';
import type { BundleTarget } from '@chat-bot/shared-types';
import { MESSAGES } from '../constants/messages';
import { versionsApi } from '../api/versions';
import { targetLabel } from './TargetBadge';

export interface TargetSelectFieldProps {
  chatbotId: string;
  value: BundleTarget;
  onChange: (target: BundleTarget) => void;
  /** 꺼지면(환경 분리 미사용) 렌더 자체를 하지 않는다(§4.13 — 대상 개념이 없음). */
  environmentEnabled: boolean;
  stagingVersionNo?: number;
  prodVersionNo?: number;
  /** 오버레이 켜짐 등으로 대상 컨트롤 자체를 비활성화해야 할 때(§4.13 AC-EN6-2). */
  disabled?: boolean;
  disabledReason?: string;
}

type SelectValue = 'DRAFT' | 'STAGING' | 'PROD' | 'VERSION_PICKER';

interface VersionCandidate {
  id: string;
  versionNo: number;
  label: string | null;
}

/**
 * 시뮬레이터·TC 공용 "대상"(초안/스테이징/운영/버전) 선택 컨트롤(No.40,
 * `environment-separation-ui-spec.md` §3.2·§4.13·§4.14). "버전 선택..."을 고르면 소형 팝오버로
 * 버전 번호를 검색한다(No.25 버전 목록 데이터 재사용, 간단 텍스트 필터 — §4.13).
 */
export function TargetSelectField({
  chatbotId,
  value,
  onChange,
  environmentEnabled,
  stagingVersionNo,
  prodVersionNo,
  disabled = false,
  disabledReason,
}: TargetSelectFieldProps): JSX.Element | null {
  const msg = MESSAGES.environment.targetSelect;
  const selectId = useId();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [candidates, setCandidates] = useState<VersionCandidate[]>([]);
  // 선택된 VERSION 대상의 표시용 버전 번호 — `value`에는 `versionId`만 있어 목록에서 고른 번호를 기억해 둔다.
  const [pickedVersionNo, setPickedVersionNo] = useState<number | undefined>(undefined);

  useEffect(() => {
    if (!pickerOpen) return;
    let cancelled = false;
    setLoading(true);
    versionsApi
      .list(chatbotId, { pageSize: 50 })
      .then((res) => {
        if (cancelled) return;
        setCandidates(res.items.map((v) => ({ id: v.id, versionNo: v.versionNo, label: v.label })));
      })
      // 버전 검색은 보조 기능이다 — 실패해도 조용히 빈 목록으로 둔다(기본 목록은 항상 표시, §11).
      .catch(() => setCandidates([]))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [pickerOpen, chatbotId]);

  if (!environmentEnabled) return null;

  const selectValue: SelectValue = value.kind === 'VERSION' ? 'VERSION_PICKER' : value.kind;

  function handleSelectChange(next: string): void {
    if (next === 'DRAFT') {
      setPickerOpen(false);
      onChange({ kind: 'DRAFT' });
      return;
    }
    if (next === 'STAGING') {
      setPickerOpen(false);
      onChange({ kind: 'STAGING' });
      return;
    }
    if (next === 'PROD') {
      setPickerOpen(false);
      onChange({ kind: 'PROD' });
      return;
    }
    setPickerOpen(true);
  }

  const trimmedQuery = query.trim();
  const filtered = trimmedQuery
    ? candidates.filter((c) => `v${c.versionNo}`.includes(trimmedQuery) || String(c.versionNo).includes(trimmedQuery) || (c.label ?? '').includes(trimmedQuery))
    : candidates;

  return (
    <div className="target-select-field">
      <label htmlFor={selectId}>{msg.label}</label>
      <select
        id={selectId}
        value={selectValue}
        disabled={disabled}
        aria-disabled={disabled}
        title={disabled ? disabledReason : undefined}
        onChange={(e) => handleSelectChange(e.target.value)}
      >
        <option value="DRAFT">{msg.draft}</option>
        {stagingVersionNo !== undefined && <option value="STAGING">{msg.staging(stagingVersionNo)}</option>}
        {prodVersionNo !== undefined && <option value="PROD">{msg.prod(prodVersionNo)}</option>}
        <option value="VERSION_PICKER">
          {value.kind === 'VERSION' ? targetLabel({ kind: 'VERSION', versionNo: pickedVersionNo ?? 0 }) : msg.versionPicker}
        </option>
      </select>
      {disabled && disabledReason && <p className="field-hint">{disabledReason}</p>}
      {pickerOpen && !disabled && (
        <div className="target-version-picker">
          <label htmlFor={`${selectId}-search`} className="sr-only">
            {msg.versionPickerSearchLabel}
          </label>
          <input
            id={`${selectId}-search`}
            type="text"
            value={query}
            placeholder={msg.versionPickerSearchLabel}
            onChange={(e) => setQuery(e.target.value)}
          />
          {loading && (
            <p className="field-hint" role="status" aria-live="polite">
              {msg.versionPickerLoading}
            </p>
          )}
          {!loading && filtered.length === 0 && <p className="field-hint">{msg.versionPickerNoResults}</p>}
          {!loading && filtered.length > 0 && (
            <ul className="target-version-picker-list">
              {filtered.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    className="link-button"
                    onClick={() => {
                      setPickedVersionNo(c.versionNo);
                      setPickerOpen(false);
                      onChange({ kind: 'VERSION', versionId: c.id });
                    }}
                  >
                    {msg.version(c.versionNo)}
                    {c.label ? ` · ${c.label}` : ''}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
