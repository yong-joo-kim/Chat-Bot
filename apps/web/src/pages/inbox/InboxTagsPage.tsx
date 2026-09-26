import { useEffect, useState } from 'react';
import type { InboxTagColor, InboxTagItem } from '@chat-bot/shared-types';
import { INBOX_TAG_PALETTE } from '@chat-bot/shared-types';
import { inboxApi } from '../../api/inbox';
import { ApiError } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../components/Toast';
import { SkeletonRow } from '../../components/Skeleton';
import { ErrorState } from '../../components/ErrorState';
import { EmptyState } from '../../components/EmptyState';
import { Modal, ConfirmDialog } from '../../components/Modal';
import { InlineFieldError } from '../../components/InlineFieldError';
import { MESSAGES } from '../../constants/messages';

/** OI-8 — 전역 태그 관리(`omnichannel-inbox-ui-spec.md` §3.8 `/inbox/tags`). */
export function InboxTagsPage(): JSX.Element {
  const msg = MESSAGES.inboxTags;
  const { user } = useAuth();
  const { showToast } = useToast();
  const isAdmin = user?.role === 'ADMIN';

  const [tags, setTags] = useState<InboxTagItem[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [formOpen, setFormOpen] = useState<{ mode: 'create' } | { mode: 'edit'; tag: InboxTagItem } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<InboxTagItem | null>(null);
  const [deleting, setDeleting] = useState(false);

  function load(): void {
    setLoading(true);
    setError(false);
    inboxApi.tags
      .list()
      .then(setTags)
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
  }, []);

  async function handleDelete(force: boolean): Promise<void> {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await inboxApi.tags.remove(deleteTarget.id, force);
      setDeleteTarget(null);
      load();
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : MESSAGES.errors.generic);
    } finally {
      setDeleting(false);
    }
  }

  if (loading) {
    return (
      <>
        <SkeletonRow />
        <SkeletonRow />
        <SkeletonRow />
        <SkeletonRow />
      </>
    );
  }
  if (error || !tags) return <ErrorState title={msg.loadFailed} onRetry={load} />;

  return (
    <div className="inbox-tags-page">
      <h2>{msg.title}</h2>
      {!isAdmin && <p className="field-hint">{msg.readOnlyHint}</p>}
      {isAdmin && (
        <button type="button" className="btn btn-primary" onClick={() => setFormOpen({ mode: 'create' })}>
          {msg.addButton}
        </button>
      )}

      {tags.length === 0 ? (
        <EmptyState title={msg.empty} />
      ) : (
        <div className="dialogue-table-wrap">
          <table className="dialogue-table desktop-only">
            <thead>
              <tr>
                <th scope="col">{msg.nameLabel}</th>
                <th scope="col">{msg.colorLabel}</th>
                <th scope="col">{msg.usageColumnLabel}</th>
                {isAdmin && <th scope="col">{MESSAGES.common.actionsColumnLabel}</th>}
              </tr>
            </thead>
            <tbody>
              {tags.map((t) => (
                <tr key={t.id}>
                  <td>{t.name}</td>
                  <td>{msg.colorNames[t.color]}</td>
                  <td>{msg.usageCount(t.usageCount)}</td>
                  {isAdmin && (
                    <td>
                      <button type="button" className="btn btn-secondary" onClick={() => setFormOpen({ mode: 'edit', tag: t })}>
                        {msg.editButton}
                      </button>
                      <button type="button" className="btn btn-secondary" onClick={() => setDeleteTarget(t)}>
                        {msg.deleteButton}
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {formOpen && (
        <TagFormModal
          initial={formOpen.mode === 'edit' ? formOpen.tag : undefined}
          onSaved={() => {
            setFormOpen(null);
            load();
          }}
          onClose={() => setFormOpen(null)}
        />
      )}

      <ConfirmDialog
        isOpen={deleteTarget !== null}
        title={msg.deleteInUseConfirmTitle}
        description={deleteTarget ? msg.deleteInUseConfirmDesc(deleteTarget.name, deleteTarget.usageCount) : ''}
        confirmLabel={msg.deleteButton}
        danger
        confirmDisabled={deleting}
        onConfirm={() => void handleDelete(true)}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}

function TagFormModal({ initial, onSaved, onClose }: { initial?: InboxTagItem; onSaved: () => void; onClose: () => void }): JSX.Element {
  const msg = MESSAGES.inboxTags;
  const [name, setName] = useState(initial?.name ?? '');
  const [color, setColor] = useState<InboxTagColor>(initial?.color ?? INBOX_TAG_PALETTE[0]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>();

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setSaving(true);
    setError(undefined);
    try {
      if (initial) await inboxApi.tags.update(initial.id, { name, color });
      else await inboxApi.tags.create({ name, color });
      onSaved();
    } catch (e2) {
      if (e2 instanceof ApiError && e2.code === 'DUPLICATE_NAME') setError(msg.duplicateNameError);
      else if (e2 instanceof ApiError && e2.code === 'LIMIT_EXCEEDED') setError(msg.limitExceededError);
      else setError(e2 instanceof ApiError ? e2.message : MESSAGES.errors.generic);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal isOpen title={initial ? msg.editTitle : msg.createTitle} onClose={onClose}>
      <form onSubmit={(e) => void handleSubmit(e)}>
        <div className="form-field">
          <label htmlFor="tag-name">{msg.nameLabel}</label>
          <input id="tag-name" type="text" maxLength={20} required value={name} onChange={(e) => setName(e.target.value)} aria-describedby="tag-name-error" />
        </div>
        <div className="form-field">
          <label htmlFor="tag-color">{msg.colorLabel}</label>
          <select id="tag-color" value={color} onChange={(e) => setColor(e.target.value as InboxTagColor)}>
            {INBOX_TAG_PALETTE.map((c) => (
              <option key={c} value={c}>
                {msg.colorNames[c]}
              </option>
            ))}
          </select>
        </div>
        <InlineFieldError id="tag-name-error" message={error} />
        <div className="modal-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={saving}>
            {msg.cancelButton}
          </button>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? MESSAGES.common.saving : msg.saveButton}
          </button>
        </div>
      </form>
    </Modal>
  );
}
