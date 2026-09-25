import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { SurveyListItem, SurveyStatus } from '@chat-bot/shared-types';
import { useChatbotDetailContext } from '../ChatbotDetailLayout';
import { surveysApi } from '../../api/surveys';
import { ApiError } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../components/Toast';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { SkeletonRow } from '../../components/Skeleton';
import { KebabMenu } from '../../components/KebabMenu';
import { ConfirmDialog } from '../../components/Modal';
import { MESSAGES } from '../../constants/messages';
import { useLatestRequest } from '../../lib/useLatestRequest';
import { formatSurveyPeriod } from '../../lib/surveyDisplay';
import { EnvironmentScopeNotice } from '../../components/EnvironmentScopeNotice';
import { SurveyStatusBadge, SurveyLockedBadge } from './components/survey/badges';

const STATUS_OPTIONS: SurveyStatus[] = ['DRAFT', 'OPEN', 'CLOSED'];

/** SV1 — 설문 목록(`/chatbots/:chatbotId/dialogue/surveys`, ui-spec §3.1). */
export function SurveysListPage(): JSX.Element {
  const { chatbot, environmentStatus } = useChatbotDetailContext();
  const { can } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const isArchived = chatbot.status === 'ARCHIVED';
  const canWrite = can('dialogue:write') && !isArchived;
  const msg = MESSAGES.surveys;
  const guard = useLatestRequest();

  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState<Set<SurveyStatus>>(new Set(STATUS_OPTIONS));
  const [items, setItems] = useState<SurveyListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<SurveyListItem | null>(null);
  const [deleteInUse, setDeleteInUse] = useState<{ message: string; refs: { id: string; name: string }[] } | null>(null);
  const [deleteHasResponses, setDeleteHasResponses] = useState(false);

  const load = useCallback(async () => {
    const reqId = guard.next();
    setLoading(true);
    setError(false);
    try {
      const res = await surveysApi.list(chatbot.id, { q: q || undefined });
      if (guard.isStale(reqId)) return;
      setItems(res.items);
    } catch {
      if (!guard.isStale(reqId)) setError(true);
    } finally {
      if (!guard.isStale(reqId)) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatbot.id, q]);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = items.filter((s) => statusFilter.has(s.status));
  const atLimit = items.length >= 50;

  function toggleStatus(status: SurveyStatus): void {
    setStatusFilter((prev) => {
      const next = new Set(prev);
      if (next.has(status)) next.delete(status);
      else next.add(status);
      return next;
    });
  }

  async function handleStatusToggle(survey: SurveyListItem): Promise<void> {
    const nextStatus: SurveyStatus = survey.status === 'DRAFT' ? 'OPEN' : survey.status === 'OPEN' ? 'CLOSED' : 'OPEN';
    try {
      await surveysApi.update(chatbot.id, survey.id, { status: nextStatus });
      showToast(msg.statusChangeSuccess);
      void load();
    } catch (e) {
      if (e instanceof ApiError && e.details && e.details.length > 0) {
        showToast(e.details.map((d) => d.message).join(' / '));
      } else {
        showToast(e instanceof ApiError ? e.message : MESSAGES.errors.generic);
      }
    }
  }

  async function handleCopy(survey: SurveyListItem): Promise<void> {
    try {
      const created = await surveysApi.copy(chatbot.id, survey.id);
      showToast(msg.copySuccess);
      navigate(`/chatbots/${chatbot.id}/dialogue/surveys/${created.id}`);
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : MESSAGES.errors.generic);
    }
  }

  async function handleDelete(): Promise<void> {
    if (!deleteTarget) return;
    try {
      await surveysApi.remove(chatbot.id, deleteTarget.id);
      showToast(msg.deleteSuccess);
      closeDeleteDialog();
      void load();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'SURVEY_IN_USE') {
        setDeleteInUse({ message: e.message, refs: (e.details ?? []).map((d) => ({ id: d.field, name: d.message })) });
      } else if (e instanceof ApiError && e.code === 'SURVEY_HAS_RESPONSES') {
        setDeleteHasResponses(true);
      } else {
        showToast(e instanceof ApiError ? e.message : MESSAGES.errors.generic);
        closeDeleteDialog();
      }
    }
  }

  function closeDeleteDialog(): void {
    setDeleteTarget(null);
    setDeleteInUse(null);
    setDeleteHasResponses(false);
  }

  async function handleCloseInstead(): Promise<void> {
    if (!deleteTarget) return;
    try {
      await surveysApi.update(chatbot.id, deleteTarget.id, { status: 'CLOSED' });
      showToast(msg.statusChangeSuccess);
      closeDeleteDialog();
      void load();
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : MESSAGES.errors.generic);
    }
  }

  return (
    <div>
      <EnvironmentScopeNotice visible={environmentStatus?.enabled === true} />
      <div className="dialogue-toolbar">
        <div className="dialogue-search-row">
          <label htmlFor="survey-search" className="sr-only">
            {msg.searchLabel}
          </label>
          <input id="survey-search" type="text" placeholder={msg.searchLabel} value={q} onChange={(e) => setQ(e.target.value)} />
          <fieldset className="form-field form-field--inline">
            <legend className="sr-only">{msg.filterStatusLabel}</legend>
            {STATUS_OPTIONS.map((s) => (
              <label key={s} className="form-field--inline">
                <input type="checkbox" checked={statusFilter.has(s)} onChange={() => toggleStatus(s)} />
                {msg.filterStatus[s]}
              </label>
            ))}
          </fieldset>
        </div>
        {canWrite && (
          <button
            type="button"
            className="btn btn-primary"
            aria-disabled={atLimit}
            title={atLimit ? msg.addButtonLimitReached : undefined}
            onClick={() => {
              if (atLimit) return;
              navigate(`/chatbots/${chatbot.id}/dialogue/surveys/new`);
            }}
          >
            {msg.addButton}
          </button>
        )}
      </div>

      {loading && (
        <>
          <SkeletonRow />
          <SkeletonRow />
        </>
      )}
      {!loading && error && <ErrorState title={msg.loadFailed} onRetry={load} />}
      {!loading && !error && filtered.length === 0 && (
        <EmptyState
          title={msg.emptyTitle}
          description={msg.emptyDesc}
          action={
            canWrite && (
              <button type="button" className="btn btn-primary" onClick={() => navigate(`/chatbots/${chatbot.id}/dialogue/surveys/new`)}>
                {msg.addButton}
              </button>
            )
          }
        />
      )}
      {!loading && !error && filtered.length > 0 && (
        <div className="dialogue-table-wrap">
          <table className="dialogue-table">
            <thead>
              <tr>
                <th scope="col">{msg.columnName}</th>
                <th scope="col">{msg.columnStatus}</th>
                <th scope="col">{msg.columnPeriod}</th>
                <th scope="col">{msg.columnQuestionCount}</th>
                <th scope="col">{msg.columnReferencing}</th>
                <th scope="col">{msg.column30d}</th>
                <th scope="col">{msg.columnActions}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => (
                <tr key={s.id}>
                  <td>
                    <button type="button" className="link-button" onClick={() => navigate(`/chatbots/${chatbot.id}/dialogue/surveys/${s.id}`)}>
                      {s.name}
                    </button>
                  </td>
                  <td>
                    <SurveyStatusBadge status={s.status} activeFrom={s.activeFrom} activeTo={s.activeTo} />
                    {s.locked && (
                      <div>
                        <SurveyLockedBadge />
                      </div>
                    )}
                  </td>
                  <td>{formatSurveyPeriod(s.activeFrom, s.activeTo)}</td>
                  <td>{s.questionCount}</td>
                  <td>{s.referencingNodeCount}</td>
                  <td>{`${s.last30d.exposed} / ${s.last30d.completed}`}</td>
                  <td>
                    {canWrite ? (
                      <KebabMenu
                        label={`${s.name} 관리`}
                        items={[
                          { label: msg.editAction, onSelect: () => navigate(`/chatbots/${chatbot.id}/dialogue/surveys/${s.id}`) },
                          {
                            label: s.status === 'OPEN' ? msg.closeAction : msg.openAction,
                            onSelect: () => void handleStatusToggle(s),
                          },
                          { label: msg.copyAction, onSelect: () => void handleCopy(s) },
                          { label: msg.deleteAction, onSelect: () => setDeleteTarget(s) },
                        ]}
                      />
                    ) : (
                      <button type="button" className="link-button" onClick={() => navigate(`/chatbots/${chatbot.id}/dialogue/surveys/${s.id}`)}>
                        {msg.viewAction}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="field-hint">{MESSAGES.common.totalCount(items.length)}</p>
        </div>
      )}

      <ConfirmDialog
        isOpen={Boolean(deleteTarget)}
        title={msg.deleteConfirmTitle}
        description={deleteTarget ? msg.deleteConfirmDesc(deleteTarget.name) : ''}
        confirmLabel={MESSAGES.common.delete}
        danger
        onConfirm={handleDelete}
        onCancel={closeDeleteDialog}
      >
        {deleteInUse && (
          <div className="form-banner form-banner--error" role="alert">
            {msg.deleteInUseBanner(deleteInUse.refs.length)}
            <ul>
              {deleteInUse.refs.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    className="link-button"
                    onClick={() => {
                      closeDeleteDialog();
                      navigate(`/chatbots/${chatbot.id}/dialogue/nodes/${r.id}`);
                    }}
                  >
                    {r.name}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {deleteHasResponses && (
          <div className="form-banner form-banner--error" role="alert">
            {msg.deleteHasResponsesBanner}
            <button type="button" className="btn btn-secondary" onClick={() => void handleCloseInstead()}>
              {msg.closeInstead}
            </button>
          </div>
        )}
      </ConfirmDialog>
    </div>
  );
}
