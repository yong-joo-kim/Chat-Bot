import { useState } from 'react';
import type { PlaceholderChannelConfig } from '@chat-bot/shared-types';
import { MESSAGES } from '../../../constants/messages';
import { SeverityBadge } from '../../../components/SeverityBadge';

/** `CONFIG_ONLY` 채널 설정 폼 — `note` 1개뿐(NFR-S7, ui-spec §4.4.4). */
export function PlaceholderChannelForm({
  initial,
  saving,
  onSave,
  onCancel,
}: {
  initial: PlaceholderChannelConfig;
  saving: boolean;
  onSave: (config: PlaceholderChannelConfig) => void;
  onCancel: () => void;
}): JSX.Element {
  const msg = MESSAGES.channels;
  const [note, setNote] = useState(initial.note ?? '');

  function handleSubmit(e: React.FormEvent): void {
    e.preventDefault();
    onSave({ note: note || undefined });
  }

  return (
    <form className="channel-config-form" onSubmit={handleSubmit}>
      <SeverityBadge severity="INFO" label={msg.configOnlyNotice} />
      <div className="form-field">
        <label htmlFor="placeholder-channel-note">{msg.noteLabel}</label>
        <textarea id="placeholder-channel-note" rows={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
        <p className="field-hint">{note.length}/500</p>
      </div>
      <div className="form-actions">
        <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={saving}>
          {msg.cancel}
        </button>
        <button type="submit" className="btn btn-primary" disabled={saving}>
          {saving ? MESSAGES.common.saving : msg.save}
        </button>
      </div>
    </form>
  );
}
