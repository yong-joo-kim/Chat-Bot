import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { CannedResponse } from '@chat-bot/shared-types';
import { HANDOFF_LIMITS } from '@chat-bot/shared-types';
import { cannedResponsesApi } from '../../api/cannedResponses';
import { ApiError } from '../../api/client';
import { useChatbotDetailContext } from '../ChatbotDetailLayout';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../components/Toast';
import { SkeletonRow } from '../../components/Skeleton';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { Modal, ConfirmDialog } from '../../components/Modal';
import { InlineFieldError } from '../../components/InlineFieldError';
import { fieldErrorsFromApiError } from '../../lib/apiErrorHelpers';
import { MESSAGES } from '../../constants/messages';

interface FormState {
  title: string;
  body: string;
  category: string;
  shortcut: string;
  enabled: boolean;
}

const EMPTY_FORM: FormState = { title: '', body: '', category: '', shortcut: '', enabled: true };

/** CR1 — 자주 쓰는 문장 관리(hybrid-cs-ui-spec.md §3.6, `DialogueShell` 서브내비 7번째). */
export function CannedResponsesPage(): JSX.Element {
  const { chatbot } = useChatbotDetailContext();
  const { can } = useAuth();
  const { showToast } = useToast();
  const msg = MESSAGES.cannedResponses;
  const canWrite = can('dialogue:write') && chatbot.status !== 'ARCHIVED';

  const [items, setItems] = useState<CannedResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [q, setQ] = useState('');
  const [editTarget, setEditTarget] = useState<CannedResponse | 'new' | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<CannedResponse | null>(null);
  // L3(코드 리뷰 1회차): 이동·삭제 연타 방지(UIUX §4) — 요청이 진행 중인 동안 버튼을 비활성화한다.
  const [deleting, setDeleting] = useState(false);
  const [movingId, setMovingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const res = await cannedResponsesApi.list(chatbot.id);
      setItems(res);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [chatbot.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = items.filter((i) => !q.trim() || i.title.includes(q.trim()) || i.body.includes(q.trim()));
  const atLimit = items.length >= HANDOFF_LIMITS.cannedPerChatbot;

  function openCreate(): void {
    setForm(EMPTY_FORM);
    setFieldErrors({});
    setEditTarget('new');
  }

  function openEdit(item: CannedResponse): void {
    setForm({ title: item.title, body: item.body, category: item.category ?? '', shortcut: item.shortcut ?? '', enabled: item.enabled });
    setFieldErrors({});
    setEditTarget(item);
  }

  async function handleSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setSubmitting(true);
    setFieldErrors({});
    try {
      const dto = {
        title: form.title.trim(),
        body: form.body.trim(),
        category: form.category.trim() || undefined,
        shortcut: form.shortcut.trim() || undefined,
        enabled: form.enabled,
      };
      if (editTarget === 'new') {
        await cannedResponsesApi.create(chatbot.id, dto);
      } else if (editTarget) {
        await cannedResponsesApi.update(chatbot.id, editTarget.id, dto);
      }
      setEditTarget(null);
      showToast(editTarget === 'new' ? msg.createTitle : msg.editTitle);
      void load();
    } catch (e2) {
      if (e2 instanceof ApiError && e2.code === 'DUPLICATE_NAME') {
        setFieldErrors({ title: msg.duplicateTitle });
      } else if (e2 instanceof ApiError && e2.code === 'LIMIT_EXCEEDED') {
        setFieldErrors({ form: msg.limitExceeded });
      } else {
        setFieldErrors(fieldErrorsFromApiError(e2));
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(): Promise<void> {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    try {
      await cannedResponsesApi.remove(chatbot.id, deleteTarget.id);
      setDeleteTarget(null);
      void load();
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : MESSAGES.errors.generic);
    } finally {
      setDeleting(false);
    }
  }

  async function handleMove(item: CannedResponse, direction: 'UP' | 'DOWN'): Promise<void> {
    if (movingId) return; // L3: 이전 이동 요청이 끝나기 전에는 새 이동을 받지 않는다(연타 방지).
    setMovingId(item.id);
    try {
      const res = await cannedResponsesApi.move(chatbot.id, item.id, { direction });
      setItems(res.items);
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : MESSAGES.errors.generic);
    } finally {
      setMovingId(null);
    }
  }

  return (
    <div className="canned-responses-page">
      <div className="dialogue-toolbar">
        <h2>{msg.pageTitle}</h2>
        {canWrite && (
          <button
            type="button"
            className="btn btn-primary"
            disabled={atLimit}
            aria-disabled={atLimit}
            title={atLimit ? msg.addButtonLimitReached : undefined}
            onClick={openCreate}
          >
            {msg.addButton} ({items.length}/{HANDOFF_LIMITS.cannedPerChatbot})
          </button>
        )}
      </div>

      <label className="form-field--inline">
        {msg.searchLabel}
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} />
      </label>

      {loading ? (
        <>
          <SkeletonRow />
          <SkeletonRow />
        </>
      ) : error ? (
        <ErrorState title={MESSAGES.errors.generic} onRetry={load} />
      ) : filtered.length === 0 ? (
        <EmptyState
          title={msg.emptyTitle}
          description={msg.emptyDesc}
          action={
            canWrite && (
              <button type="button" className="btn btn-primary" onClick={openCreate}>
                {msg.addButton}
              </button>
            )
          }
        />
      ) : (
        <div className="import-report-table-wrap">
          <table className="import-report-table">
            <thead>
              <tr>
                <th scope="col">{msg.columnTitle}</th>
                <th scope="col">{msg.columnCategory}</th>
                <th scope="col">{msg.columnShortcut}</th>
                <th scope="col">{msg.columnEnabled}</th>
                <th scope="col">{msg.columnOrder}</th>
                <th scope="col">{MESSAGES.users.columnActions}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((item, index) => (
                <tr key={item.id}>
                  <td>{item.title}</td>
                  <td>{item.category ?? '—'}</td>
                  <td>{item.shortcut ?? '—'}</td>
                  <td>{item.enabled ? '●' : '○'}</td>
                  <td>
                    <button
                      type="button"
                      className="reorderable-btn"
                      aria-label={`${item.title} ${msg.moveUpAction}`}
                      disabled={!canWrite || index === 0 || movingId !== null}
                      aria-disabled={!canWrite || index === 0 || movingId !== null}
                      onClick={() => void handleMove(item, 'UP')}
                    >
                      ▲
                    </button>
                    <button
                      type="button"
                      className="reorderable-btn"
                      aria-label={`${item.title} ${msg.moveDownAction}`}
                      disabled={!canWrite || index === filtered.length - 1 || movingId !== null}
                      aria-disabled={!canWrite || index === filtered.length - 1 || movingId !== null}
                      onClick={() => void handleMove(item, 'DOWN')}
                    >
                      ▼
                    </button>
                  </td>
                  <td>
                    {canWrite && (
                      <>
                        <button type="button" className="btn btn-secondary" onClick={() => openEdit(item)}>
                          {msg.editAction}
                        </button>{' '}
                        <button type="button" className="btn btn-secondary" onClick={() => setDeleteTarget(item)}>
                          {msg.deleteAction}
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal isOpen={editTarget !== null} title={editTarget === 'new' ? msg.createTitle : msg.editTitle} onClose={() => setEditTarget(null)}>
        <form onSubmit={(e) => void handleSubmit(e)} noValidate>
          {fieldErrors.form && (
            <p className="modal-banner modal-banner--error" role="alert">
              {fieldErrors.form}
            </p>
          )}
          <div className="form-field">
            <label htmlFor="canned-title">
              {msg.formTitleLabel} <span className="required-mark" aria-hidden="true">*</span>
            </label>
            <input
              id="canned-title"
              type="text"
              value={form.title}
              required
              maxLength={HANDOFF_LIMITS.cannedTitleMax}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              aria-describedby={fieldErrors.title ? 'canned-title-error' : undefined}
              aria-invalid={Boolean(fieldErrors.title)}
            />
            <InlineFieldError id="canned-title-error" message={fieldErrors.title} />
          </div>
          <div className="form-field">
            <label htmlFor="canned-body">
              {msg.formBodyLabel} <span className="required-mark" aria-hidden="true">*</span>
            </label>
            <textarea
              id="canned-body"
              value={form.body}
              required
              maxLength={HANDOFF_LIMITS.cannedBodyMax}
              onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))}
              aria-describedby={fieldErrors.body ? 'canned-body-error' : undefined}
              aria-invalid={Boolean(fieldErrors.body)}
            />
            <InlineFieldError id="canned-body-error" message={fieldErrors.body} />
          </div>
          <div className="form-field">
            <label htmlFor="canned-category">{msg.formCategoryLabel}</label>
            <input
              id="canned-category"
              type="text"
              value={form.category}
              maxLength={HANDOFF_LIMITS.cannedCategoryMax}
              onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
            />
          </div>
          <div className="form-field">
            <label htmlFor="canned-shortcut">{msg.formShortcutLabel}</label>
            <input
              id="canned-shortcut"
              type="text"
              value={form.shortcut}
              maxLength={HANDOFF_LIMITS.cannedShortcutMax}
              onChange={(e) => setForm((f) => ({ ...f, shortcut: e.target.value }))}
              aria-describedby={fieldErrors.shortcut ? 'canned-shortcut-error' : undefined}
              aria-invalid={Boolean(fieldErrors.shortcut)}
            />
            <InlineFieldError id="canned-shortcut-error" message={fieldErrors.shortcut} />
          </div>
          <label className="form-field--inline">
            <input type="checkbox" checked={form.enabled} onChange={(e) => setForm((f) => ({ ...f, enabled: e.target.checked }))} />
            {msg.formEnabledLabel}
          </label>
          <div className="modal-actions">
            <button type="button" className="btn btn-secondary" onClick={() => setEditTarget(null)}>
              {MESSAGES.common.cancel}
            </button>
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              {MESSAGES.common.save}
            </button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        isOpen={deleteTarget !== null}
        title={msg.deleteConfirmTitle}
        description={msg.deleteConfirmDesc}
        confirmLabel={MESSAGES.common.delete}
        danger
        onConfirm={() => void handleDelete()}
        onCancel={() => setDeleteTarget(null)}
        confirmDisabled={deleting}
      />
    </div>
  );
}
