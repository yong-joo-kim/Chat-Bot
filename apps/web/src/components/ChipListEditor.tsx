import { forwardRef, useState } from 'react';
import { InlineFieldError } from './InlineFieldError';

export interface ChipListEditorProps {
  id: string;
  label?: string;
  values: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
  addLabel?: string;
  maxItems?: number;
  limitMessage?: string;
  duplicateMessage?: string;
  disabled?: boolean;
}

/**
 * 예문/동의어/문맥 힌트/취소 키워드/선택지/대체질문이 공유하는 칩 입력기(ui-spec §4.3.1 `ExampleChipEditor` 등).
 * Enter 또는 "추가" 버튼으로 칩을 추가하고, 각 칩에 "제거" 버튼(44×44px)을 둔다.
 * `ref`는 입력창 DOM에 연결되어 상위 폼이 타입 변경 시 포커스를 이동시킬 수 있게 한다(ui-spec §4.2.1/§4.6.1).
 */
export const ChipListEditor = forwardRef<HTMLInputElement, ChipListEditorProps>(function ChipListEditor(
  {
    id,
    label,
    values,
    onChange,
    placeholder = '새 항목',
    addLabel = '추가',
    maxItems,
    limitMessage,
    duplicateMessage = '이미 추가된 항목입니다.',
    disabled = false,
  },
  ref,
) {
  const [draft, setDraft] = useState('');
  const [warning, setWarning] = useState<string | undefined>(undefined);
  const atMax = maxItems !== undefined && values.length >= maxItems;

  function commit(): void {
    const trimmed = draft.trim();
    if (!trimmed) return;
    if (atMax) return;
    const exists = values.some((v) => v.trim().toLowerCase() === trimmed.toLowerCase());
    if (exists) {
      setWarning(duplicateMessage);
      return;
    }
    onChange([...values, trimmed]);
    setDraft('');
    setWarning(undefined);
  }

  function remove(value: string): void {
    onChange(values.filter((v) => v !== value));
  }

  return (
    <div className="chip-list-editor">
      {label && <span className="field-label-static">{label}</span>}
      <div className="chip-list-editor-input-row">
        <label htmlFor={id} className="sr-only">
          {placeholder}
        </label>
        <input
          id={id}
          ref={ref}
          type="text"
          value={draft}
          placeholder={placeholder}
          disabled={disabled || atMax}
          onChange={(e) => {
            setDraft(e.target.value);
            setWarning(undefined);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commit();
            }
          }}
        />
        <button type="button" className="btn btn-secondary" onClick={commit} disabled={disabled || atMax || !draft.trim()}>
          {addLabel}
        </button>
      </div>
      {atMax && limitMessage && <p className="field-hint">{limitMessage}</p>}
      <InlineFieldError id={`${id}-warning`} message={warning} />
      <div className="chip-list">
        {values.map((v) => (
          <span key={v} className="chip">
            {v}
            <button type="button" className="chip-remove" aria-label={`${v} 제거`} onClick={() => remove(v)} disabled={disabled}>
              ×
            </button>
          </span>
        ))}
      </div>
    </div>
  );
});
