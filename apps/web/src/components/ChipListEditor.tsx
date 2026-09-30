import { forwardRef, useState, type ClipboardEvent } from 'react';
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
  /** 추가 직전 형식 검증(선택). 오류 문구를 반환하면 추가를 막고 인라인으로 표시한다. */
  validate?: (value: string) => string | undefined;
  /**
   * [신규 No.36] 여러 줄을 붙여넣으면 줄마다 하나씩 추가한다(붙여넣기 자체는 제한하지 않는다 — UIUX §5).
   * 기본 꺼짐(기존 소비자는 붙여넣기 동작이 그대로다).
   */
  splitPastedLines?: boolean;
  /** [신규 No.36] 서버 검증에서 걸린 칩을 강조한다(글자 표식 "⚠"를 함께 붙인다 — 색 단독 금지). */
  invalidValues?: string[];
  /** 입력창·칩 목록에 연결할 설명 요소 id(선택). */
  describedBy?: string;
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
    validate,
    splitPastedLines = false,
    invalidValues,
    describedBy,
  },
  ref,
) {
  const [draft, setDraft] = useState('');
  const [warning, setWarning] = useState<string | undefined>(undefined);
  const atMax = maxItems !== undefined && values.length >= maxItems;

  /** 한 항목을 검사해 추가할 수 있으면 새 목록을, 아니면 경고 문구를 돌려준다. */
  function tryAdd(list: string[], raw: string): { list: string[]; warning?: string } {
    const trimmed = raw.trim();
    if (!trimmed) return { list };
    if (maxItems !== undefined && list.length >= maxItems) return { list };
    const validationError = validate?.(trimmed);
    if (validationError) return { list, warning: validationError };
    const exists = list.some((v) => v.trim().toLowerCase() === trimmed.toLowerCase());
    if (exists) return { list, warning: duplicateMessage };
    return { list: [...list, trimmed] };
  }

  function commit(): void {
    if (!draft.trim() || atMax) return;
    const result = tryAdd(values, draft);
    if (result.warning) {
      setWarning(result.warning);
      return;
    }
    onChange(result.list);
    setDraft('');
    setWarning(undefined);
  }

  function handlePaste(e: ClipboardEvent<HTMLInputElement>): void {
    if (!splitPastedLines) return;
    const text = e.clipboardData.getData('text');
    if (!/[\r\n]/.test(text)) return;
    e.preventDefault();
    let next = values;
    let firstWarning: string | undefined;
    for (const line of text.split(/\r?\n/)) {
      const result = tryAdd(next, line);
      if (result.warning && !firstWarning) firstWarning = result.warning;
      next = result.list;
    }
    if (next !== values) onChange(next);
    setDraft('');
    setWarning(firstWarning);
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
          aria-describedby={describedBy}
          onChange={(e) => {
            setDraft(e.target.value);
            setWarning(undefined);
          }}
          onPaste={handlePaste}
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
        {values.map((v) => {
          const invalid = invalidValues?.includes(v) ?? false;
          return (
            <span key={v} className={`chip${invalid ? ' chip--invalid' : ''}`}>
              {invalid && <span aria-hidden="true">⚠ </span>}
              {v}
              <button type="button" className="chip-remove" aria-label={`${v} 제거`} onClick={() => remove(v)} disabled={disabled}>
                ×
              </button>
            </span>
          );
        })}
      </div>
    </div>
  );
});
