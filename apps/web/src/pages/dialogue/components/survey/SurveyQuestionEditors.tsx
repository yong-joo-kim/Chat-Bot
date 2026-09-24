import type { SurveyQuestionType, SurveyScaleKind } from '@chat-bot/shared-types';
import { ReorderableList } from '../../../../components/ReorderableList';
import { InlineFieldError } from '../../../../components/InlineFieldError';
import { MESSAGES } from '../../../../constants/messages';
import { newChoiceDraft, newQuestionDraft, type SurveyChoiceDraft, type SurveyQuestionDraft } from './types';

const QUESTION_TYPES: SurveyQuestionType[] = ['SINGLE_CHOICE', 'MULTI_CHOICE', 'SCALE', 'TEXT'];
const SCALE_KINDS: SurveyScaleKind[] = ['STAR_5', 'NPS_11'];

/** ui-spec §2.2 `SurveyChoiceListEditor` — `locked`면 라벨은 활성, 추가·삭제·순서 버튼만 비활성. */
function SurveyChoiceListEditor({
  items,
  onChange,
  locked,
  idPrefix,
  fieldErrors,
  errPrefix,
}: {
  items: SurveyChoiceDraft[];
  onChange: (items: SurveyChoiceDraft[]) => void;
  locked: boolean;
  idPrefix: string;
  fieldErrors: Record<string, string>;
  errPrefix: string;
}): JSX.Element {
  const msg = MESSAGES.surveys;
  return (
    <div className="form-field">
      <span className="field-label-static">{msg.choicesTitle(items.length, 10)}</span>
      {locked && <p className="field-hint">{msg.structureLockStructureDisabledReason}</p>}
      <ReorderableList
        items={items}
        getKey={(c) => c.localKey}
        onChange={onChange}
        minItems={2}
        maxItems={10}
        reorderDisabled={locked}
        onAdd={() => onChange([...items, newChoiceDraft()])}
        addDisabled={locked}
        addLabel={msg.addChoice}
        removeDisabled={locked}
        onRemove={(localKey) => onChange(items.filter((c) => c.localKey !== localKey))}
        itemLabel={(c, i) => `${i + 1}번째 선택지(${c.label || '이름 없음'})`}
        renderItem={(c, index) => (
          <div className="form-field">
            <label htmlFor={`${idPrefix}-choice-${index}`} className="sr-only">
              {msg.choiceLabelPlaceholder} {index + 1}
            </label>
            <input
              id={`${idPrefix}-choice-${index}`}
              type="text"
              maxLength={40}
              value={c.label}
              placeholder={msg.choiceLabelPlaceholder}
              onChange={(e) => {
                const next = [...items];
                next[index] = { ...c, label: e.target.value };
                onChange(next);
              }}
              aria-invalid={Boolean(fieldErrors[`${errPrefix}.choices.${index}.label`])}
            />
            <InlineFieldError id={`${idPrefix}-choice-${index}-error`} message={fieldErrors[`${errPrefix}.choices.${index}.label`]} />
          </div>
        )}
      />
      <InlineFieldError id={`${idPrefix}-choices-error`} message={fieldErrors[`${errPrefix}.choices`]} />
    </div>
  );
}

export interface SurveyQuestionCardProps {
  question: SurveyQuestionDraft;
  onChange: (q: SurveyQuestionDraft) => void;
  locked: boolean;
  idPrefix: string;
  fieldErrors: Record<string, string>;
  errPrefix: string;
}

/** ui-spec §3.2 `SurveyQuestionCard` — 유형 전환은 하위 서브폼만 바꾼다(자동 제출 아님, UIUX §6). */
export function SurveyQuestionCard({ question: q, onChange, locked, idPrefix, fieldErrors, errPrefix }: SurveyQuestionCardProps): JSX.Element {
  const msg = MESSAGES.surveys;
  const err = (suffix: string): string | undefined => fieldErrors[`${errPrefix}.${suffix}`];

  return (
    <div className="survey-question-card">
      <div className="form-field form-field--inline">
        <label htmlFor={`${idPrefix}-type`}>{msg.questionTypeLabel}</label>
        <select
          id={`${idPrefix}-type`}
          value={q.type}
          disabled={locked}
          onChange={(e) => onChange({ ...newQuestionDraft(e.target.value as SurveyQuestionType), key: q.key, localKey: q.localKey, prompt: q.prompt, required: q.required })}
        >
          {QUESTION_TYPES.map((t) => (
            <option key={t} value={t}>
              {msg.questionType[t]}
            </option>
          ))}
        </select>
        <label htmlFor={`${idPrefix}-required`} className="form-field--inline">
          <input
            id={`${idPrefix}-required`}
            type="checkbox"
            checked={q.required}
            disabled={locked}
            onChange={(e) => onChange({ ...q, required: e.target.checked })}
          />
          {msg.requiredLabel}
        </label>
      </div>

      <div className="form-field">
        <label htmlFor={`${idPrefix}-prompt`}>
          {msg.promptLabel} <span className="required-mark" aria-hidden="true">*</span>
        </label>
        <textarea
          id={`${idPrefix}-prompt`}
          rows={2}
          maxLength={300}
          value={q.prompt}
          onChange={(e) => onChange({ ...q, prompt: e.target.value })}
          aria-invalid={Boolean(err('prompt'))}
        />
        <p className="char-counter">{q.prompt.length}/300자</p>
        <InlineFieldError id={`${idPrefix}-prompt-error`} message={err('prompt')} />
      </div>

      {(q.type === 'SINGLE_CHOICE' || q.type === 'MULTI_CHOICE') && (
        <>
          <SurveyChoiceListEditor
            items={q.choices}
            onChange={(choices) => onChange({ ...q, choices })}
            locked={locked}
            idPrefix={idPrefix}
            fieldErrors={fieldErrors}
            errPrefix={errPrefix}
          />
          {q.type === 'MULTI_CHOICE' && (
            <div className="form-field form-field--inline">
              <label htmlFor={`${idPrefix}-min-select`}>{msg.minSelectLabel}</label>
              <input
                id={`${idPrefix}-min-select`}
                type="number"
                min={1}
                max={q.choices.length}
                value={q.minSelect}
                disabled={locked}
                onChange={(e) => onChange({ ...q, minSelect: Number(e.target.value) })}
              />
              <label htmlFor={`${idPrefix}-max-select`}>{msg.maxSelectLabel}</label>
              <input
                id={`${idPrefix}-max-select`}
                type="number"
                min={1}
                max={q.choices.length}
                value={q.maxSelect}
                disabled={locked}
                onChange={(e) => onChange({ ...q, maxSelect: Number(e.target.value) })}
              />
              <InlineFieldError id={`${idPrefix}-min-select-error`} message={err('minSelect') ?? err('maxSelect')} />
            </div>
          )}
        </>
      )}

      {q.type === 'SCALE' && (
        <>
          <fieldset className="form-field" role="radiogroup" aria-label={msg.scaleKindLabel}>
            <legend>{msg.scaleKindLabel}</legend>
            {SCALE_KINDS.map((k) => (
              <label key={k} className="form-field--inline">
                <input
                  type="radio"
                  name={`${idPrefix}-scale-kind`}
                  checked={q.scale === k}
                  disabled={locked}
                  onChange={() => onChange({ ...q, scale: k })}
                />
                {msg.scaleKind[k]}
              </label>
            ))}
            <InlineFieldError id={`${idPrefix}-scale-error`} message={err('scale')} />
          </fieldset>
          <div className="form-field form-field--inline">
            <label htmlFor={`${idPrefix}-low-label`}>{msg.scaleLowLabel}</label>
            <input id={`${idPrefix}-low-label`} type="text" maxLength={20} value={q.lowLabel} onChange={(e) => onChange({ ...q, lowLabel: e.target.value })} />
            <label htmlFor={`${idPrefix}-high-label`}>{msg.scaleHighLabel}</label>
            <input id={`${idPrefix}-high-label`} type="text" maxLength={20} value={q.highLabel} onChange={(e) => onChange({ ...q, highLabel: e.target.value })} />
          </div>
        </>
      )}

      {q.type === 'TEXT' && (
        <>
          <div className="form-field">
            <label htmlFor={`${idPrefix}-max-length`}>{msg.textMaxLengthLabel}</label>
            <input
              id={`${idPrefix}-max-length`}
              type="number"
              min={1}
              max={500}
              value={q.maxLength}
              disabled={locked}
              onChange={(e) => onChange({ ...q, maxLength: Number(e.target.value) })}
            />
          </div>
          <p className="field-hint">
            <span aria-hidden="true">ⓘ</span> {msg.piiNotice}
          </p>
        </>
      )}
    </div>
  );
}

/** ui-spec §2.2 `SurveyQuestionListEditor` — `ReorderableList` 재사용, `locked`면 추가·삭제·순서 비활성. */
export function SurveyQuestionListEditor({
  items,
  onChange,
  locked,
  fieldErrors,
  errPrefix,
}: {
  items: SurveyQuestionDraft[];
  onChange: (items: SurveyQuestionDraft[]) => void;
  locked: boolean;
  fieldErrors: Record<string, string>;
  errPrefix: string;
}): JSX.Element {
  const msg = MESSAGES.surveys;
  return (
    <div className="form-field">
      <span className="field-label-static">{msg.questionsTitle(items.length, 20)}</span>
      {locked && <p className="field-hint">{msg.structureLockStructureDisabledReason}</p>}
      <ReorderableList
        items={items}
        getKey={(q) => q.localKey}
        onChange={onChange}
        minItems={0}
        maxItems={20}
        reorderDisabled={locked}
        onAdd={() => onChange([...items, newQuestionDraft()])}
        addDisabled={locked}
        addLabel={msg.addQuestion}
        removeDisabled={locked}
        onRemove={(localKey) => onChange(items.filter((q) => q.localKey !== localKey))}
        itemLabel={(q, i) => `${i + 1}번째 문항(${q.prompt || '문구 없음'})`}
        renderItem={(q, index) => (
          <SurveyQuestionCard
            question={q}
            onChange={(next) => {
              const nextItems = [...items];
              nextItems[index] = next;
              onChange(nextItems);
            }}
            locked={locked}
            idPrefix={`survey-q-${q.localKey}`}
            fieldErrors={fieldErrors}
            errPrefix={`${errPrefix}.${index}`}
          />
        )}
      />
    </div>
  );
}
