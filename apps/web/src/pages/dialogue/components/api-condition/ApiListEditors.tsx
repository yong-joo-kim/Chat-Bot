import type { ApiBinding } from '@chat-bot/shared-types';
import { ReorderableList } from '../../../../components/ReorderableList';
import { InlineFieldError } from '../../../../components/InlineFieldError';
import { MESSAGES } from '../../../../constants/messages';
import { BindingValueEditor, type SlotOption } from './BindingValueEditor';

interface QueryItem {
  name: string;
  value: ApiBinding;
}
interface BodyItem {
  field: string;
  value: ApiBinding;
}
export interface MappingItem {
  name: string;
  path: string;
  required: boolean;
  maxLength: number;
}

let keySeq = 0;
function nextKey(prefix: string): string {
  keySeq += 1;
  return `${prefix}-${keySeq}`;
}

/** D1a-v2 — 경로 값 목록(§3.2). 경로의 `{n}` 개수와 자동 동기화되므로 추가/삭제 버튼이 없다. */
export function ApiPathParamListEditor({
  values,
  onChange,
  slotOptions,
}: {
  values: ApiBinding[];
  onChange: (values: ApiBinding[]) => void;
  slotOptions: SlotOption[];
}): JSX.Element | null {
  const msg = MESSAGES.dialogue.outputFields;
  if (values.length === 0) return null;
  return (
    <div className="form-field">
      {values.map((v, i) => (
        <BindingValueEditor
          key={i}
          idPrefix={`api-path-param-${i}`}
          label={msg.apiPathParamLabel(i)}
          value={v}
          onChange={(next) => {
            const nv = [...values];
            nv[i] = next;
            onChange(nv);
          }}
          slotOptions={slotOptions}
        />
      ))}
    </div>
  );
}

/**
 * `fieldErrors`/`errPrefix` 공용 — `errPrefix`는 이미 `outputs.<i>.payload`까지다. 서버 zod 검증
 * 오류는 `issue.path.join('.')`이 그대로 `details[].field`가 되므로(`ZodValidationPipe`), 실제 경로는
 * `${errPrefix}.query.<j>.name`처럼 스키마 중첩을 그대로 따른다("apiCondition" 같은 중간 세그먼트는 없다).
 */
export interface ListEditorErrorProps {
  fieldErrors: Record<string, string>;
  errPrefix: string;
}

/** D1a-v2 — 쿼리 목록(§2.3 `ApiQueryListEditor`). `ReorderableList` 재사용, 최대 20개. */
export function ApiQueryListEditor({
  items,
  onChange,
  slotOptions,
  fieldErrors,
  errPrefix,
}: {
  items: QueryItem[];
  onChange: (items: QueryItem[]) => void;
  slotOptions: SlotOption[];
} & ListEditorErrorProps): JSX.Element {
  const msg = MESSAGES.dialogue.outputFields;
  const rows = items.map((it) => ({ ...it, key: nextKey('query') }));
  return (
    <div className="form-field">
      <span className="field-label-static">{msg.apiQueryLabel(items.length, 20)}</span>
      <ReorderableList
        items={rows}
        getKey={(r) => r.key}
        onChange={(next) => onChange(next.map(({ key: _k, ...rest }) => rest))}
        maxItems={20}
        onAdd={() => onChange([...items, { name: '', value: { kind: 'CONST', value: '' } }])}
        addLabel={msg.addApiQuery}
        onRemove={(key) => onChange(rows.filter((r) => r.key !== key).map(({ key: _k, ...rest }) => rest))}
        itemLabel={(r, i) => `${i + 1}번째 쿼리(${r.name || '이름 없음'})`}
        renderItem={(r, index) => (
          <div className="key-value-row">
            <div className="form-field">
              <label htmlFor={`api-query-${index}-name`}>{msg.apiQueryName}</label>
              <input
                id={`api-query-${index}-name`}
                type="text"
                maxLength={50}
                value={r.name}
                onChange={(e) => {
                  const next = [...items];
                  next[index] = { ...next[index], name: e.target.value };
                  onChange(next);
                }}
                aria-invalid={Boolean(fieldErrors[`${errPrefix}.query.${index}.name`])}
              />
              <InlineFieldError id={`api-query-${index}-name-error`} message={fieldErrors[`${errPrefix}.query.${index}.name`]} />
            </div>
            <BindingValueEditor
              idPrefix={`api-query-${index}-value`}
              label="값"
              value={r.value}
              onChange={(v) => {
                const next = [...items];
                next[index] = { ...next[index], value: v };
                onChange(next);
              }}
              slotOptions={slotOptions}
            />
          </div>
        )}
      />
    </div>
  );
}

/** D1a-v2 — 본문 필드 목록(POST 전용, §2.3 `ApiBodyFieldListEditor`). 최대 30개. */
export function ApiBodyFieldListEditor({
  items,
  onChange,
  slotOptions,
  fieldErrors,
  errPrefix,
}: {
  items: BodyItem[];
  onChange: (items: BodyItem[]) => void;
  slotOptions: SlotOption[];
} & ListEditorErrorProps): JSX.Element {
  const msg = MESSAGES.dialogue.outputFields;
  const rows = items.map((it) => ({ ...it, key: nextKey('body') }));
  return (
    <div className="form-field">
      <span className="field-label-static">{msg.apiBodyLabel(items.length, 30)}</span>
      <ReorderableList
        items={rows}
        getKey={(r) => r.key}
        onChange={(next) => onChange(next.map(({ key: _k, ...rest }) => rest))}
        maxItems={30}
        onAdd={() => onChange([...items, { field: '', value: { kind: 'CONST', value: '' } }])}
        addLabel={msg.addApiBodyField}
        onRemove={(key) => onChange(rows.filter((r) => r.key !== key).map(({ key: _k, ...rest }) => rest))}
        itemLabel={(r, i) => `${i + 1}번째 본문 필드(${r.field || '필드명 없음'})`}
        renderItem={(r, index) => (
          <div className="key-value-row">
            <div className="form-field">
              <label htmlFor={`api-body-${index}-field`}>{msg.apiBodyFieldName}</label>
              <input
                id={`api-body-${index}-field`}
                type="text"
                maxLength={200}
                value={r.field}
                onChange={(e) => {
                  const next = [...items];
                  next[index] = { ...next[index], field: e.target.value };
                  onChange(next);
                }}
                aria-invalid={Boolean(fieldErrors[`${errPrefix}.body.${index}.field`])}
              />
              <InlineFieldError id={`api-body-${index}-field-error`} message={fieldErrors[`${errPrefix}.body.${index}.field`]} />
            </div>
            <BindingValueEditor
              idPrefix={`api-body-${index}-value`}
              label="값"
              value={r.value}
              onChange={(v) => {
                const next = [...items];
                next[index] = { ...next[index], value: v };
                onChange(next);
              }}
              slotOptions={slotOptions}
            />
          </div>
        )}
      />
    </div>
  );
}

/** D1a-v2 — 응답 매핑 목록(§2.3 `ApiResponseMappingListEditor`). 최대 20개. */
export function ApiResponseMappingListEditor({
  items,
  onChange,
  fieldErrors,
  errPrefix,
}: {
  items: MappingItem[];
  onChange: (items: MappingItem[]) => void;
} & ListEditorErrorProps): JSX.Element {
  const msg = MESSAGES.dialogue.outputFields;
  const rows = items.map((it) => ({ ...it, key: nextKey('mapping') }));
  return (
    <div className="form-field">
      <span className="field-label-static">{msg.apiResponseMappingLabel(items.length, 20)}</span>
      <ReorderableList
        items={rows}
        getKey={(r) => r.key}
        onChange={(next) => onChange(next.map(({ key: _k, ...rest }) => rest))}
        maxItems={20}
        onAdd={() => onChange([...items, { name: '', path: '', required: false, maxLength: 200 }])}
        addLabel={msg.addApiResponseMapping}
        onRemove={(key) => onChange(rows.filter((r) => r.key !== key).map(({ key: _k, ...rest }) => rest))}
        itemLabel={(r, i) => `${i + 1}번째 매핑(${r.name || '변수명 없음'})`}
        renderItem={(r, index) => (
          <div className="key-value-row">
            <div className="form-field">
              <label htmlFor={`api-mapping-${index}-name`}>{msg.mappingName}</label>
              <input
                id={`api-mapping-${index}-name`}
                type="text"
                maxLength={30}
                value={r.name}
                onChange={(e) => {
                  const next = [...items];
                  next[index] = { ...next[index], name: e.target.value };
                  onChange(next);
                }}
                aria-invalid={Boolean(fieldErrors[`${errPrefix}.responseMappings.${index}.name`])}
              />
              <InlineFieldError id={`api-mapping-${index}-name-error`} message={fieldErrors[`${errPrefix}.responseMappings.${index}.name`]} />
            </div>
            <div className="form-field">
              <label htmlFor={`api-mapping-${index}-path`}>{msg.mappingPath}</label>
              <input
                id={`api-mapping-${index}-path`}
                type="text"
                maxLength={200}
                value={r.path}
                onChange={(e) => {
                  const next = [...items];
                  next[index] = { ...next[index], path: e.target.value };
                  onChange(next);
                }}
                aria-invalid={Boolean(fieldErrors[`${errPrefix}.responseMappings.${index}.path`])}
              />
              <InlineFieldError id={`api-mapping-${index}-path-error`} message={fieldErrors[`${errPrefix}.responseMappings.${index}.path`]} />
            </div>
            <div className="form-field form-field--inline">
              <input
                id={`api-mapping-${index}-required`}
                type="checkbox"
                checked={r.required}
                onChange={(e) => {
                  const next = [...items];
                  next[index] = { ...next[index], required: e.target.checked };
                  onChange(next);
                }}
              />
              <label htmlFor={`api-mapping-${index}-required`}>{msg.mappingRequired}</label>
            </div>
            <div className="form-field">
              <label htmlFor={`api-mapping-${index}-maxlength`}>{msg.mappingMaxLength}</label>
              <input
                id={`api-mapping-${index}-maxlength`}
                type="number"
                min={1}
                max={500}
                value={r.maxLength}
                onChange={(e) => {
                  const next = [...items];
                  next[index] = { ...next[index], maxLength: Number(e.target.value) };
                  onChange(next);
                }}
              />
            </div>
          </div>
        )}
      />
    </div>
  );
}
