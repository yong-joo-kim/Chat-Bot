import { useEffect, useState, type MutableRefObject } from 'react';
import type { ApiConditionItemV2, ApiConditionOutputPayloadV2, ApiHttpMethod } from '@chat-bot/shared-types';
import { ReorderableList } from '../../../../components/ReorderableList';
import { ResourcePickerField } from '../../../../components/ResourcePickerField';
import { InlineFieldError } from '../../../../components/InlineFieldError';
import { apiConnectionsApi } from '../../../../api/apiConnections';
import { contextsApi } from '../../../../api/dialogue';
import { MESSAGES } from '../../../../constants/messages';
import { ApiConnectionPickerField } from './ApiConnectionPickerField';
import { ApiBodyFieldListEditor, ApiPathParamListEditor, ApiQueryListEditor, ApiResponseMappingListEditor } from './ApiListEditors';
import type { SlotOption } from './BindingValueEditor';
import { ApiConditionPreviewPanel } from './ApiConditionPreviewPanel';

export interface ApiConditionEditorV2Props {
  value: ApiConditionOutputPayloadV2;
  onChange: (value: ApiConditionOutputPayloadV2) => void;
  chatbotId: string;
  /** 이 노드의 인풋 조건에 걸린 컨텍스트 id(없으면 null) — 슬롯 후보 계산용(ui-spec §4.2). */
  nodeContextVariableId: string | null;
  errPrefix: string;
  fieldErrors: Record<string, string>;
  firstFieldRef: MutableRefObject<HTMLElement | null>;
}

let condSeq = 0;
function newCondition(): ApiConditionItemV2 & { key: string } {
  condSeq += 1;
  return { key: `api-cond-${condSeq}`, path: '', operator: 'EQ', nextNodeId: '' };
}

const PLACEHOLDER_RE = /\{[0-4]\}/g;

/**
 * D1a-v2 — API 조건분기 v2 폼(`legacy-api-integration-ui-spec.md` §3.2 `ApiConditionEditorV2`).
 * 연결 선택·메서드·상대 경로(+경로 값 자동 동기화)·쿼리·본문·응답 매핑·조건·기본/실패 분기를 구성한다.
 */
export function ApiConditionEditorV2({
  value,
  onChange,
  chatbotId,
  nodeContextVariableId,
  errPrefix,
  fieldErrors,
  firstFieldRef,
}: ApiConditionEditorV2Props): JSX.Element {
  const msg = MESSAGES.dialogue.outputFields;
  const [slotOptions, setSlotOptions] = useState<SlotOption[]>([]);
  const [connectionMethods, setConnectionMethods] = useState<ApiHttpMethod[] | null>(null);

  useEffect(() => {
    if (!nodeContextVariableId) {
      setSlotOptions([]);
      return;
    }
    let cancelled = false;
    contextsApi
      .findOne(chatbotId, nodeContextVariableId)
      .then((ctx) => {
        if (cancelled) return;
        setSlotOptions(ctx.slots.map((s) => ({ contextVariableId: ctx.id, slotName: s.name, label: `${ctx.name} › ${s.label}` })));
      })
      .catch(() => setSlotOptions([]));
    return () => {
      cancelled = true;
    };
  }, [chatbotId, nodeContextVariableId]);

  useEffect(() => {
    if (!value.connectionId) {
      setConnectionMethods(null);
      return;
    }
    let cancelled = false;
    apiConnectionsApi
      .picker()
      .then((res) => {
        if (cancelled) return;
        const found = res.items.find((c) => c.id === value.connectionId);
        setConnectionMethods(found ? found.allowedMethods : null);
      })
      .catch(() => setConnectionMethods(null));
    return () => {
      cancelled = true;
    };
  }, [value.connectionId]);

  function setPath(path: string): void {
    const count = (path.match(PLACEHOLDER_RE) ?? []).length;
    const pathParams = Array.from({ length: count }, (_, i) => value.pathParams[i] ?? { kind: 'CONST' as const, value: '' });
    onChange({ ...value, path, pathParams });
  }

  // ⚠ `errPrefix`는 이미 `outputs.<i>.payload`까지다 — `DialogOutputSchema`가 `{type, payload}`이므로
  // `payload` 자체가 v2 페이로드다("apiCondition" 같은 중간 세그먼트는 실제 zod 경로에 없다).
  const err = (suffix: string): string | undefined => fieldErrors[`${errPrefix}.${suffix}`];
  const conditionRows = value.conditions.map((c, i) => ({ ...c, key: `api-cond-existing-${i}` }));

  return (
    <div className="api-condition-editor-v2">
      <ApiConnectionPickerField
        id="api-cond-connection"
        label={msg.apiConnectionLabel}
        value={value.connectionId || null}
        onChange={(id) => onChange({ ...value, connectionId: id ?? '' })}
        required
        errorMessage={err('connectionId')}
      />

      <fieldset className="form-field">
        <legend>{msg.apiMethodV2Label}</legend>
        {(['GET', 'POST'] as ApiHttpMethod[]).map((m) => {
          const disallowed = connectionMethods !== null && !connectionMethods.includes(m);
          return (
            <label key={m} className="form-field--inline">
              <input
                type="radio"
                name="api-cond-method"
                checked={value.method === m}
                disabled={disallowed}
                onChange={() => onChange({ ...value, method: m, body: m === 'GET' ? [] : value.body })}
              />
              {m}
            </label>
          );
        })}
        {connectionMethods !== null && connectionMethods.length === 1 && (
          <p className="field-hint">{msg.apiMethodOnlyAllowedHint(connectionMethods[0])}</p>
        )}
        <InlineFieldError id="api-cond-method-error" message={err('method')} />
      </fieldset>

      <div className="form-field">
        <label htmlFor="api-cond-path">
          {msg.apiPathLabel} <span className="required-mark" aria-hidden="true">*</span>
        </label>
        <input
          id="api-cond-path"
          ref={(el) => (firstFieldRef.current = el)}
          type="text"
          maxLength={300}
          value={value.path}
          onChange={(e) => setPath(e.target.value)}
        />
        <p className="field-hint">{msg.apiPathHelp}</p>
        <InlineFieldError id="api-cond-path-error" message={err('path')} />
      </div>

      <ApiPathParamListEditor values={value.pathParams} onChange={(pathParams) => onChange({ ...value, pathParams })} slotOptions={slotOptions} />

      <ApiQueryListEditor
        items={value.query}
        onChange={(query) => onChange({ ...value, query })}
        slotOptions={slotOptions}
        fieldErrors={fieldErrors}
        errPrefix={errPrefix}
      />

      {value.method === 'POST' && (
        <ApiBodyFieldListEditor
          items={value.body}
          onChange={(body) => onChange({ ...value, body })}
          slotOptions={slotOptions}
          fieldErrors={fieldErrors}
          errPrefix={errPrefix}
        />
      )}

      <ApiResponseMappingListEditor
        items={value.responseMappings}
        onChange={(responseMappings) => onChange({ ...value, responseMappings })}
        fieldErrors={fieldErrors}
        errPrefix={errPrefix}
      />

      <div className="form-field">
        <span className="field-label-static">{msg.apiConditions}</span>
        <ReorderableList
          items={conditionRows}
          getKey={(c) => c.key}
          onChange={(next) => onChange({ ...value, conditions: next.map(({ key: _k, ...rest }) => rest) })}
          minItems={1}
          maxItems={10}
          onAdd={() => onChange({ ...value, conditions: [...value.conditions, newCondition()] })}
          addLabel={msg.addCondition}
          onRemove={(key) => onChange({ ...value, conditions: conditionRows.filter((c) => c.key !== key).map(({ key: _k, ...rest }) => rest) })}
          itemLabel={(c, i) => `${i + 1}번째 조건`}
          renderItem={(c, index) => (
            <div className="key-value-row">
              <div className="form-field">
                <label htmlFor={`api-cond-${index}-path`}>{msg.conditionPath}</label>
                <input
                  id={`api-cond-${index}-path`}
                  type="text"
                  maxLength={200}
                  value={c.path}
                  onChange={(e) => {
                    const next = [...conditionRows];
                    next[index] = { ...c, path: e.target.value };
                    onChange({ ...value, conditions: next.map(({ key: _k, ...rest }) => rest) });
                  }}
                  aria-invalid={Boolean(err(`conditions.${index}.path`))}
                />
                <InlineFieldError id={`api-cond-${index}-path-error`} message={err(`conditions.${index}.path`)} />
              </div>
              <div className="form-field">
                <label htmlFor={`api-cond-${index}-op`}>{msg.conditionOperator}</label>
                <select
                  id={`api-cond-${index}-op`}
                  value={c.operator}
                  onChange={(e) => {
                    const next = [...conditionRows];
                    next[index] = { ...c, operator: e.target.value as ApiConditionItemV2['operator'] };
                    onChange({ ...value, conditions: next.map(({ key: _k, ...rest }) => rest) });
                  }}
                >
                  {['EQ', 'NEQ', 'GT', 'GTE', 'LT', 'LTE', 'CONTAINS', 'EXISTS'].map((op) => (
                    <option key={op} value={op}>
                      {op}
                    </option>
                  ))}
                </select>
                <InlineFieldError id={`api-cond-${index}-op-error`} message={err(`conditions.${index}.operator`)} />
              </div>
              <div className="form-field">
                <label htmlFor={`api-cond-${index}-value`}>{msg.conditionValue}</label>
                <input
                  id={`api-cond-${index}-value`}
                  type="text"
                  maxLength={500}
                  value={c.value ?? ''}
                  onChange={(e) => {
                    const next = [...conditionRows];
                    next[index] = { ...c, value: e.target.value || undefined };
                    onChange({ ...value, conditions: next.map(({ key: _k, ...rest }) => rest) });
                  }}
                  aria-invalid={Boolean(err(`conditions.${index}.value`))}
                />
                <InlineFieldError id={`api-cond-${index}-value-error`} message={err(`conditions.${index}.value`)} />
              </div>
              <ResourcePickerField
                id={`api-cond-${index}-next`}
                label={msg.conditionNextNode}
                resourceType="node"
                chatbotId={chatbotId}
                multiple={false}
                value={c.nextNodeId || null}
                onChange={(v) => {
                  const next = [...conditionRows];
                  next[index] = { ...c, nextNodeId: (v as string) ?? '' };
                  onChange({ ...value, conditions: next.map(({ key: _k, ...rest }) => rest) });
                }}
                errorMessage={err(`conditions.${index}.nextNodeId`)}
              />
            </div>
          )}
        />
      </div>

      <ResourcePickerField
        id="api-cond-default-node"
        label={msg.apiDefaultBranchLabel}
        resourceType="node"
        chatbotId={chatbotId}
        multiple={false}
        value={value.defaultNodeId ?? null}
        onChange={(v) => onChange({ ...value, defaultNodeId: (v as string) || undefined })}
        helpText={msg.apiDefaultBranchHint}
        errorMessage={err('defaultNodeId')}
      />
      <ResourcePickerField
        id="api-cond-failure-node"
        label={msg.apiFailureBranchLabel}
        resourceType="node"
        chatbotId={chatbotId}
        multiple={false}
        value={value.failureNodeId ?? null}
        onChange={(v) => onChange({ ...value, failureNodeId: (v as string) || undefined })}
        helpText={msg.apiFailureBranchHint}
        errorMessage={err('failureNodeId')}
      />

      <p className="field-hint">{msg.apiOutputTerminalHint}</p>

      <ApiConditionPreviewPanel payload={value} chatbotId={chatbotId} />
    </div>
  );
}
