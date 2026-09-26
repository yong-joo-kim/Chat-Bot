import { Link } from 'react-router-dom';
import { INBOX_LIMITS } from '@chat-bot/shared-types';
import { MESSAGES } from '../../constants/messages';
import { InlineFieldError } from '../InlineFieldError';

export interface TagOption {
  id: string;
  name: string;
  color: string;
}

/** OI-2 태그 선택(`omnichannel-inbox-ui-spec.md` §2.3 `TagPickerField`) — 체크박스 목록(≤10 선택). */
export function TagPickerField({
  selected,
  allTags,
  readOnly,
  canManageTags,
  onChange,
  error,
}: {
  selected: TagOption[];
  allTags: TagOption[];
  readOnly: boolean;
  canManageTags: boolean;
  onChange: (tagIds: string[]) => void;
  error?: string;
}): JSX.Element {
  const msg = MESSAGES.inbox;
  const selectedIds = selected.map((t) => t.id);

  function toggle(tagId: string): void {
    if (selectedIds.includes(tagId)) {
      onChange(selectedIds.filter((id) => id !== tagId));
      return;
    }
    if (selectedIds.length >= INBOX_LIMITS.tagsPerThreadMax) return;
    onChange([...selectedIds, tagId]);
  }

  return (
    <fieldset className="form-field tag-picker-field" disabled={readOnly}>
      <legend>{msg.tagPickerLabel}</legend>
      {allTags.map((t) => (
        <label key={t.id}>
          <input type="checkbox" checked={selectedIds.includes(t.id)} onChange={() => toggle(t.id)} /> {t.name}
        </label>
      ))}
      <InlineFieldError id="tag-picker-error" message={error} />
      {canManageTags && (
        <Link to="/inbox/tags" className="field-hint">
          {msg.tagManageLink}
        </Link>
      )}
    </fieldset>
  );
}
