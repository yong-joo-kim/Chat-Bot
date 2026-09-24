import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { DesignValidationReport, DialogNodeListItem, DialogNodeType, FlowTree } from '@chat-bot/shared-types';
import { useChatbotDetailContext } from '../ChatbotDetailLayout';
import { dialogNodesApi, intentsApi } from '../../api/dialogue';
import { ApiError } from '../../api/client';
import { useToast } from '../../components/Toast';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { SkeletonRow } from '../../components/Skeleton';
import { Pagination } from '../../components/Pagination';
import { KebabMenu } from '../../components/KebabMenu';
import { ConfirmDialog } from '../../components/Modal';
import { MESSAGES } from '../../constants/messages';
import { ConditionSummaryChips, NodeTypeBadge, OutputTypeIconList } from './badges';
import { FlowPreviewPanel } from './components/FlowPreviewPanel';
import { DesignValidationPanel } from './components/DesignValidationPanel';
import { DeleteBlockedBanner } from './components/DeleteBlockedBanner';
import { ScheduleConflictBanner } from '../../components/ScheduleConflictBanner';

const ALL_TYPES: DialogNodeType[] = ['NORMAL', 'START', 'FALLBACK'];

/** D1 — 대화그래프: 노드 목록/흐름미리보기/설계점검(ui-spec §4.1). */
export function NodesListPage(): JSX.Element {
  const { chatbot } = useChatbotDetailContext();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const isArchived = chatbot.status === 'ARCHIVED';
  const msg = MESSAGES.dialogue.nodes;

  const [q, setQ] = useState('');
  const [typeFilter, setTypeFilter] = useState<DialogNodeType[]>(ALL_TYPES);
  const [enabledFilter, setEnabledFilter] = useState<'all' | 'enabled' | 'disabled'>('all');
  const [sort, setSort] = useState<'priority' | 'name' | 'updatedAt'>('priority');
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<DialogNodeListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [hasAnyIntent, setHasAnyIntent] = useState(true);

  const [deleteTarget, setDeleteTarget] = useState<DialogNodeListItem | null>(null);
  const [deleteBlocked, setDeleteBlocked] = useState<{ message: string; refs: { id: string; name: string }[] } | null>(null);

  const [flowOpen, setFlowOpen] = useState(false);
  const [flowTree, setFlowTree] = useState<FlowTree | null>(null);
  const [flowLoading, setFlowLoading] = useState(false);
  const [flowError, setFlowError] = useState(false);

  const [validationOpen, setValidationOpen] = useState(false);
  const [report, setReport] = useState<DesignValidationReport | null>(null);
  const [validationLoading, setValidationLoading] = useState(false);
  const [validationError, setValidationError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const res = await dialogNodesApi.list(chatbot.id, {
        q: q || undefined,
        // 서버가 `nodeType=NORMAL,START`처럼 콤마구분 다중값을 지원한다(csvEnumArray) — 그대로 위임한다.
        nodeType: typeFilter.length > 0 ? typeFilter : undefined,
        enabled: enabledFilter === 'all' ? undefined : enabledFilter === 'enabled',
        sort,
        page,
        pageSize: 20,
      });
      setItems(res.items);
      setTotal(res.total);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [chatbot.id, q, typeFilter, enabledFilter, sort, page]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    intentsApi
      .list(chatbot.id, { page: 1, pageSize: 1 })
      .then((res) => setHasAnyIntent(res.total > 0))
      .catch(() => setHasAnyIntent(true));
  }, [chatbot.id]);

  function toggleType(t: DialogNodeType): void {
    setTypeFilter((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));
    setPage(1);
  }

  async function loadFlow(): Promise<void> {
    setFlowLoading(true);
    setFlowError(false);
    try {
      const tree = await dialogNodesApi.flow(chatbot.id);
      setFlowTree(tree);
    } catch {
      setFlowError(true);
    } finally {
      setFlowLoading(false);
    }
  }

  function handleToggleFlow(): void {
    const next = !flowOpen;
    setFlowOpen(next);
    if (next && !flowTree) void loadFlow();
  }

  async function loadValidation(): Promise<void> {
    setValidationLoading(true);
    setValidationError(false);
    try {
      const res = await dialogNodesApi.validate(chatbot.id);
      setReport(res);
    } catch {
      setValidationError(true);
    } finally {
      setValidationLoading(false);
    }
  }

  function handleRunValidation(): void {
    setValidationOpen(true);
    void loadValidation();
  }

  async function handleCopy(node: DialogNodeListItem): Promise<void> {
    try {
      const copy = await dialogNodesApi.copy(chatbot.id, node.id);
      const excludedCount = copy.excludedLegacyApiOutputCount;
      const baseName = copy.name.replace(' (사본)', '');
      showToast(excludedCount > 0 ? `${msg.copySuccess(baseName)} ${MESSAGES.dialogue.outputFields.copyExcludedLegacyApi(excludedCount)}` : msg.copySuccess(baseName));
      void load();
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : MESSAGES.errors.generic);
    }
  }

  async function handleDeleteConfirm(): Promise<void> {
    if (!deleteTarget) return;
    try {
      await dialogNodesApi.remove(chatbot.id, deleteTarget.id);
      showToast(msg.deleteSuccess);
      setDeleteTarget(null);
      setDeleteBlocked(null);
      void load();
    } catch (e) {
      if (e instanceof ApiError && e.details && e.details.length > 0) {
        setDeleteBlocked({ message: e.message, refs: e.details.map((d) => ({ id: d.field, name: d.message })) });
      } else {
        showToast(e instanceof ApiError ? e.message : MESSAGES.errors.generic);
        setDeleteTarget(null);
      }
    }
  }

  return (
    <div>
      <ScheduleConflictBanner chatbotId={chatbot.id} />
      <div className="dialogue-toolbar">
        <div className="dialogue-search-row">
          <label htmlFor="node-search" className="sr-only">
            {msg.searchLabel}
          </label>
          <input
            id="node-search"
            type="text"
            placeholder={msg.searchPlaceholder}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
          />
          <fieldset className="status-filter">
            <legend className="sr-only">{msg.typeFilterLabel}</legend>
            <label className="status-filter-option">
              <input type="checkbox" checked={typeFilter.includes('NORMAL')} onChange={() => toggleType('NORMAL')} />
              {MESSAGES.dialogue.nodeForm.typeNormal}
            </label>
            <label className="status-filter-option">
              <input type="checkbox" checked={typeFilter.includes('START')} onChange={() => toggleType('START')} />
              {MESSAGES.dialogue.nodeForm.typeStart}
            </label>
            <label className="status-filter-option">
              <input type="checkbox" checked={typeFilter.includes('FALLBACK')} onChange={() => toggleType('FALLBACK')} />
              {MESSAGES.dialogue.nodeForm.typeFallback}
            </label>
          </fieldset>
          <label htmlFor="node-enabled-filter" className="sr-only">
            {msg.enabledFilterLabel}
          </label>
          <select
            id="node-enabled-filter"
            value={enabledFilter}
            onChange={(e) => {
              setEnabledFilter(e.target.value as 'all' | 'enabled' | 'disabled');
              setPage(1);
            }}
          >
            <option value="all">{msg.enabledAll}</option>
            <option value="enabled">{msg.enabledOnly}</option>
            <option value="disabled">{msg.disabledOnly}</option>
          </select>
          <label htmlFor="node-sort" className="sr-only">
            {msg.sortLabel}
          </label>
          <select id="node-sort" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
            <option value="priority">{msg.sortPriority}</option>
            <option value="name">{msg.sortName}</option>
            <option value="updatedAt">{msg.sortUpdatedAt}</option>
          </select>
        </div>
        {!isArchived && (
          <div className="dialogue-toolbar-actions">
            <button type="button" className="btn btn-secondary" onClick={handleRunValidation}>
              {msg.validateButton}
            </button>
            <button type="button" className="btn btn-secondary" onClick={handleToggleFlow} aria-expanded={flowOpen}>
              {msg.flowPreviewButton}
            </button>
            <button type="button" className="btn btn-primary" onClick={() => navigate(`/chatbots/${chatbot.id}/dialogue/nodes/new`)}>
              {msg.addButton}
            </button>
          </div>
        )}
      </div>

      {validationOpen && (
        <DesignValidationPanel
          chatbotId={chatbot.id}
          report={report}
          loading={validationLoading}
          error={validationError}
          onRetry={loadValidation}
          onClose={() => setValidationOpen(false)}
        />
      )}
      {flowOpen && (
        <FlowPreviewPanel chatbotId={chatbot.id} tree={flowTree} loading={flowLoading} error={flowError} onLoad={loadFlow} />
      )}

      {loading && (
        <>
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
        </>
      )}
      {!loading && error && <ErrorState title={msg.loadFailed} onRetry={load} />}
      {!loading && !error && items.length === 0 && (
        <EmptyState
          title={msg.emptyTitle}
          description={msg.emptyDesc}
          action={
            !isArchived && (
              <>
                {!hasAnyIntent && (
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => navigate(`/chatbots/${chatbot.id}/dialogue/intents?resource=intent`)}
                  >
                    {msg.emptyIntentFirst}
                  </button>
                )}{' '}
                <button type="button" className="btn btn-primary" onClick={() => navigate(`/chatbots/${chatbot.id}/dialogue/nodes/new`)}>
                  {msg.addButton}
                </button>
              </>
            )
          }
        />
      )}
      {!loading && !error && items.length > 0 && (
        <div className="dialogue-table-wrap">
          <p className="result-count-badge">{MESSAGES.common.totalCount(total)}</p>
          <table className="dialogue-table">
            <thead>
              <tr>
                <th scope="col">{msg.columnName}</th>
                <th scope="col">{msg.columnType}</th>
                <th scope="col">{msg.columnEnabled}</th>
                <th scope="col">{msg.columnPriority}</th>
                <th scope="col">{msg.columnCondition}</th>
                <th scope="col">{msg.columnOutputs}</th>
                <th scope="col">{msg.columnIncoming}</th>
                <th scope="col">{msg.columnUpdatedAt}</th>
                <th scope="col">{msg.columnActions}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td>
                    <button type="button" className="link-button" onClick={() => navigate(`/chatbots/${chatbot.id}/dialogue/nodes/${item.id}`)}>
                      {item.name}
                    </button>
                  </td>
                  <td>
                    <NodeTypeBadge type={item.nodeType} />
                  </td>
                  <td>{item.enabled ? msg.enabledYes : msg.enabledNo}</td>
                  <td>{item.nodeType === 'NORMAL' ? item.priority : '—'}</td>
                  <td>
                    <ConditionSummaryChips summary={item.conditionSummary} />
                  </td>
                  <td>
                    <OutputTypeIconList outputTypes={item.outputTypes} />
                  </td>
                  <td>{msg.incomingCount(item.incomingCount)}</td>
                  <td>{new Date(item.updatedAt).toLocaleDateString('ko-KR')}</td>
                  <td>
                    {!isArchived && (
                      <KebabMenu
                        label={`${item.name} 관리`}
                        items={[
                          { label: msg.editAction, onSelect: () => navigate(`/chatbots/${chatbot.id}/dialogue/nodes/${item.id}`) },
                          { label: msg.copyAction, onSelect: () => void handleCopy(item) },
                          { label: msg.deleteAction, onSelect: () => setDeleteTarget(item) },
                        ]}
                      />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pagination page={page} pageSize={20} total={total} onPageChange={setPage} />
        </div>
      )}

      <ConfirmDialog
        isOpen={Boolean(deleteTarget)}
        title={msg.deleteTitle}
        description={deleteTarget ? msg.deleteDesc(deleteTarget.name) : ''}
        confirmLabel={MESSAGES.common.delete}
        danger
        onConfirm={handleDeleteConfirm}
        onCancel={() => {
          setDeleteTarget(null);
          setDeleteBlocked(null);
        }}
      >
        {deleteBlocked && (
          <DeleteBlockedBanner
            chatbotId={chatbot.id}
            message={deleteBlocked.message}
            refs={deleteBlocked.refs}
            kind="node"
            onBeforeNavigate={() => {
              setDeleteTarget(null);
              setDeleteBlocked(null);
            }}
          />
        )}
      </ConfirmDialog>
    </div>
  );
}
