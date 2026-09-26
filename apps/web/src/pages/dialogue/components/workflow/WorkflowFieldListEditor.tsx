import type { ApiBinding } from '@chat-bot/shared-types';
import { ReorderableList } from '../../../../components/ReorderableList';
import { InlineFieldError } from '../../../../components/InlineFieldError';
import { MESSAGES } from '../../../../constants/messages';
import { BindingValueEditor, type SlotOption } from '../api-condition/BindingValueEditor';

export interface WorkflowFieldItem {
  name: string;
  value: ApiBinding;
}

export interface WorkflowFieldListEditorProps {
  items: WorkflowFieldItem[];
  onChange: (items: WorkflowFieldItem[]) => void;
  slotOptions: SlotOption[];
  maxItems?: number;
  fieldErrors: Record<string, string>;
  /** 서버 `details[].field` 경로 접두어(예: `outputs.3.payload.fields`). */
  errPrefix: string;
}

let keySeq = 0;
function nextKey(): string {
  keySeq += 1;
  return `workflow-field-${keySeq}`;
}

/**
 * [No.41] `WorkflowFieldListEditor`(workflow-automation-ui-spec.md §2.2) — `ReorderableList` +
 * No.26 `BindingValueEditor`를 그대로 재사용한다(신규 값 에디터를 만들지 않는다, R-1).
 */
export function WorkflowFieldListEditor({
  items,
  onChange,
  slotOptions,
  maxItems = 20,
  fieldErrors,
  errPrefix,
}: WorkflowFieldListEditorProps): JSX.Element {
  const msg = MESSAGES.dialogue.outputFields;
  const rows = items.map((it) => ({ ...it, key: nextKey() }));
  return (
    <div className="form-field">
      <span className="field-label-static">{msg.workflowFieldsTitle(items.length, maxItems)}</span>
      <p className="field-hint">{msg.workflowFieldsMaskHint}</p>
      <ReorderableList
        items={rows}
        getKey={(r) => r.key}
        onChange={(next) => onChange(next.map(({ key: _k, ...rest }) => rest))}
        maxItems={maxItems}
        onAdd={() => onChange([...items, { name: '', value: { kind: 'CONST', value: '' } }])}
        addLabel={msg.workflowAddField}
        onRemove={(key) => onChange(rows.filter((r) => r.key !== key).map(({ key: _k, ...rest }) => rest))}
        itemLabel={(r, i) => `${i + 1}번째 필드(${r.name || '이름 없음'})`}
        renderItem={(r, index) => (
          <div className="key-value-row">
            <div className="form-field">
              <label htmlFor={`workflow-field-${index}-name`}>{msg.workflowFieldNameLabel}</label>
              <input
                id={`workflow-field-${index}-name`}
                type="text"
                maxLength={40}
                value={r.name}
                onChange={(e) => {
                  const next = [...items];
                  next[index] = { ...next[index], name: e.target.value };
                  onChange(next);
                }}
                aria-invalid={Boolean(fieldErrors[`${errPrefix}.${index}.name`])}
              />
              <InlineFieldError id={`workflow-field-${index}-name-error`} message={fieldErrors[`${errPrefix}.${index}.name`]} />
            </div>
            <BindingValueEditor
              idPrefix={`workflow-field-${index}-value`}
              label="값"
              value={r.value}
              onChange={(v) => {
                const next = [...items];
                next[index] = { ...next[index], value: v };
                onChange(next);
              }}
              slotOptions={slotOptions}
              maxLength={500}
            />
          </div>
        )}
      />
    </div>
  );
}
