import { useEffect, useState } from 'react';
import type { ResourcePickerType } from '../../../../components/ResourcePickerField';
import type { TestCase, TestCaseExpectedKind } from '@chat-bot/shared-types';
import { VALIDATION_LIMITS } from '@chat-bot/shared-types';
import { Modal } from '../../../../components/Modal';
import { InlineFieldError } from '../../../../components/InlineFieldError';
import { ResourcePickerField } from '../../../../components/ResourcePickerField';
import { MESSAGES } from '../../../../constants/messages';

const EXPECTED_KINDS: TestCaseExpectedKind[] = ['INTENT', 'FAQ', 'NODE', 'FALLBACK', 'ANY'];
const TARGET_RESOURCE_TYPE: Partial<Record<TestCaseExpectedKind, ResourcePickerType>> = {
  INTENT: 'intent',
  FAQ: 'faq',
  NODE: 'node',
};

export interface TestCaseFormValues {
  messages: string[];
  expectedKind: TestCaseExpectedKind;
  expectedTargetId: string | null;
  expectedAnswerNote: string;
  enabled: boolean;
}

export interface TestCaseFormModalProps {
  chatbotId: string;
  isOpen: boolean;
  initial?: TestCase | null;
  submitting: boolean;
  errorMessage?: string;
  onSubmit: (values: TestCaseFormValues) => void;
  onClose: () => void;
}

/** V2 — TC 단건 생성/수정 모달(ui-spec §4.2, 최대 5턴). */
export function TestCaseFormModal({ chatbotId, isOpen, initial, submitting, errorMessage, onSubmit, onClose }: TestCaseFormModalProps): JSX.Element {
  const msg = MESSAGES.validation.case;
  const [messages, setMessages] = useState<string[]>(['']);
  const [expectedKind, setExpectedKind] = useState<TestCaseExpectedKind>('INTENT');
  const [expectedTargetId, setExpectedTargetId] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [targetTouched, setTargetTouched] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setMessages(initial?.messages ?? ['']);
    setExpectedKind(initial?.expectedKind ?? 'INTENT');
    setExpectedTargetId(initial?.expectedTargetId ?? null);
    setNote(initial?.expectedAnswerNote ?? '');
    setEnabled(initial?.enabled ?? true);
    setTargetTouched(false);
  }, [isOpen, initial]);

  const needsTarget = expectedKind === 'INTENT' || expectedKind === 'FAQ' || expectedKind === 'NODE';
  const resourceType = TARGET_RESOURCE_TYPE[expectedKind];
  const trimmedMessages = messages.map((m) => m.trim()).filter((m) => m.length > 0);
  const targetError = targetTouched && needsTarget && !expectedTargetId ? msg.expectedTargetRequiredError : undefined;
  const canSubmit = trimmedMessages.length > 0 && (!needsTarget || Boolean(expectedTargetId)) && !submitting;

  function updateMessage(index: number, value: string): void {
    setMessages((prev) => prev.map((m, i) => (i === index ? value : m)));
  }

  function addTurn(): void {
    if (messages.length >= VALIDATION_LIMITS.maxTurnsPerCase) return;
    setMessages((prev) => [...prev, '']);
  }

  function removeTurn(index: number): void {
    setMessages((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== index) : prev));
  }

  function handleKindChange(kind: TestCaseExpectedKind): void {
    setExpectedKind(kind);
    setExpectedTargetId(null);
    setTargetTouched(false);
  }

  function handleSubmit(e: React.FormEvent): void {
    e.preventDefault();
    setTargetTouched(true);
    if (!canSubmit) return;
    onSubmit({
      messages: trimmedMessages,
      expectedKind,
      expectedTargetId: needsTarget ? expectedTargetId : null,
      expectedAnswerNote: note.trim(),
      enabled,
    });
  }

  return (
    <Modal isOpen={isOpen} title={initial ? msg.formEditTitle : msg.formCreateTitle} onClose={onClose} closeOnEsc={!submitting}>
      <form onSubmit={handleSubmit}>
        <fieldset className="form-field" style={{ border: 'none', padding: 0 }}>
          <legend className="field-label-static">{MESSAGES.validation.case.columnQuestion}</legend>
          {messages.map((m, i) => (
            <div key={i} className="form-field">
              <label htmlFor={`tc-turn-${i}`}>{msg.turnLabel(i + 1)}</label>
              <textarea
                id={`tc-turn-${i}`}
                rows={2}
                maxLength={VALIDATION_LIMITS.maxMessageLength}
                value={m}
                onChange={(e) => updateMessage(i, e.target.value)}
              />
              <p className="field-hint">{msg.messageRemaining(VALIDATION_LIMITS.maxMessageLength - m.length, VALIDATION_LIMITS.maxMessageLength)}</p>
              {messages.length > 1 && (
                <button type="button" className="btn btn-secondary" onClick={() => removeTurn(i)}>
                  {msg.removeTurnButton}
                </button>
              )}
            </div>
          ))}
          {messages.length < VALIDATION_LIMITS.maxTurnsPerCase && (
            <button type="button" className="btn btn-secondary" onClick={addTurn}>
              {msg.addTurnButton}
            </button>
          )}
          <p className="field-hint">{msg.maxTurnsHint}</p>
        </fieldset>

        <fieldset className="form-field" style={{ border: 'none', padding: 0 }}>
          <legend className="field-label-static">{msg.expectedKindFieldLabel}</legend>
          {EXPECTED_KINDS.map((kind) => (
            <label key={kind} className="form-field--inline">
              <input type="radio" name="expectedKind" checked={expectedKind === kind} onChange={() => handleKindChange(kind)} />
              {msg.expectedKindLabel[kind]}
            </label>
          ))}
        </fieldset>

        {needsTarget && resourceType && (
          <ResourcePickerField
            id="tc-expected-target"
            label={msg.expectedTargetFieldLabel}
            resourceType={resourceType}
            chatbotId={chatbotId}
            multiple={false}
            value={expectedTargetId}
            onChange={(v) => setExpectedTargetId(v as string | null)}
            required
            errorMessage={targetError}
          />
        )}

        <div className="form-field">
          <label htmlFor="tc-note">{msg.noteLabel}</label>
          <textarea id="tc-note" rows={2} maxLength={VALIDATION_LIMITS.maxAnswerNoteLength} value={note} onChange={(e) => setNote(e.target.value)} />
          <p className="field-hint">{msg.noteHint}</p>
        </div>

        <label className="form-field--inline">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          {msg.enabledLabel}
        </label>

        <InlineFieldError id="tc-form-error" message={errorMessage} />

        <div className="modal-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={submitting}>
            {MESSAGES.common.cancel}
          </button>
          <button type="submit" className="btn btn-primary" disabled={!canSubmit}>
            {submitting ? MESSAGES.common.saving : MESSAGES.common.save}
          </button>
        </div>
      </form>
    </Modal>
  );
}
