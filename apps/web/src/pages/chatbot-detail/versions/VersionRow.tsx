import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { ChatbotVersionDetail, ChatbotVersionListItem, VersionAuditCount } from '@chat-bot/shared-types';
import { VERSION_LIMITS } from '@chat-bot/shared-types';
import { VersionTriggerBadge } from '../../../components/VersionTriggerBadge';
import { KebabMenu } from '../../../components/KebabMenu';
import { ConfirmDialog } from '../../../components/Modal';
import { formatDateTime } from '../../../lib/date';
import { MESSAGES } from '../../../constants/messages';
import { ApiError } from '../../../api/client';
import { versionsApi } from '../../../api/versions';

/** L1 "09:51 편집자A가 v27로 복원했습니다" 구분선(FR-H2-4) — `trigger==='BEFORE_RESTORE'` 행 바로 위에만. */
export function RestoreEventDivider({ item }: { item: ChatbotVersionListItem }): JSX.Element | null {
  if (item.trigger !== 'BEFORE_RESTORE' || item.restoredFromVersionNo === null) return null;
  const editor = item.createdByEmail ?? '—';
  return (
    <p className="version-restore-event-divider" role="note">
      {MESSAGES.versions.restoreEventDivider(formatDateTime(item.createdAt), editor, item.restoredFromVersionNo)}
    </p>
  );
}

export interface VersionRowProps {
  chatbotId: string;
  item: ChatbotVersionListItem;
  expanded: boolean;
  onToggleExpand: () => void;
  canWrite: boolean;
  canRestore: boolean;
  canAudit: boolean;
  onLabelSaved: () => void;
  onDeleted: () => void;
  onRestoreRequested: () => void;
}

/** L1 버전 1행(접힌 상태 + 행 확장 시 메타 상세) — `version-history-ui-spec.md` §4.1.2/§4.1.3. */
export function VersionRow({
  chatbotId,
  item,
  expanded,
  onToggleExpand,
  canWrite,
  canRestore,
  canAudit,
  onLabelSaved,
  onDeleted,
  onRestoreRequested,
}: VersionRowProps): JSX.Element {
  const msg = MESSAGES.versions;

  const [editingFields, setEditingFields] = useState(false);
  const [label, setLabel] = useState(item.label ?? '');
  const [memo, setMemo] = useState(item.memo ?? '');
  const [saving, setSaving] = useState(false);
  const [fieldError, setFieldError] = useState<string | undefined>();

  const [pinBusy, setPinBusy] = useState(false);
  const [pinError, setPinError] = useState<string | undefined>();

  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string | undefined>();

  const [detail, setDetail] = useState<ChatbotVersionDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [auditCount, setAuditCount] = useState<VersionAuditCount | null>(null);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditRequested, setAuditRequested] = useState(false);

  async function handleToggle(): Promise<void> {
    onToggleExpand();
    if (!expanded && !detail) {
      setDetailLoading(true);
      try {
        const d = await versionsApi.detail(chatbotId, item.id);
        setDetail(d);
      } catch {
        // 상세 로드 실패는 메타 상세만 비워둘 뿐 — 행 자체는 그대로 둔다.
      } finally {
        setDetailLoading(false);
      }
    }
  }

  async function loadAuditCount(): Promise<void> {
    if (auditRequested) return;
    setAuditRequested(true);
    setAuditLoading(true);
    try {
      const res = await versionsApi.auditCount(chatbotId, item.id);
      setAuditCount(res);
    } catch {
      // 감사 건수 조회 실패는 조용히 무시한다 — 행 확장 자체를 막지 않는다.
    } finally {
      setAuditLoading(false);
    }
  }

  async function handleSaveFields(): Promise<void> {
    setSaving(true);
    setFieldError(undefined);
    try {
      await versionsApi.update(chatbotId, item.id, {
        label: label.trim() ? label.trim() : null,
        memo: memo.trim() ? memo.trim() : null,
      });
      setEditingFields(false);
      onLabelSaved();
    } catch (e) {
      setFieldError(e instanceof ApiError ? e.message : MESSAGES.errors.generic);
    } finally {
      setSaving(false);
    }
  }

  async function handleTogglePin(): Promise<void> {
    setPinBusy(true);
    setPinError(undefined);
    try {
      await versionsApi.update(chatbotId, item.id, { pinned: !item.pinned });
      onLabelSaved();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'VERSION_PINNED_LIMIT_EXCEEDED') {
        setPinError(msg.pinnedLimitError);
      } else {
        setPinError(e instanceof ApiError ? e.message : MESSAGES.errors.generic);
      }
    } finally {
      setPinBusy(false);
    }
  }

  async function handleDeleteConfirm(): Promise<void> {
    setDeleteError(undefined);
    try {
      await versionsApi.remove(chatbotId, item.id);
      setDeleteConfirmOpen(false);
      onDeleted();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'VERSION_PINNED') {
        setDeleteError(msg.deletePinnedError);
      } else {
        setDeleteError(e instanceof ApiError ? e.message : MESSAGES.errors.generic);
        setDeleteConfirmOpen(false);
      }
    }
  }

  return (
    <li className="version-row-item">
      <RestoreEventDivider item={item} />
      <div className="version-row">
        <button type="button" className="version-row-toggle" aria-expanded={expanded} onClick={() => void handleToggle()}>
          <span aria-hidden="true">{expanded ? '▾' : '▸'}</span>{' '}
          <VersionTriggerBadge trigger={item.trigger} triggerContext={item.triggerContext} restoredFromVersionNo={item.restoredFromVersionNo} />{' '}
          <span className="version-row-no">v{item.versionNo}</span>{' '}
          <span className="version-row-timestamp">
            {formatDateTime(item.createdAt)} · {item.createdByEmail ?? '—'}
          </span>
        </button>

        <div className="version-row-meta">
          <span>
            {msg.content.kindTabs.INTENT}
            {item.counts.intents}·{msg.content.kindTabs.KEYWORD}
            {item.counts.keywords}·{msg.content.kindTabs.FAQ}
            {item.counts.faqs}
          </span>
          {item.integrityWarningCount > 0 && <span className="version-integrity-warning">{msg.integrityWarningCount(item.integrityWarningCount)}</span>}
          {item.label ? <span className="version-row-label">{item.label}</span> : <span className="version-row-label version-row-label--none">{msg.labelNone}</span>}
          {item.memo && <span className="version-row-memo">{msg.memoPresent(item.memo)}</span>}
          {canWrite && (
            <button type="button" className="version-pin-toggle" onClick={() => void handleTogglePin()} disabled={pinBusy} aria-pressed={item.pinned}>
              {item.pinned ? `📌 ${msg.pinnedBadge}` : msg.pinAction}
            </button>
          )}
          {canWrite && (
            <KebabMenu
              label={msg.kebabLabel(item.versionNo)}
              items={[
                { label: msg.menuEditLabel, onSelect: () => setEditingFields(true) },
                { label: msg.menuDelete, onSelect: () => setDeleteConfirmOpen(true), disabled: item.pinned },
              ]}
            />
          )}
        </div>

        {pinError && (
          <p className="field-error" role="alert">
            {pinError}
          </p>
        )}

        <div className="version-row-actions">
          <Link to={`/chatbots/${chatbotId}/versions/${item.id}/diff?against=current`} className="btn btn-secondary">
            {msg.compareCurrentButton}
          </Link>
          <Link to={`/chatbots/${chatbotId}/versions/${item.id}/diff`} className="btn btn-secondary">
            {msg.compareOtherButton}
          </Link>
          <Link to={`/chatbots/${chatbotId}/versions/${item.id}/content`} className="btn btn-secondary">
            {msg.contentButton}
          </Link>
          {canRestore && (
            <button type="button" className="btn btn-primary" onClick={onRestoreRequested}>
              {msg.restoreButton}
            </button>
          )}
        </div>

        {expanded && (
          <div className="version-row-detail">
            {detailLoading && <p role="status">{MESSAGES.common.loading}</p>}
            {!detailLoading && detail?.integrityWarnings && detail.integrityWarnings.length > 0 && (
              <p className="field-hint">
                {msg.integrityWarningCount(detail.integrityWarnings.length)} — {msg.integrityWarningDetail}
              </p>
            )}

            {editingFields && canWrite ? (
              <div className="version-fields-edit">
                {fieldError && (
                  <p className="field-error" role="alert">
                    {fieldError}
                  </p>
                )}
                <div className="form-field">
                  <label htmlFor={`version-label-${item.id}`}>{msg.labelFieldLabel}</label>
                  <input
                    id={`version-label-${item.id}`}
                    type="text"
                    value={label}
                    maxLength={VERSION_LIMITS.labelMaxLength}
                    onChange={(e) => setLabel(e.target.value)}
                  />
                </div>
                <div className="form-field">
                  <label htmlFor={`version-memo-${item.id}`}>{msg.memoFieldLabel}</label>
                  <textarea
                    id={`version-memo-${item.id}`}
                    value={memo}
                    maxLength={VERSION_LIMITS.memoMaxLength}
                    onChange={(e) => setMemo(e.target.value)}
                  />
                </div>
                <div className="form-actions">
                  <button type="button" className="btn btn-secondary" onClick={() => setEditingFields(false)} disabled={saving}>
                    {MESSAGES.common.cancel}
                  </button>
                  <button type="button" className="btn btn-primary" onClick={() => void handleSaveFields()} disabled={saving}>
                    {saving ? MESSAGES.common.saving : msg.saveFieldsButton}
                  </button>
                </div>
              </div>
            ) : null}

            {canAudit && (
              <div className="audit-count-disclosure">
                {!auditRequested && (
                  <button type="button" className="link-button" onClick={() => void loadAuditCount()}>
                    {msg.auditCountDisclosureButton}
                  </button>
                )}
                {auditLoading && <span>{MESSAGES.common.loading}</span>}
                {auditCount && (
                  <p>
                    {msg.auditCountLabel(auditCount.count)}
                    {auditCount.link.clamped && ` ${msg.auditCountClamped}`}{' '}
                    <Link
                      to={`/settings/audit-logs?chatbotId=${chatbotId}&from=${auditCount.link.from.toString()}&to=${auditCount.link.to.toString()}`}
                    >
                      {msg.auditCountLink}
                    </Link>
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        <ConfirmDialog
          isOpen={deleteConfirmOpen}
          title={msg.deleteConfirmTitle(item.versionNo)}
          description={msg.deleteConfirmDesc(item.versionNo)}
          confirmLabel={MESSAGES.common.delete}
          danger
          onConfirm={() => void handleDeleteConfirm()}
          onCancel={() => setDeleteConfirmOpen(false)}
        >
          {deleteError && (
            <p className="field-error" role="alert">
              {deleteError}
            </p>
          )}
        </ConfirmDialog>
      </div>
    </li>
  );
}
