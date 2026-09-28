import { useId, useRef, useState } from 'react';
import { ReorderableList } from '../../../components/ReorderableList';
import { InlineFieldError } from '../../../components/InlineFieldError';

export interface KbStringListFieldProps {
  legend: string;
  values: string[];
  onChange: (values: string[]) => void;
  maxItems: number;
  addLabel: string;
  itemLabel: (i: number) => string;
  addLimitLabel?: string;
  maxLength?: number;
  inputType?: 'text' | 'url';
  disabled?: boolean;
  errors?: (string | undefined)[];
  hint?: string;
}

/** 도움말·오류 id를 공백으로 합쳐 `aria-describedby` 값으로 만든다(둘 다 없으면 속성 생략). */
function describedBy(...ids: (string | undefined)[]): string | undefined {
  const joined = ids.filter(Boolean).join(' ');
  return joined.length > 0 ? joined : undefined;
}

/**
 * [신규 No.43] 시작 주소·사이트맵·경로 접두·제외 패턴·잡음 줄 패턴 공용 목록 입력(`KbSourceEditModal`,
 * `kb-crawling-ui-spec.md` §3.2 "[+ 시작 주소 추가]" 계열). `ReorderableList`(No.27 선례)를 그대로
 * 재사용해 추가·삭제만 지원하고 순서는 의미가 없어 위/아래 버튼도 그대로 둔다(숨기지 않음 — 기존 컴포넌트
 * 변경 0).
 */
export function KbStringListField({
  legend,
  values,
  onChange,
  maxItems,
  addLabel,
  itemLabel,
  addLimitLabel,
  maxLength = 2048,
  inputType = 'text',
  disabled,
  errors,
  hint,
}: KbStringListFieldProps): JSX.Element {
  const uid = useId();
  const hintId = `${uid}-hint`;
  const keySeq = useRef(0);
  const [rows, setRows] = useState<{ key: string; value: string }[]>(() => values.map((value) => ({ key: `k${keySeq.current++}`, value })));

  function commit(next: { key: string; value: string }[]): void {
    setRows(next);
    onChange(next.map((r) => r.value));
  }

  return (
    <fieldset className="form-field">
      <legend>{legend}</legend>
      {hint && (
        <p id={hintId} className="field-hint">
          {hint}
        </p>
      )}
      <ReorderableList
        items={rows}
        getKey={(r) => r.key}
        onChange={commit}
        maxItems={maxItems}
        onAdd={() => commit([...rows, { key: `k${keySeq.current++}`, value: '' }])}
        addLabel={addLabel}
        addLimitLabel={addLimitLabel}
        onRemove={(key) => commit(rows.filter((r) => r.key !== key))}
        itemLabel={(_r, i) => itemLabel(i)}
        renderItem={(r, index) => (
          <div className="form-field">
            <label htmlFor={`${uid}-${r.key}-input`} className="sr-only">
              {itemLabel(index)}
            </label>
            <input
              id={`${uid}-${r.key}-input`}
              type={inputType}
              maxLength={maxLength}
              value={r.value}
              disabled={disabled}
              aria-invalid={Boolean(errors?.[index])}
              aria-describedby={describedBy(hint ? hintId : undefined, errors?.[index] ? `${uid}-${r.key}-error` : undefined)}
              onChange={(e) => commit(rows.map((row) => (row.key === r.key ? { ...row, value: e.target.value } : row)))}
            />
            <InlineFieldError id={`${uid}-${r.key}-error`} message={errors?.[index]} />
          </div>
        )}
      />
    </fieldset>
  );
}
