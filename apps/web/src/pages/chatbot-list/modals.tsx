import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ChatbotGroupWithCount, ChatbotListItem } from '@chat-bot/shared-types';
import { Modal, ConfirmDialog } from '../../components/Modal';
import { InlineFieldError } from '../../components/InlineFieldError';
import { SlugAvailabilityField, type SlugCheckStatus } from '../../components/SlugAvailabilityField';
import { groupsApi } from '../../api/groups';
import { chatbotsApi } from '../../api/chatbots';
import { ApiError } from '../../api/client';
import { MESSAGES } from '../../constants/messages';
import { fieldErrorsFromApiError } from '../../lib/apiErrorHelpers';

/* ---------------------------------------------------------------------- */
/* 그룹 모달                                                                */
/* ---------------------------------------------------------------------- */

export function CreateGroupModal({
  existingNames,
  onClose,
  onSuccess,
}: {
  existingNames: string[];
  onClose: () => void;
  onSuccess: (message: string) => void;
}): JSX.Element {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const duplicateHint = name.trim().length > 0 && existingNames.includes(name.trim());

  async function handleSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (name.trim().length === 0) {
      setFieldErrors({ name: MESSAGES.group.nameRequiredError });
      return;
    }
    setSubmitting(true);
    try {
      await groupsApi.create({ name: name.trim(), description: description || undefined });
      onSuccess(MESSAGES.group.createSuccess);
    } catch (e2) {
      setFieldErrors(fieldErrorsFromApiError(e2));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal isOpen title={MESSAGES.group.createTitle} onClose={onClose}>
      <form onSubmit={handleSubmit} noValidate>
        <div className="form-field">
          <label htmlFor="group-name">
            {MESSAGES.group.nameLabel}{' '}
            <span className="required-mark" aria-hidden="true">
              *
            </span>
          </label>
          <input id="group-name" type="text" value={name} maxLength={100} required onChange={(e) => setName(e.target.value)} />
          {duplicateHint && !fieldErrors.name && <p className="field-hint">{MESSAGES.group.duplicateNameHint}</p>}
          <InlineFieldError id="group-name-error" message={fieldErrors.name} />
        </div>
        <div className="form-field">
          <label htmlFor="group-description">{MESSAGES.group.descriptionLabel}</label>
          <textarea id="group-description" value={description} maxLength={500} rows={3} onChange={(e) => setDescription(e.target.value)} />
          <InlineFieldError id="group-description-error" message={fieldErrors.description} />
        </div>
        <div className="modal-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            {MESSAGES.common.cancel}
          </button>
          <button type="submit" className="btn btn-primary" disabled={submitting}>
            {MESSAGES.common.save}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function EditGroupModal({
  group,
  onClose,
  onSuccess,
}: {
  group: ChatbotGroupWithCount;
  onClose: () => void;
  onSuccess: (message: string) => void;
}): JSX.Element {
  const [name, setName] = useState(group.name);
  const [description, setDescription] = useState(group.description ?? '');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (name.trim().length === 0) {
      setFieldErrors({ name: MESSAGES.group.nameRequiredError });
      return;
    }
    setSubmitting(true);
    try {
      await groupsApi.update(group.id, { name: name.trim(), description: description || null });
      onSuccess(MESSAGES.group.editSuccess);
    } catch (e2) {
      setFieldErrors(fieldErrorsFromApiError(e2));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal isOpen title={MESSAGES.group.editTitle} onClose={onClose}>
      <form onSubmit={handleSubmit} noValidate>
        <div className="form-field">
          <label htmlFor="edit-group-name">
            {MESSAGES.group.nameLabel}{' '}
            <span className="required-mark" aria-hidden="true">
              *
            </span>
          </label>
          <input id="edit-group-name" type="text" value={name} maxLength={100} required onChange={(e) => setName(e.target.value)} />
          <InlineFieldError id="edit-group-name-error" message={fieldErrors.name} />
        </div>
        <div className="form-field">
          <label htmlFor="edit-group-description">{MESSAGES.group.descriptionLabel}</label>
          <textarea
            id="edit-group-description"
            value={description}
            maxLength={500}
            rows={3}
            onChange={(e) => setDescription(e.target.value)}
          />
          <InlineFieldError id="edit-group-description-error" message={fieldErrors.description} />
        </div>
        <div className="modal-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            {MESSAGES.common.cancel}
          </button>
          <button type="submit" className="btn btn-primary" disabled={submitting}>
            {MESSAGES.common.save}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function CopyGroupModal({
  group,
  onClose,
  onSuccess,
}: {
  group: ChatbotGroupWithCount;
  onClose: () => void;
  onSuccess: (message: string) => void;
}): JSX.Element {
  const [name, setName] = useState(`${group.name} (사본)`);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setSubmitting(true);
    try {
      await groupsApi.copy(group.id, { name: name.trim() || undefined });
      onSuccess(MESSAGES.group.copySuccess);
    } catch (e2) {
      setFieldErrors(fieldErrorsFromApiError(e2));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal isOpen title={MESSAGES.group.copyTitle} onClose={onClose}>
      <p className="modal-description">{MESSAGES.group.copyDesc(group.chatbotCount)}</p>
      <form onSubmit={handleSubmit} noValidate>
        <div className="form-field">
          <label htmlFor="copy-group-name">{MESSAGES.group.copyNameLabel}</label>
          <input id="copy-group-name" type="text" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} />
          <InlineFieldError id="copy-group-name-error" message={fieldErrors.name} />
        </div>
        <div className="modal-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            {MESSAGES.common.cancel}
          </button>
          <button type="submit" className="btn btn-primary" disabled={submitting}>
            {MESSAGES.group.copyTitle}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function DeleteGroupConfirmDialog({
  group,
  onClose,
  onSuccess,
  onViewChatbots,
}: {
  group: ChatbotGroupWithCount;
  onClose: () => void;
  onSuccess: (message: string) => void;
  onViewChatbots: (groupId: string) => void;
}): JSX.Element {
  const [banner, setBanner] = useState<string | undefined>();
  const [submitting, setSubmitting] = useState(false);

  async function handleConfirm(): Promise<void> {
    setSubmitting(true);
    setBanner(undefined);
    try {
      await groupsApi.remove(group.id);
      onSuccess(MESSAGES.group.deleteSuccess);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'GROUP_NOT_EMPTY') {
        setBanner(e.message);
      } else {
        setBanner(e instanceof ApiError ? e.message : MESSAGES.errors.generic);
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ConfirmDialog
      isOpen
      title={MESSAGES.group.deleteTitle}
      description={MESSAGES.group.deleteConfirmDesc(group.name)}
      confirmLabel={MESSAGES.common.delete}
      onConfirm={handleConfirm}
      onCancel={onClose}
      danger
      confirmDisabled={submitting}
    >
      {banner && (
        <div className="modal-banner modal-banner--error" role="alert">
          <p>{banner}</p>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              onClose();
              onViewChatbots(group.id);
            }}
          >
            {MESSAGES.group.viewChatbotsInGroup}
          </button>
        </div>
      )}
    </ConfirmDialog>
  );
}

/* ---------------------------------------------------------------------- */
/* 챗봇 모달                                                                */
/* ---------------------------------------------------------------------- */

export function CreateChatbotModal({
  groups,
  defaultGroupId,
  onClose,
}: {
  groups: ChatbotGroupWithCount[];
  defaultGroupId?: string;
  onClose: () => void;
}): JSX.Element {
  const navigate = useNavigate();
  const [groupId, setGroupId] = useState(defaultGroupId ?? groups[0]?.id ?? '');
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [description, setDescription] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [slugStatus, setSlugStatus] = useState<SlugCheckStatus>('idle');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    const errors: Record<string, string> = {};
    if (!groupId) errors.groupId = MESSAGES.chatbot.groupRequiredError;
    if (name.trim().length === 0) errors.name = MESSAGES.settings.nameRequiredError;
    if (slug.length < 3 || slug.length > 50 || !/^[a-z0-9-]+$/.test(slug)) {
      errors.slug = MESSAGES.settings.slugFormatError;
    } else if (slugStatus === 'unavailable') {
      errors.slug = MESSAGES.settings.slugUnavailableError;
    }
    if (avatarUrl && !/^https?:\/\//i.test(avatarUrl)) {
      errors.avatarUrl = MESSAGES.settings.avatarUrlFormatError;
    }
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }
    setSubmitting(true);
    try {
      const created = await chatbotsApi.create({
        groupId,
        name: name.trim(),
        slug,
        avatarUrl: avatarUrl || undefined,
        description: description || undefined,
      });
      onClose();
      navigate(`/chatbots/${created.id}/settings`);
    } catch (e2) {
      const details = fieldErrorsFromApiError(e2);
      if (Object.keys(details).length > 0) {
        setFieldErrors(details);
      } else if (e2 instanceof ApiError && (e2.code === 'DUPLICATE_SLUG' || e2.code === 'RESERVED_SLUG')) {
        setFieldErrors({ slug: e2.message });
      } else if (e2 instanceof ApiError && e2.code === 'NOT_FOUND') {
        setFieldErrors({ groupId: MESSAGES.chatbot.groupNotFoundError });
      } else {
        setFieldErrors({ _root: e2 instanceof ApiError ? e2.message : MESSAGES.errors.generic });
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal isOpen title={MESSAGES.chatbot.createTitle} onClose={onClose}>
      <form onSubmit={handleSubmit} noValidate>
        {fieldErrors._root && (
          <div className="modal-banner modal-banner--error" role="alert">
            {fieldErrors._root}
          </div>
        )}
        <div className="form-field">
          <label htmlFor="create-chatbot-group">
            {MESSAGES.chatbot.groupLabel}{' '}
            <span className="required-mark" aria-hidden="true">
              *
            </span>
          </label>
          <select id="create-chatbot-group" value={groupId} required onChange={(e) => setGroupId(e.target.value)}>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
          <InlineFieldError id="create-chatbot-group-error" message={fieldErrors.groupId} />
        </div>
        <div className="form-field">
          <label htmlFor="create-chatbot-name">
            {MESSAGES.chatbot.nameLabel}{' '}
            <span className="required-mark" aria-hidden="true">
              *
            </span>
          </label>
          <input id="create-chatbot-name" type="text" value={name} maxLength={100} required onChange={(e) => setName(e.target.value)} />
          <InlineFieldError id="create-chatbot-name-error" message={fieldErrors.name} />
        </div>
        <SlugAvailabilityField
          id="create-chatbot-slug"
          label={MESSAGES.chatbot.slugLabel}
          value={slug}
          onChange={setSlug}
          externalError={fieldErrors.slug}
          onStatusChange={setSlugStatus}
        />
        <div className="form-field">
          <label htmlFor="create-chatbot-avatar">{MESSAGES.chatbot.avatarLabel}</label>
          <input id="create-chatbot-avatar" type="text" value={avatarUrl} onChange={(e) => setAvatarUrl(e.target.value)} />
          <InlineFieldError id="create-chatbot-avatar-error" message={fieldErrors.avatarUrl} />
        </div>
        <div className="form-field">
          <label htmlFor="create-chatbot-description">{MESSAGES.chatbot.descriptionLabel}</label>
          <textarea
            id="create-chatbot-description"
            value={description}
            maxLength={500}
            rows={3}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <div className="modal-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            {MESSAGES.common.cancel}
          </button>
          <button type="submit" className="btn btn-primary" disabled={submitting}>
            {MESSAGES.common.save}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function CopyChatbotModal({
  chatbot,
  groups,
  onClose,
  onSuccess,
}: {
  chatbot: ChatbotListItem;
  groups: ChatbotGroupWithCount[];
  onClose: () => void;
  onSuccess: (message: string) => void;
}): JSX.Element {
  const [targetGroupId, setTargetGroupId] = useState(chatbot.groupId);
  const [submitting, setSubmitting] = useState(false);
  const [banner, setBanner] = useState<string | undefined>();

  async function handleSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setSubmitting(true);
    setBanner(undefined);
    try {
      await chatbotsApi.copy(chatbot.id, { targetGroupId });
      onSuccess(MESSAGES.chatbot.copySuccess);
    } catch (e2) {
      setBanner(e2 instanceof ApiError ? e2.message : MESSAGES.errors.generic);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal isOpen title={MESSAGES.chatbot.copyTitle} onClose={onClose}>
      <p className="modal-description">{MESSAGES.chatbot.copyDesc}</p>
      {banner && (
        <div className="modal-banner modal-banner--error" role="alert">
          {banner}
        </div>
      )}
      <form onSubmit={handleSubmit} noValidate>
        <div className="form-field">
          <label htmlFor="copy-chatbot-group">{MESSAGES.chatbot.groupLabel}</label>
          <select id="copy-chatbot-group" value={targetGroupId} onChange={(e) => setTargetGroupId(e.target.value)}>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </div>
        <div className="modal-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            {MESSAGES.common.cancel}
          </button>
          <button type="submit" className="btn btn-primary" disabled={submitting}>
            {MESSAGES.chatbot.actionCopy}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function MoveGroupModal({
  chatbot,
  groups,
  onClose,
  onSuccess,
}: {
  chatbot: ChatbotListItem;
  groups: ChatbotGroupWithCount[];
  onClose: () => void;
  onSuccess: (message: string) => void;
}): JSX.Element {
  const otherGroups = groups.filter((g) => g.id !== chatbot.groupId);
  const [targetGroupId, setTargetGroupId] = useState(otherGroups[0]?.id ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  async function handleSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (!targetGroupId) return;
    setSubmitting(true);
    try {
      await chatbotsApi.moveGroup(chatbot.id, { groupId: targetGroupId });
      onSuccess(MESSAGES.chatbot.moveSuccess);
    } catch (e2) {
      setFieldErrors({ groupId: e2 instanceof ApiError ? e2.message : MESSAGES.errors.generic });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal isOpen title={MESSAGES.chatbot.moveTitle} onClose={onClose}>
      {otherGroups.length === 0 ? (
        <p className="modal-description">{MESSAGES.chatbot.moveNoGroups}</p>
      ) : (
        <form onSubmit={handleSubmit} noValidate>
          <div className="form-field">
            <label htmlFor="move-group-select">
              {MESSAGES.chatbot.moveGroupLabel}{' '}
              <span className="required-mark" aria-hidden="true">
                *
              </span>
            </label>
            <select id="move-group-select" value={targetGroupId} required onChange={(e) => setTargetGroupId(e.target.value)}>
              {otherGroups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
            <InlineFieldError id="move-group-error" message={fieldErrors.groupId} />
          </div>
          <div className="modal-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              {MESSAGES.common.cancel}
            </button>
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              {MESSAGES.chatbot.actionMove}
            </button>
          </div>
        </form>
      )}
      {otherGroups.length === 0 && (
        <div className="modal-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            {MESSAGES.common.close}
          </button>
        </div>
      )}
    </Modal>
  );
}

export function ArchiveConfirmDialog({
  chatbot,
  onClose,
  onSuccess,
}: {
  chatbot: ChatbotListItem;
  onClose: () => void;
  onSuccess: (message: string) => void;
}): JSX.Element {
  const [submitting, setSubmitting] = useState(false);
  const [banner, setBanner] = useState<string | undefined>();

  async function handleConfirm(): Promise<void> {
    setSubmitting(true);
    setBanner(undefined);
    try {
      await chatbotsApi.archive(chatbot.id);
      onSuccess(MESSAGES.chatbot.archiveSuccess);
    } catch (e) {
      setBanner(e instanceof ApiError ? e.message : MESSAGES.errors.generic);
      setSubmitting(false);
    }
  }

  return (
    <ConfirmDialog
      isOpen
      title={MESSAGES.chatbot.archiveTitle}
      description={MESSAGES.chatbot.archiveDesc}
      confirmLabel={MESSAGES.chatbot.actionArchive}
      onConfirm={handleConfirm}
      onCancel={onClose}
      danger
      confirmDisabled={submitting}
    >
      {banner && (
        <div className="modal-banner modal-banner--error" role="alert">
          {banner}
        </div>
      )}
    </ConfirmDialog>
  );
}

export function PermanentDeleteModal({
  chatbot,
  onClose,
  onSuccess,
}: {
  chatbot: ChatbotListItem;
  onClose: () => void;
  onSuccess: (message: string) => void;
}): JSX.Element {
  const [confirmName, setConfirmName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [banner, setBanner] = useState<string | undefined>();
  const [fieldError, setFieldError] = useState<string | undefined>();

  const matches = confirmName === chatbot.name;

  async function handleConfirm(): Promise<void> {
    if (!matches) return;
    setSubmitting(true);
    setBanner(undefined);
    setFieldError(undefined);
    try {
      await chatbotsApi.permanentDelete(chatbot.id, { confirmName });
      onSuccess(MESSAGES.chatbot.permanentDeleteSuccess);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'CONFIRM_NAME_MISMATCH') {
        setFieldError(e.message);
      } else if (e instanceof ApiError && e.code === 'CHATBOT_HAS_CHILDREN') {
        setBanner(e.message);
      } else {
        setBanner(e instanceof ApiError ? e.message : MESSAGES.errors.generic);
      }
      setSubmitting(false);
    }
  }

  return (
    <ConfirmDialog
      isOpen
      title={MESSAGES.chatbot.permanentDeleteTitle}
      description={MESSAGES.chatbot.permanentDeleteDesc(chatbot.name)}
      confirmLabel={MESSAGES.chatbot.permanentDeleteSubmit}
      onConfirm={handleConfirm}
      onCancel={onClose}
      danger
      confirmDisabled={!matches || submitting}
    >
      {banner && (
        <div className="modal-banner modal-banner--error" role="alert">
          {banner}
        </div>
      )}
      <div className="form-field">
        <label htmlFor="permanent-delete-confirm-name">{MESSAGES.chatbot.permanentDeleteConfirmLabel}</label>
        <input
          id="permanent-delete-confirm-name"
          type="text"
          value={confirmName}
          onChange={(e) => setConfirmName(e.target.value)}
          aria-describedby="permanent-delete-hint"
        />
        <p id="permanent-delete-hint" className="field-hint">
          {MESSAGES.chatbot.permanentDeleteConfirmHint(chatbot.name)}
        </p>
        <InlineFieldError id="permanent-delete-error" message={fieldError} />
      </div>
    </ConfirmDialog>
  );
}
