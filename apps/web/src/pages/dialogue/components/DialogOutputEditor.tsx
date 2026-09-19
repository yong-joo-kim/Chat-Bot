import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import type {
  ApiConditionItem,
  ButtonItem,
  DialogOutput,
  DialogOutputType,
} from '@chat-bot/shared-types';
import { InlineFieldError } from '../../../components/InlineFieldError';
import { ReorderableList } from '../../../components/ReorderableList';
import { ResourcePickerField } from '../../../components/ResourcePickerField';
import { MESSAGES } from '../../../constants/messages';
import { UnsupportedOutputBadge } from '../badges';
import { ButtonItemEditor } from './ButtonItemEditor';

export interface DialogOutputEditorProps {
  value: DialogOutput;
  onChange: (value: DialogOutput) => void;
  chatbotId: string;
  currentNodeId?: string;
  /** DOM id 접두어(예: `output-3`) — 화면 내에서만 유일하면 되고 오류 필드 경로와는 별개다. */
  idPrefix: string;
  /** 서버 `details[].field` 경로 접두어(예: `outputs.3.payload`) — DOM id와 형식이 다를 수 있다. */
  errorFieldPrefix: string;
  fieldErrors: Record<string, string>;
}

const OUTPUT_TYPES: DialogOutputType[] = [
  'TEXT',
  'CARD',
  'IMAGE',
  'BUTTON',
  'LINK',
  'PAUSE',
  'PHONE_CALL',
  'CONTEXT_FORM',
  'DIALOG_MOVE',
  'SCENARIO',
  'SURVEY',
  'API_CONDITION',
];

function defaultPayloadFor(type: DialogOutputType): DialogOutput {
  switch (type) {
    case 'TEXT':
      return { type, payload: { text: '' } };
    case 'CARD':
      return { type, payload: { title: '' } };
    case 'IMAGE':
      return { type, payload: { imageUrl: '', altText: '' } };
    case 'BUTTON':
      return { type, payload: { buttons: [] } };
    case 'LINK':
      return { type, payload: { label: '', url: '', openInNewTab: true } };
    case 'PAUSE':
      return { type, payload: { durationMs: 1000 } };
    case 'PHONE_CALL':
      return { type, payload: { label: '', phoneNumber: '' } };
    case 'CONTEXT_FORM':
      return { type, payload: { contextVariableId: '' } };
    case 'DIALOG_MOVE':
      return { type, payload: { targetNodeId: '' } };
    case 'SCENARIO':
      return { type, payload: { scenarioKey: '' } };
    case 'SURVEY':
      return { type, payload: { surveyId: '' } };
    case 'API_CONDITION':
      return { type, payload: { method: 'GET', url: '', conditions: [] } };
    default:
      return { type: 'TEXT', payload: { text: '' } };
  }
}

let btnKeySeq = 0;
function newButtonItem(): ButtonItem & { key: string } {
  btnKeySeq += 1;
  return { key: `btn-${btnKeySeq}`, label: '', action: 'MESSAGE', value: '' };
}
let condKeySeq = 0;
function newCondition(): ApiConditionItem & { key: string } {
  condKeySeq += 1;
  return { key: `cond-${condKeySeq}`, path: '', operator: 'EQ', nextNodeId: '' };
}

/** 아웃풋 12종 타입별 폼(ui-spec §4.2.1). 타입 변경 시 새 서브폼의 첫 필드로 포커스를 이동시킨다. */
export function DialogOutputEditor({
  value,
  onChange,
  chatbotId,
  currentNodeId,
  idPrefix,
  errorFieldPrefix,
  fieldErrors,
}: DialogOutputEditorProps): JSX.Element {
  const msg = MESSAGES.dialogue.outputFields;
  const prevTypeRef = useRef(value.type);
  const firstFieldRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (prevTypeRef.current !== value.type) {
      prevTypeRef.current = value.type;
      firstFieldRef.current?.focus();
    }
  }, [value.type]);

  const err = (suffix: string): string | undefined => fieldErrors[`${errorFieldPrefix}.${suffix}`];

  function setPayload<T extends DialogOutput>(next: T): void {
    onChange(next);
  }

  return (
    <div className="output-card">
      <div className="output-card-header">
        <label htmlFor={`${idPrefix}-type`} className="field-label-static">
          {MESSAGES.dialogue.nodeForm.outputTypeLabel}
        </label>
        <select id={`${idPrefix}-type`} value={value.type} onChange={(e) => onChange(defaultPayloadFor(e.target.value as DialogOutputType))}>
          {OUTPUT_TYPES.map((t) => (
            <option key={t} value={t}>
              {MESSAGES.dialogue.outputTypes[t]}
            </option>
          ))}
        </select>
      </div>

      {(value.type === 'SCENARIO' || value.type === 'SURVEY' || value.type === 'API_CONDITION') && <UnsupportedOutputBadge />}

      {value.type === 'TEXT' && (
        <div className="form-field">
          <label htmlFor={`${idPrefix}-text`}>
            {msg.text} <span className="required-mark" aria-hidden="true">*</span>
          </label>
          <textarea
            id={`${idPrefix}-text`}
            ref={(el) => (firstFieldRef.current = el)}
            value={value.payload.text}
            maxLength={1000}
            rows={2}
            onChange={(e) => setPayload({ type: 'TEXT', payload: { text: e.target.value } })}
          />
          <p className="char-counter">{value.payload.text.length}/1000자</p>
          <InlineFieldError id={`${idPrefix}-text-error`} message={err('text')} />
        </div>
      )}

      {value.type === 'CARD' && (
        <div>
          <div className="form-field">
            <label htmlFor={`${idPrefix}-title`}>
              {msg.title} <span className="required-mark" aria-hidden="true">*</span>
            </label>
            <input
              id={`${idPrefix}-title`}
              ref={(el) => (firstFieldRef.current = el)}
              type="text"
              maxLength={100}
              value={value.payload.title}
              onChange={(e) => setPayload({ type: 'CARD', payload: { ...value.payload, title: e.target.value } })}
            />
            <InlineFieldError id={`${idPrefix}-title-error`} message={err('title')} />
          </div>
          <div className="form-field">
            <label htmlFor={`${idPrefix}-description`}>{msg.description}</label>
            <textarea
              id={`${idPrefix}-description`}
              maxLength={500}
              rows={2}
              value={value.payload.description ?? ''}
              onChange={(e) => setPayload({ type: 'CARD', payload: { ...value.payload, description: e.target.value || undefined } })}
            />
          </div>
          <div className="form-field">
            <label htmlFor={`${idPrefix}-image-url`}>{msg.imageUrl}</label>
            <input
              id={`${idPrefix}-image-url`}
              type="text"
              value={value.payload.imageUrl ?? ''}
              onChange={(e) => setPayload({ type: 'CARD', payload: { ...value.payload, imageUrl: e.target.value || undefined } })}
            />
          </div>
          {value.payload.imageUrl && (
            <div className="form-field">
              <label htmlFor={`${idPrefix}-alt-text`}>{msg.altTextRequiredHint}</label>
              <input
                id={`${idPrefix}-alt-text`}
                type="text"
                maxLength={200}
                value={value.payload.altText ?? ''}
                onChange={(e) => setPayload({ type: 'CARD', payload: { ...value.payload, altText: e.target.value || undefined } })}
                aria-invalid={Boolean(err('altText'))}
              />
              <InlineFieldError id={`${idPrefix}-alt-text-error`} message={err('altText') ?? (value.payload.imageUrl && !value.payload.altText ? msg.altTextRequiredError : undefined)} />
            </div>
          )}
          <ButtonListEditor
            buttons={value.payload.buttons ?? []}
            onChange={(buttons) => setPayload({ type: 'CARD', payload: { ...value.payload, buttons } })}
            chatbotId={chatbotId}
            idPrefix={`${idPrefix}-cardbtn`}
            maxItems={5}
          />
        </div>
      )}

      {value.type === 'IMAGE' && (
        <div>
          <div className="form-field">
            <label htmlFor={`${idPrefix}-image-url`}>
              {msg.imageUrl} <span className="required-mark" aria-hidden="true">*</span>
            </label>
            <input
              id={`${idPrefix}-image-url`}
              ref={(el) => (firstFieldRef.current = el)}
              type="text"
              value={value.payload.imageUrl}
              onChange={(e) => setPayload({ type: 'IMAGE', payload: { ...value.payload, imageUrl: e.target.value } })}
            />
            <InlineFieldError id={`${idPrefix}-image-url-error`} message={err('imageUrl')} />
          </div>
          <div className="form-field">
            <label htmlFor={`${idPrefix}-alt-text`}>{msg.altTextRequiredAlways}</label>
            <input
              id={`${idPrefix}-alt-text`}
              type="text"
              maxLength={200}
              value={value.payload.altText}
              onChange={(e) => setPayload({ type: 'IMAGE', payload: { ...value.payload, altText: e.target.value } })}
              aria-invalid={Boolean(err('altText'))}
            />
            <InlineFieldError id={`${idPrefix}-alt-text-error`} message={err('altText')} />
          </div>
        </div>
      )}

      {value.type === 'BUTTON' && (
        <div>
          <div className="form-field">
            <label htmlFor={`${idPrefix}-text`}>{msg.text}(선택)</label>
            <input
              id={`${idPrefix}-text`}
              ref={(el) => (firstFieldRef.current = el)}
              type="text"
              maxLength={500}
              value={value.payload.text ?? ''}
              onChange={(e) => setPayload({ type: 'BUTTON', payload: { ...value.payload, text: e.target.value || undefined } })}
            />
          </div>
          <ButtonListEditor
            buttons={value.payload.buttons}
            onChange={(buttons) => setPayload({ type: 'BUTTON', payload: { ...value.payload, buttons } })}
            chatbotId={chatbotId}
            idPrefix={`${idPrefix}-btn`}
            maxItems={5}
            minItems={1}
          />
          <InlineFieldError id={`${idPrefix}-buttons-error`} message={err('buttons')} />
        </div>
      )}

      {value.type === 'LINK' && (
        <div>
          <div className="form-field">
            <label htmlFor={`${idPrefix}-label`}>
              {msg.label} <span className="required-mark" aria-hidden="true">*</span>
            </label>
            <input
              id={`${idPrefix}-label`}
              ref={(el) => (firstFieldRef.current = el)}
              type="text"
              maxLength={40}
              value={value.payload.label}
              onChange={(e) => setPayload({ type: 'LINK', payload: { ...value.payload, label: e.target.value } })}
            />
          </div>
          <div className="form-field">
            <label htmlFor={`${idPrefix}-url`}>
              {msg.url} <span className="required-mark" aria-hidden="true">*</span>
            </label>
            <input
              id={`${idPrefix}-url`}
              type="text"
              value={value.payload.url}
              onChange={(e) => setPayload({ type: 'LINK', payload: { ...value.payload, url: e.target.value } })}
              aria-invalid={Boolean(err('url'))}
            />
            <InlineFieldError id={`${idPrefix}-url-error`} message={err('url') ?? undefined} />
          </div>
          <div className="form-field form-field--inline">
            <input
              id={`${idPrefix}-newtab`}
              type="checkbox"
              checked={value.payload.openInNewTab}
              onChange={(e) => setPayload({ type: 'LINK', payload: { ...value.payload, openInNewTab: e.target.checked } })}
            />
            <label htmlFor={`${idPrefix}-newtab`}>{msg.openInNewTab}</label>
          </div>
        </div>
      )}

      {value.type === 'PAUSE' && (
        <div className="form-field">
          <label htmlFor={`${idPrefix}-duration`}>{msg.durationMs}</label>
          <input
            id={`${idPrefix}-duration`}
            ref={(el) => (firstFieldRef.current = el)}
            type="number"
            min={100}
            max={5000}
            value={value.payload.durationMs}
            onChange={(e) => setPayload({ type: 'PAUSE', payload: { durationMs: Number(e.target.value) } })}
          />
          <p className="field-hint">{msg.durationHelp}</p>
        </div>
      )}

      {value.type === 'PHONE_CALL' && (
        <div>
          <div className="form-field">
            <label htmlFor={`${idPrefix}-label`}>
              {msg.label} <span className="required-mark" aria-hidden="true">*</span>
            </label>
            <input
              id={`${idPrefix}-label`}
              ref={(el) => (firstFieldRef.current = el)}
              type="text"
              maxLength={40}
              value={value.payload.label}
              onChange={(e) => setPayload({ type: 'PHONE_CALL', payload: { ...value.payload, label: e.target.value } })}
            />
          </div>
          <div className="form-field">
            <label htmlFor={`${idPrefix}-phone`}>{msg.phoneNumber}</label>
            <input
              id={`${idPrefix}-phone`}
              type="text"
              value={value.payload.phoneNumber}
              onChange={(e) => setPayload({ type: 'PHONE_CALL', payload: { ...value.payload, phoneNumber: e.target.value } })}
              aria-invalid={Boolean(err('phoneNumber'))}
            />
            <InlineFieldError id={`${idPrefix}-phone-error`} message={err('phoneNumber')} />
            <p className="field-hint">{msg.phoneCallHelp}</p>
          </div>
        </div>
      )}

      {value.type === 'CONTEXT_FORM' && (
        <ResourcePickerField
          ref={firstFieldRef as never}
          id={`${idPrefix}-context`}
          label={msg.contextVariable}
          resourceType="context"
          chatbotId={chatbotId}
          multiple={false}
          value={value.payload.contextVariableId || null}
          onChange={(v) => setPayload({ type: 'CONTEXT_FORM', payload: { contextVariableId: (v as string) ?? '' } })}
          required
          errorMessage={err('contextVariableId')}
        />
      )}

      {value.type === 'DIALOG_MOVE' && (
        <ResourcePickerField
          ref={firstFieldRef as never}
          id={`${idPrefix}-target-node`}
          label={msg.targetNode}
          resourceType="node"
          chatbotId={chatbotId}
          multiple={false}
          value={value.payload.targetNodeId || null}
          onChange={(v) => setPayload({ type: 'DIALOG_MOVE', payload: { targetNodeId: (v as string) ?? '' } })}
          excludeIds={currentNodeId ? [currentNodeId] : []}
          required
          helpText={msg.targetNodeHelp}
          errorMessage={err('targetNodeId')}
        />
      )}

      {value.type === 'SCENARIO' && (
        <div className="form-field">
          <label htmlFor={`${idPrefix}-scenario-key`}>
            {msg.scenarioKey} <span className="required-mark" aria-hidden="true">*</span>
          </label>
          <input
            id={`${idPrefix}-scenario-key`}
            ref={(el) => (firstFieldRef.current = el)}
            type="text"
            maxLength={100}
            value={value.payload.scenarioKey}
            onChange={(e) => setPayload({ type: 'SCENARIO', payload: { ...value.payload, scenarioKey: e.target.value } })}
          />
        </div>
      )}

      {value.type === 'SURVEY' && (
        <div className="form-field">
          <label htmlFor={`${idPrefix}-survey-id`}>
            {msg.surveyId} <span className="required-mark" aria-hidden="true">*</span>
          </label>
          <input
            id={`${idPrefix}-survey-id`}
            ref={(el) => (firstFieldRef.current = el)}
            type="text"
            maxLength={100}
            value={value.payload.surveyId}
            onChange={(e) => setPayload({ type: 'SURVEY', payload: { surveyId: e.target.value } })}
          />
        </div>
      )}

      {value.type === 'API_CONDITION' && (
        <ApiConditionEditor
          value={value.payload}
          onChange={(payload) => setPayload({ type: 'API_CONDITION', payload })}
          chatbotId={chatbotId}
          idPrefix={`${idPrefix}-api`}
          firstFieldRef={firstFieldRef}
          fieldErrors={fieldErrors}
          errPrefix={errorFieldPrefix}
        />
      )}
    </div>
  );
}

/** 버튼 목록(카드/버튼 아웃풋 공용) — `ReorderableList` 재사용, 드래그 없이 위/아래 버튼만 제공. */
function ButtonListEditor({
  buttons,
  onChange,
  chatbotId,
  idPrefix,
  maxItems,
  minItems = 0,
}: {
  buttons: ButtonItem[];
  onChange: (buttons: ButtonItem[]) => void;
  chatbotId: string;
  idPrefix: string;
  maxItems: number;
  minItems?: number;
}): JSX.Element {
  const rows = buttons.map((b, i) => ({ ...b, key: `${idPrefix}-${i}` }));
  return (
    <div className="form-field">
      <span className="field-label-static">{MESSAGES.dialogue.outputFields.buttons}</span>
      <ReorderableList
        items={rows}
        getKey={(r) => r.key}
        onChange={(next) => onChange(next.map(({ key: _key, ...rest }) => rest))}
        minItems={minItems}
        maxItems={maxItems}
        onAdd={() => onChange([...buttons, newButtonItem()])}
        addLabel={MESSAGES.dialogue.outputFields.addButton}
        onRemove={(key) => onChange(rows.filter((r) => r.key !== key).map(({ key: _key, ...rest }) => rest))}
        itemLabel={(r, i) => `${i + 1}번째 버튼(${r.label || '레이블 없음'})`}
        renderItem={(r, index) => (
          <ButtonItemEditor
            value={r}
            onChange={(next) => {
              const nextRows = [...rows];
              nextRows[index] = { ...next, key: r.key };
              onChange(nextRows.map(({ key: _key, ...rest }) => rest));
            }}
            chatbotId={chatbotId}
            idPrefix={`${idPrefix}-item-${index}`}
          />
        )}
      />
    </div>
  );
}

/** ⑫ API 조건분기(FR-5-14) — 실행되지 않지만 저장/정의는 지원한다(AC-5-7). */
function ApiConditionEditor({
  value,
  onChange,
  chatbotId,
  idPrefix,
  firstFieldRef,
  fieldErrors,
  errPrefix,
}: {
  value: { method: string; url: string; headers?: Record<string, string>; bodyTemplate?: string; conditions: ApiConditionItem[] };
  onChange: (v: { method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'; url: string; headers?: Record<string, string>; bodyTemplate?: string; conditions: ApiConditionItem[] }) => void;
  chatbotId: string;
  idPrefix: string;
  firstFieldRef: MutableRefObject<HTMLElement | null>;
  fieldErrors: Record<string, string>;
  errPrefix: string;
}): JSX.Element {
  const msg = MESSAGES.dialogue.outputFields;
  const [showHeaders, setShowHeaders] = useState(false);
  const headerEntries = Object.entries(value.headers ?? {});
  const conditionRows = value.conditions.map((c, i) => ({ ...c, key: `${idPrefix}-cond-${i}` }));

  function updateHeaders(entries: [string, string][]): void {
    onChange({ ...value, headers: Object.fromEntries(entries.filter(([k]) => k.trim())) } as never);
  }

  return (
    <div>
      <div className="key-value-row">
        <div className="form-field">
          <label htmlFor={`${idPrefix}-method`}>{msg.apiMethod}</label>
          <select
            id={`${idPrefix}-method`}
            ref={(el) => (firstFieldRef.current = el)}
            value={value.method}
            onChange={(e) => onChange({ ...value, method: e.target.value } as never)}
          >
            {['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>
        <div className="form-field">
          <label htmlFor={`${idPrefix}-url`}>{msg.apiUrl}</label>
          <input id={`${idPrefix}-url`} type="text" value={value.url} onChange={(e) => onChange({ ...value, url: e.target.value } as never)} />
          <InlineFieldError id={`${idPrefix}-url-error`} message={fieldErrors[`${errPrefix}.url`]} />
        </div>
      </div>

      <div className="form-field">
        <span className="field-label-static">{msg.apiHeaders}</span>
        {headerEntries.map(([k, v], i) => (
          <div key={i} className="key-value-row">
            <input
              type="text"
              placeholder="key"
              value={k}
              onChange={(e) => {
                const next = [...headerEntries];
                next[i] = [e.target.value, v];
                updateHeaders(next);
              }}
            />
            <input
              type={showHeaders ? 'text' : 'password'}
              placeholder="value"
              value={v}
              onChange={(e) => {
                const next = [...headerEntries];
                next[i] = [k, e.target.value];
                updateHeaders(next);
              }}
            />
            <button type="button" className="btn btn-secondary" onClick={() => updateHeaders(headerEntries.filter((_, idx) => idx !== i))}>
              {MESSAGES.dialogue.nodeForm.removeOutput}
            </button>
          </div>
        ))}
        <div className="dialogue-toolbar-actions">
          <button type="button" className="btn btn-secondary" onClick={() => updateHeaders([...headerEntries, ['', '']])}>
            + 헤더 추가
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => setShowHeaders((v) => !v)}>
            {showHeaders ? msg.hideValue : msg.showValue}
          </button>
        </div>
        <p className="field-hint">{msg.apiHeadersHelp}</p>
      </div>

      <div className="form-field">
        <label htmlFor={`${idPrefix}-body`}>{msg.apiBody}</label>
        <textarea
          id={`${idPrefix}-body`}
          maxLength={4000}
          rows={3}
          value={value.bodyTemplate ?? ''}
          onChange={(e) => onChange({ ...value, bodyTemplate: e.target.value || undefined } as never)}
        />
      </div>

      <div className="form-field">
        <span className="field-label-static">{msg.apiConditions}</span>
        <ReorderableList
          items={conditionRows}
          getKey={(c) => c.key}
          onChange={(next) => onChange({ ...value, conditions: next.map(({ key: _key, ...rest }) => rest) } as never)}
          minItems={1}
          maxItems={10}
          onAdd={() => onChange({ ...value, conditions: [...value.conditions, newCondition()] } as never)}
          addLabel={msg.addCondition}
          onRemove={(key) => onChange({ ...value, conditions: conditionRows.filter((c) => c.key !== key).map(({ key: _key, ...rest }) => rest) } as never)}
          itemLabel={(c, i) => `${i + 1}번째 조건`}
          renderItem={(c, index) => (
            <div className="key-value-row">
              <div className="form-field">
                <label htmlFor={`${idPrefix}-cond-${index}-path`}>{msg.conditionPath}</label>
                <input
                  id={`${idPrefix}-cond-${index}-path`}
                  type="text"
                  value={c.path}
                  onChange={(e) => {
                    const next = [...conditionRows];
                    next[index] = { ...c, path: e.target.value };
                    onChange({ ...value, conditions: next.map(({ key: _key, ...rest }) => rest) } as never);
                  }}
                />
              </div>
              <div className="form-field">
                <label htmlFor={`${idPrefix}-cond-${index}-op`}>{msg.conditionOperator}</label>
                <select
                  id={`${idPrefix}-cond-${index}-op`}
                  value={c.operator}
                  onChange={(e) => {
                    const next = [...conditionRows];
                    next[index] = { ...c, operator: e.target.value as ApiConditionItem['operator'] };
                    onChange({ ...value, conditions: next.map(({ key: _key, ...rest }) => rest) } as never);
                  }}
                >
                  {['EQ', 'NEQ', 'GT', 'GTE', 'LT', 'LTE', 'CONTAINS', 'EXISTS'].map((op) => (
                    <option key={op} value={op}>
                      {op}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-field">
                <label htmlFor={`${idPrefix}-cond-${index}-value`}>{msg.conditionValue}</label>
                <input
                  id={`${idPrefix}-cond-${index}-value`}
                  type="text"
                  value={c.value ?? ''}
                  onChange={(e) => {
                    const next = [...conditionRows];
                    next[index] = { ...c, value: e.target.value || undefined };
                    onChange({ ...value, conditions: next.map(({ key: _key, ...rest }) => rest) } as never);
                  }}
                />
              </div>
              <ResourcePickerField
                id={`${idPrefix}-cond-${index}-next`}
                label={msg.conditionNextNode}
                resourceType="node"
                chatbotId={chatbotId}
                multiple={false}
                value={c.nextNodeId || null}
                onChange={(v) => {
                  const next = [...conditionRows];
                  next[index] = { ...c, nextNodeId: (v as string) ?? '' };
                  onChange({ ...value, conditions: next.map(({ key: _key, ...rest }) => rest) } as never);
                }}
              />
            </div>
          )}
        />
      </div>
    </div>
  );
}
