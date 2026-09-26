import { useState } from 'react';
import { INBOX_LIMITS } from '@chat-bot/shared-types';
import { MESSAGES } from '../../constants/messages';

/** OI-4 메모 작성(`omnichannel-inbox-ui-spec.md` §3.4 `NoteForm`). */
export function NoteForm({
  initialText = '',
  saving,
  onSave,
  onCancel,
  onPreview,
}: {
  initialText?: string;
  saving: boolean;
  onSave: (text: string) => void;
  onCancel: () => void;
  onPreview: (text: string) => Promise<string>;
}): JSX.Element {
  const msg = MESSAGES.inbox;
  const [text, setText] = useState(initialText);
  const [preview, setPreview] = useState<string | null>(null);

  async function handlePreview(): Promise<void> {
    const masked = await onPreview(text);
    setPreview(masked);
  }

  function handleSubmit(e: React.FormEvent): void {
    e.preventDefault();
    if (text.trim().length === 0) return;
    onSave(text);
  }

  return (
    <form className="note-form" onSubmit={handleSubmit} noValidate>
      <label htmlFor="note-text">{msg.noteLabel}</label>
      <textarea id="note-text" rows={4} maxLength={INBOX_LIMITS.noteTextMax} value={text} onChange={(e) => setText(e.target.value)} aria-describedby="note-count" />
      <p id="note-count" className="char-counter">
        {text.length}/{INBOX_LIMITS.noteTextMax}자
      </p>
      <button type="button" className="btn btn-secondary" onClick={() => void handlePreview()}>
        {msg.maskPreviewLabel}
      </button>
      {preview !== null && <p className="field-hint">{preview === text ? msg.maskPreviewNoChangeHint : `"${preview}" ${msg.maskPreviewChangedHint}`}</p>}
      <div className="form-actions">
        <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={saving}>
          {MESSAGES.common.cancel}
        </button>
        <button type="submit" className="btn btn-primary" disabled={saving || text.trim().length === 0}>
          {saving ? MESSAGES.common.saving : msg.noteSave}
        </button>
      </div>
    </form>
  );
}
