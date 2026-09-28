import { useState, type FormEvent } from 'react';
import type { ButtonItem, ProactiveRuleInput, ProactiveRuleView, ProactiveSchedule } from '@chat-bot/shared-types';
import { PROACTIVE_LIMITS } from '@chat-bot/shared-types';
import { matchesPathCondition } from '@chat-bot/shared-types/proactive-eval';
import { Modal } from '../../../components/Modal';
import { InlineFieldError } from '../../../components/InlineFieldError';
import { ReorderableList } from '../../../components/ReorderableList';
import { ButtonItemEditor } from '../../dialogue/components/ButtonItemEditor';
import { ApiError } from '../../../api/client';
import { proactiveApi } from '../../../api/proactive';
import { MESSAGES } from '../../../constants/messages';
import { ProactiveBubblePreview } from './ProactiveBubblePreview';

export interface ProactiveRuleEditModalProps {
  isOpen: boolean;
  chatbotId: string;
  /** 수정 대상(없으면 생성) · 복제 시에는 id 없이 나머지 값만 채운 임시 객체를 넘긴다(§3.3 복제). */
  rule: ProactiveRuleView | null;
  onClose: () => void;
  onSaved: () => void;
  primaryColor: string;
}

const DAY_LABELS: { value: number; label: string }[] = [
  { value: 0, label: '월' },
  { value: 1, label: '화' },
  { value: 2, label: '수' },
  { value: 3, label: '목' },
  { value: 4, label: '금' },
  { value: 5, label: '토' },
  { value: 6, label: '일' },
];

function toDatetimeLocal(d: Date | null | undefined): string {
  if (!d) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

let pathKeySeq = 0;
function toPathRows(values: string[]): { key: string; value: string }[] {
  return values.map((value) => ({ key: `p${pathKeySeq++}`, value }));
}

/**
 * [신규 No.35] PA-C4 — 선제 안내 규칙 생성·수정 모달(화면 설계서 §3.4). 트리거 종류는 `PAGE_DWELL`
 * 1종뿐이라 라디오가 아니라 고정 텍스트로 렌더한다. 용도 확인 체크박스는 생성·수정 모두 **매번
 * 미체크로 시작**한다(FR-PA1-8 — 사전 체크 금지).
 */
export function ProactiveRuleEditModal({ isOpen, chatbotId, rule, onClose, onSaved, primaryColor }: ProactiveRuleEditModalProps): JSX.Element {
  const msg = MESSAGES.proactive.editor;
  const editing = rule && rule.id;

  const [name, setName] = useState(rule?.name ?? '');
  const [pathIncludeRows, setPathIncludeRows] = useState(() =>
    toPathRows(rule?.trigger.kind === 'PAGE_DWELL' && rule.trigger.pathInclude.length > 0 ? rule.trigger.pathInclude : ['']),
  );
  const [pathExcludeRows, setPathExcludeRows] = useState(() => toPathRows(rule?.trigger.kind === 'PAGE_DWELL' ? rule.trigger.pathExclude : []));
  const [dwellSec, setDwellSec] = useState(rule?.trigger.kind === 'PAGE_DWELL' ? rule.trigger.dwellSec : PROACTIVE_LIMITS.dwellSecDefault);
  const [pathTestInput, setPathTestInput] = useState('');
  const [text, setText] = useState(rule?.text ?? '');
  const [buttons, setButtons] = useState<ButtonItem[]>(rule?.buttons ?? []);
  const [devices, setDevices] = useState<('DESKTOP' | 'MOBILE')[]>(rule?.devices ?? ['DESKTOP']);
  const [startsAt, setStartsAt] = useState(toDatetimeLocal(rule?.startsAt ?? null));
  const [endsAt, setEndsAt] = useState(toDatetimeLocal(rule?.endsAt ?? null));
  const [scheduleEnabled, setScheduleEnabled] = useState(Boolean(rule?.schedule));
  const [scheduleDays, setScheduleDays] = useState<number[]>(rule?.schedule?.days ?? [0, 1, 2, 3, 4]);
  const [scheduleFrom, setScheduleFrom] = useState(rule?.schedule?.from ?? '09:00');
  const [scheduleTo, setScheduleTo] = useState(rule?.schedule?.to ?? '18:00');
  // FR-PA1-8 — 생성·수정 모두 매번 미체크 상태로 시작한다(이전 체크값을 기억하지 않음).
  const [purposeConfirmed, setPurposeConfirmed] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [buttonErrors, setButtonErrors] = useState<Record<number, { label?: string; value?: string }>>({});
  const [banner, setBanner] = useState<string | undefined>(undefined);
  const [submitting, setSubmitting] = useState(false);

  const pathInclude = pathIncludeRows.map((r) => r.value.trim()).filter((v) => v.length > 0);
  const pathExclude = pathExcludeRows.map((r) => r.value.trim()).filter((v) => v.length > 0);

  const pathTestResult =
    pathTestInput.trim().length === 0
      ? undefined
      : (() => {
          const included = pathInclude.some((p) => matchesPathCondition([p], [], pathTestInput.trim()));
          if (!included) return 'no-include' as const;
          return matchesPathCondition(pathInclude, pathExclude, pathTestInput.trim()) ? ('ok' as const) : ('excluded' as const);
        })();

  function toggleDevice(d: 'DESKTOP' | 'MOBILE'): void {
    setDevices((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]));
  }

  function toggleScheduleDay(d: number): void {
    setScheduleDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]));
  }

  function addButton(): void {
    setButtons((prev) => [...prev, { label: '', action: 'MESSAGE', value: '' }]);
  }

  function updateButton(index: number, value: ButtonItem): void {
    setButtons((prev) => prev.map((b, i) => (i === index ? value : b)));
  }

  function removeButton(index: number): void {
    setButtons((prev) => prev.filter((_, i) => i !== index));
  }

  function validate(): { errors: Record<string, string>; btnErrors: Record<number, { label?: string; value?: string }> } {
    const errors: Record<string, string> = {};
    const trimmedName = name.trim();
    if (!trimmedName) errors.name = msg.errorNameRequired;
    else if (trimmedName.length > PROACTIVE_LIMITS.nameMax) errors.name = msg.errorNameTooLong;

    if (pathInclude.length === 0) errors.pathInclude = msg.errorPathIncludeRequired;
    else if (pathInclude.length > PROACTIVE_LIMITS.pathPatternsIncludeMax) errors.pathInclude = msg.errorPathIncludeTooMany;
    if (pathExclude.length > PROACTIVE_LIMITS.pathPatternsExcludeMax) errors.pathExclude = msg.errorPathExcludeTooMany;

    if (dwellSec < PROACTIVE_LIMITS.dwellSecMin || dwellSec > PROACTIVE_LIMITS.dwellSecMax) errors.dwellSec = msg.errorDwellSecRange;

    const trimmedText = text.trim();
    if (!trimmedText) errors.text = msg.errorTextRequired;
    else if (trimmedText.length > PROACTIVE_LIMITS.textMax) errors.text = msg.errorTextTooLong;
    else if ((trimmedText.match(/\n/g) ?? []).length > PROACTIVE_LIMITS.textMaxNewlines) errors.text = msg.errorTextTooManyLines;
    else if (/\{[^{}]*\}/.test(trimmedText)) errors.text = msg.errorTextSubstitution;

    const btnErrors: Record<number, { label?: string; value?: string }> = {};
    buttons.forEach((b, i) => {
      const e: { label?: string; value?: string } = {};
      if (!b.label.trim()) e.label = msg.errorButtonLabelRequired;
      else if (b.label.length > PROACTIVE_LIMITS.buttonLabelMax) e.label = msg.errorButtonLabelTooLong;
      if (b.action === 'NODE' && !b.value) e.value = msg.errorButtonNodeRequired;
      if (b.action === 'MESSAGE' && (!b.value || b.value.length > PROACTIVE_LIMITS.messageTextMax)) e.value = msg.errorButtonMessageRequired;
      if (b.action === 'LINK' && !/^https:\/\//.test(b.value)) e.value = msg.errorButtonLinkHttps;
      if (e.label || e.value) btnErrors[i] = e;
    });

    if (devices.length === 0) errors.devices = msg.errorDevicesRequired;

    if (startsAt && endsAt && new Date(startsAt).getTime() >= new Date(endsAt).getTime()) errors.period = msg.errorPeriodOrder;

    if (scheduleEnabled) {
      if (scheduleDays.length === 0) errors.scheduleDays = msg.errorScheduleDaysRequired;
      if (scheduleFrom >= scheduleTo) errors.schedule = msg.errorScheduleOrder;
    }

    if (!purposeConfirmed) errors.purposeConfirmed = msg.errorPurposeRequired;

    return { errors, btnErrors };
  }

  async function handleSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setBanner(undefined);
    const { errors, btnErrors } = validate();
    if (Object.keys(errors).length > 0 || Object.keys(btnErrors).length > 0) {
      setFieldErrors(errors);
      setButtonErrors(btnErrors);
      return;
    }
    setFieldErrors({});
    setButtonErrors({});
    setSubmitting(true);
    try {
      const dto: ProactiveRuleInput = {
        name: name.trim(),
        trigger: { kind: 'PAGE_DWELL', pathInclude, pathExclude, dwellSec },
        text: text.trim(),
        buttons: buttons as ProactiveRuleInput['buttons'],
        devices,
        // apiClient가 JSON.stringify로 직렬화하며 Date는 자동으로 ISO 문자열이 된다(서버는 coerce).
        startsAt: startsAt ? new Date(startsAt) : undefined,
        endsAt: endsAt ? new Date(endsAt) : undefined,
        schedule: scheduleEnabled ? ({ days: scheduleDays, from: scheduleFrom, to: scheduleTo } as ProactiveSchedule) : null,
        purposeConfirmed: true,
      };
      if (editing) {
        await proactiveApi.updateRule(chatbotId, rule!.id, dto);
      } else {
        await proactiveApi.createRule(chatbotId, dto);
      }
      onSaved();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'DUPLICATE_NAME') {
        setFieldErrors({ name: msg.errorNameDuplicate });
      } else if (err instanceof ApiError && err.code === 'LIMIT_EXCEEDED') {
        setBanner(msg.errorRuleLimit);
      } else if (err instanceof ApiError && err.code === 'INVALID_REFERENCE') {
        const idx = buttons.findIndex((b) => b.action === 'NODE');
        if (idx >= 0) setButtonErrors({ [idx]: { value: msg.errorButtonNodeInvalid } });
        else setBanner(err.message);
      } else if (err instanceof ApiError && err.code === 'VALIDATION_FAILED' && err.details?.some((d) => d.field === 'text')) {
        setFieldErrors({ text: msg.errorTextBannedWord });
      } else if (err instanceof ApiError) {
        setBanner(err.message);
      } else {
        setBanner(msg.saveFailed);
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal isOpen={isOpen} title={editing ? msg.titleEdit(rule!.name) : msg.titleNew} onClose={onClose}>
      <form onSubmit={(e) => void handleSubmit(e)} noValidate>
        {banner && (
          <p className="form-banner form-banner--error" role="alert">
            {banner}
          </p>
        )}

        <div className="form-field">
          <label htmlFor="pa-rule-name">
            {msg.nameLabel} <span className="required-mark" aria-hidden="true">*</span>
          </label>
          <input id="pa-rule-name" type="text" maxLength={PROACTIVE_LIMITS.nameMax} value={name} onChange={(e) => setName(e.target.value)} aria-invalid={Boolean(fieldErrors.name)} />
          <InlineFieldError id="pa-rule-name-error" message={fieldErrors.name} />
        </div>

        <h3>{msg.triggerKindFixedLabel}</h3>
        <p className="field-hint">
          {msg.triggerKindFixedValue} — {msg.triggerKindFixedHint}
        </p>

        <fieldset className="form-field">
          <legend>{msg.pathIncludeLabel}</legend>
          <ReorderableList
            items={pathIncludeRows}
            getKey={(r) => r.key}
            onChange={setPathIncludeRows}
            maxItems={PROACTIVE_LIMITS.pathPatternsIncludeMax}
            onAdd={() => setPathIncludeRows((prev) => [...prev, { key: `p${pathKeySeq++}`, value: '' }])}
            addLabel={msg.addPathButton}
            onRemove={(key) => setPathIncludeRows((prev) => prev.filter((r) => r.key !== key))}
            itemLabel={(_r, i) => `포함 경로 ${i + 1}`}
            renderItem={(r) => (
              <input
                type="text"
                aria-label={msg.pathIncludeLabel}
                placeholder="/order/**"
                value={r.value}
                onChange={(e) => setPathIncludeRows((prev) => prev.map((row) => (row.key === r.key ? { ...row, value: e.target.value } : row)))}
              />
            )}
          />
          <p className="field-hint">{msg.pathHint}</p>
          <InlineFieldError id="pa-rule-path-include-error" message={fieldErrors.pathInclude} />
        </fieldset>

        <fieldset className="form-field">
          <legend>{msg.pathExcludeLabel}</legend>
          <ReorderableList
            items={pathExcludeRows}
            getKey={(r) => r.key}
            onChange={setPathExcludeRows}
            maxItems={PROACTIVE_LIMITS.pathPatternsExcludeMax}
            onAdd={() => setPathExcludeRows((prev) => [...prev, { key: `p${pathKeySeq++}`, value: '' }])}
            addLabel={msg.addPathButton}
            onRemove={(key) => setPathExcludeRows((prev) => prev.filter((r) => r.key !== key))}
            itemLabel={(_r, i) => `제외 경로 ${i + 1}`}
            renderItem={(r) => (
              <input
                type="text"
                aria-label={msg.pathExcludeLabel}
                placeholder="/order/complete"
                value={r.value}
                onChange={(e) => setPathExcludeRows((prev) => prev.map((row) => (row.key === r.key ? { ...row, value: e.target.value } : row)))}
              />
            )}
          />
          <InlineFieldError id="pa-rule-path-exclude-error" message={fieldErrors.pathExclude} />
        </fieldset>

        <div className="form-field">
          <label htmlFor="pa-rule-dwell">{msg.dwellSecLabel}</label>
          <input
            id="pa-rule-dwell"
            type="number"
            min={PROACTIVE_LIMITS.dwellSecMin}
            max={PROACTIVE_LIMITS.dwellSecMax}
            value={dwellSec}
            onChange={(e) => setDwellSec(Number(e.target.value))}
            aria-invalid={Boolean(fieldErrors.dwellSec)}
          />
          <p className="field-hint">{msg.dwellSecHint}</p>
          <InlineFieldError id="pa-rule-dwell-error" message={fieldErrors.dwellSec} />
        </div>

        <div className="form-field">
          <label htmlFor="pa-rule-path-test">{msg.pathTestLabel}</label>
          <input id="pa-rule-path-test" type="text" placeholder={msg.pathTestPlaceholder} value={pathTestInput} onChange={(e) => setPathTestInput(e.target.value)} />
          {pathTestResult === 'ok' && <p className="field-hint">{msg.pathTestOk}</p>}
          {pathTestResult === 'no-include' && <p className="field-hint">{msg.pathTestNoInclude}</p>}
          {pathTestResult === 'excluded' && <p className="field-hint">{msg.pathTestExcluded}</p>}
        </div>

        <div className="form-field">
          <label htmlFor="pa-rule-text">
            {msg.textLabel} <span className="required-mark" aria-hidden="true">*</span>
          </label>
          <textarea id="pa-rule-text" rows={3} maxLength={PROACTIVE_LIMITS.textMax} value={text} onChange={(e) => setText(e.target.value)} aria-invalid={Boolean(fieldErrors.text)} />
          <p className="field-hint">{msg.remaining(PROACTIVE_LIMITS.textMax - text.length)}</p>
          <InlineFieldError id="pa-rule-text-error" message={fieldErrors.text} />
        </div>

        <fieldset className="form-field">
          <legend>{msg.buttonsLabel}</legend>
          {buttons.map((b, i) => (
            <div key={i} className="proactive-button-row">
              <ButtonItemEditor
                value={b}
                onChange={(v) => updateButton(i, v)}
                chatbotId={chatbotId}
                idPrefix={`pa-rule-button-${i}`}
                labelMaxLength={PROACTIVE_LIMITS.buttonLabelMax}
                labelError={buttonErrors[i]?.label}
                valueError={buttonErrors[i]?.value}
              />
              <button type="button" className="btn btn-secondary" onClick={() => removeButton(i)}>
                {MESSAGES.common.delete}
              </button>
            </div>
          ))}
          {buttons.length < PROACTIVE_LIMITS.buttonsMax && (
            <button type="button" className="btn btn-secondary" onClick={addButton}>
              {msg.addButtonButton}
            </button>
          )}
          <p className="field-hint">{msg.buttonsHint}</p>
        </fieldset>

        <fieldset className="form-field">
          <legend>{msg.devicesLabel}</legend>
          <label className="form-field--inline">
            <input type="checkbox" checked={devices.includes('DESKTOP')} onChange={() => toggleDevice('DESKTOP')} />
            {msg.deviceDesktop}
          </label>
          <label className="form-field--inline">
            <input type="checkbox" checked={devices.includes('MOBILE')} onChange={() => toggleDevice('MOBILE')} />
            {msg.deviceMobile}
          </label>
          <InlineFieldError id="pa-rule-devices-error" message={fieldErrors.devices} />
        </fieldset>

        <fieldset className="form-field">
          <legend>{msg.periodLabel}</legend>
          <label htmlFor="pa-rule-starts-at">{msg.periodStartLabel}</label>
          <input id="pa-rule-starts-at" type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
          <label htmlFor="pa-rule-ends-at">{msg.periodEndLabel}</label>
          <input id="pa-rule-ends-at" type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
          <InlineFieldError id="pa-rule-period-error" message={fieldErrors.period} />
        </fieldset>

        <fieldset className="form-field">
          <label className="form-field--inline">
            <input type="checkbox" checked={scheduleEnabled} onChange={(e) => setScheduleEnabled(e.target.checked)} />
            {msg.scheduleToggleLabel}
          </label>
          {scheduleEnabled && (
            <>
              <legend>{msg.scheduleDaysLabel}</legend>
              {DAY_LABELS.map((d) => (
                <label key={d.value} className="form-field--inline">
                  <input type="checkbox" checked={scheduleDays.includes(d.value)} onChange={() => toggleScheduleDay(d.value)} />
                  {d.label}
                </label>
              ))}
              <InlineFieldError id="pa-rule-schedule-days-error" message={fieldErrors.scheduleDays} />
              <label htmlFor="pa-rule-schedule-from">{msg.scheduleFromLabel}</label>
              <input id="pa-rule-schedule-from" type="time" value={scheduleFrom} onChange={(e) => setScheduleFrom(e.target.value)} />
              <label htmlFor="pa-rule-schedule-to">{msg.scheduleToLabel}</label>
              <input id="pa-rule-schedule-to" type="time" value={scheduleTo} onChange={(e) => setScheduleTo(e.target.value)} />
              <InlineFieldError id="pa-rule-schedule-error" message={fieldErrors.schedule} />
            </>
          )}
        </fieldset>

        <div className="form-field form-field--inline">
          <input
            id="pa-rule-purpose-confirmed"
            type="checkbox"
            checked={purposeConfirmed}
            onChange={(e) => setPurposeConfirmed(e.target.checked)}
            aria-invalid={Boolean(fieldErrors.purposeConfirmed)}
          />
          <label htmlFor="pa-rule-purpose-confirmed">
            {msg.purposeConfirmLabel} <span className="required-mark" aria-hidden="true">*</span>
          </label>
        </div>
        <p className="field-hint">{msg.purposeConfirmHint}</p>
        <InlineFieldError id="pa-rule-purpose-confirmed-error" message={fieldErrors.purposeConfirmed} />

        <div className="form-field">
          <button type="button" className="btn btn-secondary" aria-expanded={showPreview} onClick={() => setShowPreview((v) => !v)}>
            {msg.previewButton}
          </button>
          {showPreview && <ProactiveBubblePreview text={text} buttons={buttons} primaryColor={primaryColor} />}
        </div>

        <div className="modal-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            {msg.cancelButton}
          </button>
          <button type="submit" className="btn btn-primary" disabled={submitting}>
            {submitting ? MESSAGES.common.saving : msg.saveButton}
          </button>
        </div>
      </form>
    </Modal>
  );
}
