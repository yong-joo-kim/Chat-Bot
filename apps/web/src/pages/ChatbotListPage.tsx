import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { ChatbotGroupWithCount, ChatbotListItem, ChatbotStatus } from '@chat-bot/shared-types';
import { groupsApi } from '../api/groups';
import { chatbotsApi } from '../api/chatbots';
import { useToast } from '../components/Toast';
import { ErrorState } from '../components/ErrorState';
import { EmptyState } from '../components/EmptyState';
import { Pagination } from '../components/Pagination';
import { MESSAGES } from '../constants/messages';
import { GroupTree } from './chatbot-list/GroupTree';
import { ChatbotFilterBar } from './chatbot-list/ChatbotFilterBar';
import { ChatbotTable, type ChatbotRowAction } from './chatbot-list/ChatbotTable';
import { ChatbotCardList } from './chatbot-list/ChatbotCardList';
import {
  ArchiveConfirmDialog,
  CopyChatbotModal,
  CopyGroupModal,
  CreateChatbotModal,
  CreateGroupModal,
  DeleteGroupConfirmDialog,
  EditGroupModal,
  MoveGroupModal,
  PermanentDeleteModal,
} from './chatbot-list/modals';

const PAGE_SIZE = 20;
const DEFAULT_STATUS: ChatbotStatus[] = ['DRAFT', 'ACTIVE'];
const VALID_SORT = new Set(['createdAt', 'updatedAt', 'name']);
const VALID_ORDER = new Set(['asc', 'desc']);

type ModalState =
  | { type: 'none' }
  | { type: 'createGroup' }
  | { type: 'editGroup'; group: ChatbotGroupWithCount }
  | { type: 'copyGroup'; group: ChatbotGroupWithCount }
  | { type: 'deleteGroup'; group: ChatbotGroupWithCount }
  | { type: 'createChatbot' }
  | { type: 'copyChatbot'; chatbot: ChatbotListItem }
  | { type: 'moveGroup'; chatbot: ChatbotListItem }
  | { type: 'archiveChatbot'; chatbot: ChatbotListItem }
  | { type: 'permanentDelete'; chatbot: ChatbotListItem };

/** S1 그룹/챗봇 목록(ui-spec §3.1). 필터 상태는 쿼리스트링에 반영해 새로고침·공유·뒤로가기를 지원한다. */
export function ChatbotListPage(): JSX.Element {
  const { showToast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  const groupId = searchParams.get('groupId') ?? undefined;
  const statusParam = searchParams.get('status');
  const status = statusParam ? (statusParam.split(',').filter(Boolean) as ChatbotStatus[]) : DEFAULT_STATUS;
  const q = searchParams.get('q') ?? '';
  const sortParam = searchParams.get('sort');
  const sort = (sortParam && VALID_SORT.has(sortParam) ? sortParam : 'updatedAt') as 'createdAt' | 'updatedAt' | 'name';
  const orderParam = searchParams.get('order');
  const order = (orderParam && VALID_ORDER.has(orderParam) ? orderParam : 'desc') as 'asc' | 'desc';
  const page = Math.max(1, Number(searchParams.get('page') ?? '1') || 1);

  const [groups, setGroups] = useState<ChatbotGroupWithCount[]>([]);
  const [groupsLoading, setGroupsLoading] = useState(true);
  const [groupsError, setGroupsError] = useState(false);

  const [chatbots, setChatbots] = useState<ChatbotListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [chatbotsLoading, setChatbotsLoading] = useState(true);
  const [chatbotsError, setChatbotsError] = useState(false);

  const [modal, setModal] = useState<ModalState>({ type: 'none' });

  function updateParams(patch: Record<string, string | undefined>, resetPage = true): void {
    const next = new URLSearchParams(searchParams);
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined || v === '') next.delete(k);
      else next.set(k, v);
    }
    if (resetPage) next.set('page', '1');
    setSearchParams(next);
  }

  const loadGroups = useCallback(async () => {
    setGroupsLoading(true);
    setGroupsError(false);
    try {
      const res = await groupsApi.list();
      setGroups(res.items);
    } catch {
      setGroupsError(true);
    } finally {
      setGroupsLoading(false);
    }
  }, []);

  const statusKey = status.join(',');
  const loadChatbots = useCallback(async () => {
    setChatbotsLoading(true);
    setChatbotsError(false);
    try {
      const res = await chatbotsApi.list({
        groupId,
        status: statusKey ? (statusKey.split(',') as ChatbotStatus[]) : [],
        q: q || undefined,
        sort,
        order,
        page,
        pageSize: PAGE_SIZE,
      });
      setChatbots(res.items);
      setTotal(res.total);
    } catch {
      setChatbotsError(true);
    } finally {
      setChatbotsLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId, statusKey, q, sort, order, page]);

  useEffect(() => {
    loadGroups();
  }, [loadGroups]);

  useEffect(() => {
    loadChatbots();
  }, [loadChatbots]);

  function closeModal(): void {
    setModal({ type: 'none' });
  }

  function handleModalSuccess(message: string): void {
    closeModal();
    void loadGroups();
    void loadChatbots();
    showToast(message);
  }

  function handleRowAction(action: ChatbotRowAction, chatbot: ChatbotListItem): void {
    if (action === 'copy') setModal({ type: 'copyChatbot', chatbot });
    else if (action === 'move') setModal({ type: 'moveGroup', chatbot });
    else if (action === 'archive') setModal({ type: 'archiveChatbot', chatbot });
    else if (action === 'permanentDelete') setModal({ type: 'permanentDelete', chatbot });
  }

  const searchActive = q.trim().length > 0;
  const isEmptyResult = !chatbotsLoading && !chatbotsError && chatbots.length === 0;
  const hasNoGroups = !groupsLoading && !groupsError && groups.length === 0;

  return (
    <div className="chatbot-list-page">
      <GroupTree
        groups={groups}
        selectedGroupId={groupId}
        onSelect={(gid) => updateParams({ groupId: gid })}
        onCreate={() => setModal({ type: 'createGroup' })}
        onEdit={(group) => setModal({ type: 'editGroup', group })}
        onCopy={(group) => setModal({ type: 'copyGroup', group })}
        onDelete={(group) => setModal({ type: 'deleteGroup', group })}
        loading={groupsLoading}
      />

      <div className="chatbot-list-main">
        <div className="chatbot-list-toolbar">
          <ChatbotFilterBar
            q={q}
            status={status}
            sort={sort}
            order={order}
            onQChange={(value) => updateParams({ q: value || undefined })}
            onStatusChange={(value) => updateParams({ status: value.join(',') || undefined })}
            onSortChange={(value) => updateParams({ sort: value })}
            onOrderChange={(value) => updateParams({ order: value })}
          />
          <button
            type="button"
            className="btn btn-primary"
            disabled={hasNoGroups}
            title={hasNoGroups ? MESSAGES.chatbot.createDisabledTooltip : undefined}
            onClick={() => setModal({ type: 'createChatbot' })}
          >
            {MESSAGES.chatbot.createButton}
          </button>
        </div>

        {chatbotsError ? (
          <ErrorState title={MESSAGES.errors.listLoadFailed} onRetry={loadChatbots} />
        ) : isEmptyResult ? (
          <EmptyState
            title={searchActive ? MESSAGES.chatbot.emptySearch : MESSAGES.chatbot.emptyChatbots}
            action={
              searchActive ? (
                <button type="button" className="btn btn-secondary" onClick={() => updateParams({ q: undefined })}>
                  {MESSAGES.chatbot.resetSearch}
                </button>
              ) : (
                <button type="button" className="btn btn-primary" disabled={hasNoGroups} onClick={() => setModal({ type: 'createChatbot' })}>
                  {MESSAGES.chatbot.createButton}
                </button>
              )
            }
          />
        ) : (
          <>
            <p className="result-count-badge">{MESSAGES.common.totalCount(total)}</p>
            <ChatbotTable items={chatbots} loading={chatbotsLoading} onAction={handleRowAction} />
            <ChatbotCardList items={chatbots} loading={chatbotsLoading} onAction={handleRowAction} />
            <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={(p) => updateParams({ page: String(p) }, false)} />
          </>
        )}
      </div>

      {modal.type === 'createGroup' && (
        <CreateGroupModal existingNames={groups.map((g) => g.name)} onClose={closeModal} onSuccess={handleModalSuccess} />
      )}
      {modal.type === 'editGroup' && <EditGroupModal group={modal.group} onClose={closeModal} onSuccess={handleModalSuccess} />}
      {modal.type === 'copyGroup' && <CopyGroupModal group={modal.group} onClose={closeModal} onSuccess={handleModalSuccess} />}
      {modal.type === 'deleteGroup' && (
        <DeleteGroupConfirmDialog
          group={modal.group}
          onClose={closeModal}
          onSuccess={handleModalSuccess}
          onViewChatbots={(gid) => updateParams({ groupId: gid })}
        />
      )}
      {modal.type === 'createChatbot' && <CreateChatbotModal groups={groups} defaultGroupId={groupId} onClose={closeModal} />}
      {modal.type === 'copyChatbot' && (
        <CopyChatbotModal chatbot={modal.chatbot} groups={groups} onClose={closeModal} onSuccess={handleModalSuccess} />
      )}
      {modal.type === 'moveGroup' && (
        <MoveGroupModal chatbot={modal.chatbot} groups={groups} onClose={closeModal} onSuccess={handleModalSuccess} />
      )}
      {modal.type === 'archiveChatbot' && (
        <ArchiveConfirmDialog chatbot={modal.chatbot} onClose={closeModal} onSuccess={handleModalSuccess} />
      )}
      {modal.type === 'permanentDelete' && (
        <PermanentDeleteModal chatbot={modal.chatbot} onClose={closeModal} onSuccess={handleModalSuccess} />
      )}
    </div>
  );
}
