import { useState } from 'react';
import type { CreateRecordDto, RecordChannel, RecordDirection, RecordOutcome } from '@chat-bot/shared-types';
import { INBOX_LIMITS } from '@chat-bot/shared-types';
import { MESSAGES } from '../../constants/messages';
import { InlineFieldError } from '../InlineFieldError';
import { kstTodayDateInputValue, addDaysToDateInputValue } from '../../lib/date';

const RECORD_CHANNELS: RecordChannel[] = ['PHONE', 'EMAIL', 'VISIT', 'OTHER'];
const DIRECTIONS: RecordDirection[] = ['INBOUND', 'OUTBOUND'];
const RECORD_CHANNEL_LABEL_KEY: Record<RecordChannel, 'recordChannelPhone' | 'recordChannelEmail' | 'recordChannelVisit' | 'recordChannelOther'> = {
  PHONE: 'recordChannelPhone',
  EMAIL: 'recordChannelEmail',
  VISIT: 'recordChannelVisit',
  OTHER: 'recordChannelOther',
};

/** OI-3 수동 기록 작성(`omnichannel-inbox-ui-spec.md` §3.3 `ManualRecordForm`). */
export function ManualRecordForm({
  saving,
  onSave,
  onCancel,
  onPreview,
}: {
  saving: boolean;
  onSave: (dto: CreateRecordDto) => void;
  onCancel: () => void;
  onPreview: (text: string) => Promise<string>;
}): JSX.Element {
  const msg = MESSAGES.inbox;
  const [recordChannel, setRecordChannel] = useState<RecordChannel | ''>('');
  const [direction, setDirection] = useState<RecordDirection | ''>('');
  const [date, setDate] = useState(kstTodayDateInputValue());
  const [time, setTime] = useState('');
  const [text, setText] = useState('');
  const [outcome, setOutcome] = useState<RecordOutcome | ''>('');
  const [preview, setPreview] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const minDate = addDaysToDateInputValue(kstTodayDateInputValue(), -INBOX_LIMITS.recordPastDays);
  const maxDate = kstTodayDateInputValue();

  function handleSubmit(e: React.FormEvent): void {
    e.preventDefault();
    const nextErrors: Record<string, string> = {};
    if (!recordChannel || !direction) nextErrors.form = msg.recordRequiredFieldsError;
    if (date < minDate || date > maxDate) nextErrors.occurredAt = msg.recordOccurredAtRangeError;
    if (text.trim().length === 0) nextErrors.text = msg.recordRequiredFieldsError;
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }
    setErrors({});
    const occurredAt = new Date(`${date}T${time || '00:00'}:00`);
    onSave({
      recordChannel: recordChannel as RecordChannel,
      direction: direction as RecordDirection,
      occurredAt,
      text,
      outcome: outcome || undefined,
    });
  }

  async function handlePreview(): Promise<void> {
    const masked = await onPreview(text);
    setPreview(masked);
  }

  return (
    <form className="manual-record-form" onSubmit={handleSubmit} noValidate>
      <fieldset className="form-field">
        <legend>
          {msg.recordChannelLabel} <span aria-hidden="true">*</span>
        </legend>
        {RECORD_CHANNELS.map((c) => (
          <label key={c}>
            <input type="radio" name="recordChannel" checked={recordChannel === c} onChange={() => setRecordChannel(c)} />{' '}
            {msg[RECORD_CHANNEL_LABEL_KEY[c]]}
          </label>
        ))}
      </fieldset>

      <fieldset className="form-field">
        <legend>
          {msg.recordDirectionLabel} <span aria-hidden="true">*</span>
        </legend>
        {DIRECTIONS.map((d) => (
          <label key={d}>
            <input type="radio" name="recordDirection" checked={direction === d} onChange={() => setDirection(d)} />{' '}
            {d === 'INBOUND' ? msg.recordDirectionInbound : msg.recordDirectionOutbound}
          </label>
        ))}
      </fieldset>

      <div className="form-field form-field--inline">
        <label htmlFor="record-date">
          {msg.recordOccurredAtLabel} <span aria-hidden="true">*</span>
        </label>
        <input id="record-date" type="date" min={minDate} max={maxDate} value={date} onChange={(e) => setDate(e.target.value)} aria-describedby="record-date-hint" />
        <label htmlFor="record-time" className="sr-only">
          {msg.recordOccurredAtLabel}
        </label>
        <input id="record-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        <span id="record-date-hint" className="field-hint">
          {msg.recordOccurredAtHint}
        </span>
        <InlineFieldError id="record-date-error" message={errors.occurredAt} />
      </div>

      <div className="form-field">
        <label htmlFor="record-summary">
          {msg.recordSummaryLabel} <span aria-hidden="true">*</span>
        </label>
        <textarea
          id="record-summary"
          rows={4}
          maxLength={INBOX_LIMITS.recordTextMax}
          value={text}
          onChange={(e) => setText(e.target.value)}
          aria-describedby="record-summary-count"
        />
        <p id="record-summary-count" className="char-counter">
          {text.length}/{INBOX_LIMITS.recordTextMax}자
        </p>
        <InlineFieldError id="record-summary-error" message={errors.text} />
      </div>

      <fieldset className="form-field">
        <legend>{msg.recordOutcomeLabel}</legend>
        <label>
          <input type="radio" name="recordOutcome" checked={outcome === 'RESOLVED'} onChange={() => setOutcome('RESOLVED')} /> {msg.recordOutcomeResolved}
        </label>
        <label>
          <input type="radio" name="recordOutcome" checked={outcome === 'FOLLOW_UP'} onChange={() => setOutcome('FOLLOW_UP')} /> {msg.recordOutcomeFollowUp}
        </label>
        <label>
          <input type="radio" name="recordOutcome" checked={outcome === ''} onChange={() => setOutcome('')} /> {msg.recordOutcomeNone}
        </label>
      </fieldset>

      <button type="button" className="btn btn-secondary" onClick={() => void handlePreview()}>
        {msg.maskPreviewLabel}
      </button>
      {preview !== null && <p className="field-hint">{preview === text ? msg.maskPreviewNoChangeHint : `"${preview}" ${msg.maskPreviewChangedHint}`}</p>}

      <InlineFieldError id="record-form-error" message={errors.form} />

      <div className="form-actions">
        <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={saving}>
          {msg.recordCancel}
        </button>
        <button type="submit" className="btn btn-primary" disabled={saving || !recordChannel || !direction}>
          {saving ? MESSAGES.common.saving : msg.recordSave}
        </button>
      </div>
    </form>
  );
}
