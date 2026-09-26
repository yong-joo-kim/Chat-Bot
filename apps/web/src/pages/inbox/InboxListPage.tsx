import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { InboxSummaryResponse, InboxThreadListItem } from '@chat-bot/shared-types';
import { inboxApi } from '../../api/inbox';
import { ApiError } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { useLatestRequest } from '../../lib/useLatestRequest';
import { SkeletonRow } from '../../components/Skeleton';
import { ErrorState } from '../../components/ErrorState';
import { EmptyState } from '../../components/EmptyState';
import { Pagination } from '../../components/Pagination';
import { Modal } from '../../components/Modal';
import { InlineFieldError } from '../../components/InlineFieldError';
import { MESSAGES } from '../../constants/messages';
import { InboxSummaryChips } from '../../components/inbox/InboxSummaryChips';
import { InboxFilterBar, DEFAULT_INBOX_FILTER, type InboxFilterState } from '../../components/inbox/InboxFilterBar';
import { InboxThreadTable } from '../../components/inbox/InboxThreadTable';

const PAGE_SIZE = 20;

function toQuery(filter: InboxFilterState, page: number) {
  return {
    page,
    pageSize: PAGE_SIZE,
    status: filter.status,
    assignee: filter.assignee,
    chatbotIds: filter.chatbotIds,
    channelFamily: filter.channelFamily,
    tagIds: filter.tagIds,
    customerKinds: filter.customerKinds,
    includeTest: filter.includeTest,
    activeHandoff: filter.activeHandoff,
    from: filter.from ? new Date(filter.from) : undefined,
    to: filter.to ? new Date(filter.to) : undefined,
    q: filter.q,
  };
}

/** OI-1 — 통합 인박스 목록(`omnichannel-inbox-ui-spec.md` §3.1 `/inbox`). */
export function InboxListPage(): JSX.Element {
  const navigate = useNavigate();
  const { can } = useAuth();
  const msg = MESSAGES.inbox;
  const guard = useLatestRequest();

  const [filter, setFilter] = useState<InboxFilterState>(DEFAULT_INBOX_FILTER);
  const [page, setPage] = useState(1);
  const [summary, setSummary] = useState<InboxSummaryResponse | null>(null);
  const [items, setItems] = useState<InboxThreadListItem[] | null>(null);
  const [total, setTotal] = useState(0);
  const [participatingChatbots, setParticipatingChatbots] = useState<Array<{ id: string; name: string }>>([]);
  const [pollAfterMs, setPollAfterMs] = useState(10000);
  const [tags, setTags] = useState<Array<{ id: string; name: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<'NONE' | 'DISABLED' | 'FAILED'>('NONE');
  const [failCount, setFailCount] = useState(0);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [testModalOpen, setTestModalOpen] = useState(false);

  const load = useCallback(async () => {
    const reqId = guard.next();
    try {
      const [summaryRes, listRes] = await Promise.all([inboxApi.summary(), inboxApi.threads(toQuery(filter, page))]);
      if (guard.isStale(reqId)) return;
      setSummary(summaryRes);
      setItems(listRes.items);
      setTotal(listRes.total);
      setParticipatingChatbots(listRes.participatingChatbots);
      setPollAfterMs(listRes.pollAfterMs);
      setError('NONE');
      setFailCount(0);
    } catch (e) {
      if (guard.isStale(reqId)) return;
      if (e instanceof ApiError && e.status === 404) {
        setError('DISABLED');
      } else {
        setError('FAILED');
        setFailCount((c) => c + 1);
      }
    } finally {
      if (!guard.isStale(reqId)) setLoading(false);
    }
  }, [filter, page, guard]);

  useEffect(() => {
    setLoading(true);
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, page]);

  useEffect(() => {
    inboxApi.tags
      .list()
      .then((res) => setTags(res.map((t) => ({ id: t.id, name: t.name }))))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, pollAfterMs);
    return () => window.clearInterval(timer);
  }, [load, pollAfterMs]);

  function handleFilterChange(patch: Partial<InboxFilterState>): void {
    setFilter((prev) => ({ ...prev, ...patch }));
    setPage(1);
  }

  function handleSummaryFilter(patch: Partial<InboxFilterState>): void {
    handleFilterChange(patch);
  }

  function handleResetFilters(): void {
    setFilter(DEFAULT_INBOX_FILTER);
    setPage(1);
  }

  if (error === 'DISABLED') {
    return <ErrorState title={msg.disabledError} />;
  }

  return (
    <div className="inbox-list-page">
      <h2>{msg.title}</h2>

      {summary && <InboxSummaryChips summary={summary} onFilter={handleSummaryFilter} />}

      {loading && items === null && (
        <>
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
        </>
      )}

      {error === 'FAILED' && items === null && <ErrorState title={msg.loadFailed} onRetry={() => void load()} />}

      {items !== null && (
        <>
          {failCount >= 3 && (
            <p className="error-state-title" role="alert">
              <span aria-hidden="true">⚠</span> {MESSAGES.handoffConsole.pollingStaleBanner}
            </p>
          )}

          <InboxFilterBar value={filter} onChange={handleFilterChange} participatingChatbots={participatingChatbots} tags={tags} canManageTags={can('cs:write')} />

          <div className="form-actions">
            {can('cs:write') && (
              <button type="button" className="btn btn-primary" onClick={() => setCreateModalOpen(true)}>
                {msg.newRecordButton}
              </button>
            )}
            {can('simulation:write') && can('cs:read') && (
              <button type="button" className="btn btn-secondary" onClick={() => setTestModalOpen(true)}>
                {msg.newTestCustomerButton}
              </button>
            )}
          </div>

          {participatingChatbots.length === 0 && items.length === 0 ? (
            <EmptyState
              title={msg.noParticipatingChatbots}
              action={
                can('chatbot:write') ? (
                  <button type="button" className="btn btn-secondary" onClick={() => navigate('/chatbots')}>
                    {msg.goToChatbotSettings}
                  </button>
                ) : undefined
              }
            />
          ) : items.length === 0 ? (
            <EmptyState
              title={JSON.stringify(filter) === JSON.stringify(DEFAULT_INBOX_FILTER) ? msg.emptyDefault : msg.emptyFiltered}
              action={
                <button type="button" className="btn btn-secondary" onClick={handleResetFilters}>
                  {msg.resetFilters}
                </button>
              }
            />
          ) : (
            <>
              <InboxThreadTable items={items} />
              <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} />
            </>
          )}
        </>
      )}

      <CreateAnonymousCustomerModal isOpen={createModalOpen} onClose={() => setCreateModalOpen(false)} onCreated={(threadId) => navigate(`/inbox/${threadId}`)} />
      <CreateTestCustomerModal isOpen={testModalOpen} onClose={() => setTestModalOpen(false)} onCreated={(threadId) => navigate(`/inbox/${threadId}`)} />
    </div>
  );
}

function CreateAnonymousCustomerModal({ isOpen, onClose, onCreated }: { isOpen: boolean; onClose: () => void; onCreated: (threadId: string) => void }): JSX.Element {
  const msg = MESSAGES.inbox;
  const [displayName, setDisplayName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>();

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setSaving(true);
    setError(undefined);
    try {
      const res = await inboxApi.createAnonymousCustomer({ displayName: displayName || undefined });
      onCreated(res.threadId);
      onClose();
      setDisplayName('');
    } catch (e2) {
      setError(e2 instanceof ApiError ? e2.message : MESSAGES.errors.generic);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal isOpen={isOpen} title={msg.newRecordButton} onClose={onClose}>
      <form onSubmit={(e) => void handleSubmit(e)}>
        <div className="form-field">
          <label htmlFor="new-customer-display-name">{msg.newTestCustomerLabel}</label>
          <input id="new-customer-display-name" type="text" maxLength={40} value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        </div>
        <InlineFieldError id="new-customer-error" message={error} />
        <div className="modal-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={saving}>
            {msg.cancel}
          </button>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? MESSAGES.common.saving : msg.createTestCustomer}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function CreateTestCustomerModal({ isOpen, onClose, onCreated }: { isOpen: boolean; onClose: () => void; onCreated: (threadId: string) => void }): JSX.Element {
  const msg = MESSAGES.inbox;
  const [label, setLabel] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>();

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (label.trim().length === 0) {
      setError(MESSAGES.errors.generic);
      return;
    }
    setSaving(true);
    setError(undefined);
    try {
      const res = await inboxApi.createTestCustomer({ label });
      onCreated(res.threadId);
      onClose();
      setLabel('');
    } catch (e2) {
      setError(e2 instanceof ApiError ? e2.message : MESSAGES.errors.generic);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal isOpen={isOpen} title={msg.newTestCustomerButton} onClose={onClose}>
      <form onSubmit={(e) => void handleSubmit(e)}>
        <div className="form-field">
          <label htmlFor="new-test-customer-label">{msg.newTestCustomerLabel}</label>
          <input id="new-test-customer-label" type="text" maxLength={40} required value={label} onChange={(e) => setLabel(e.target.value)} />
        </div>
        <InlineFieldError id="new-test-customer-error" message={error} />
        <div className="modal-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={saving}>
            {msg.cancel}
          </button>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? MESSAGES.common.saving : msg.createTestCustomer}
          </button>
        </div>
      </form>
    </Modal>
  );
}
