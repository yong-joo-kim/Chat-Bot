import { useCallback, useEffect, useState } from 'react';
import { Link, Outlet, useOutletContext, useParams } from 'react-router-dom';
import type { Chatbot, ChatbotGroupWithCount } from '@chat-bot/shared-types';
import { chatbotsApi } from '../api/chatbots';
import { groupsApi } from '../api/groups';
import { ApiError } from '../api/client';
import { ConfirmDialog } from '../components/Modal';
import { useToast } from '../components/Toast';
import { MESSAGES } from '../constants/messages';
import { useUnsavedGuard } from '../context/UnsavedGuardContext';
import { ChatbotDetailHeader } from './chatbot-detail/ChatbotDetailHeader';
import { StatusTransitionControls } from './chatbot-detail/StatusTransitionControls';
import { TabNav } from './chatbot-detail/TabNav';

export interface ChatbotDetailContext {
  chatbot: Chatbot;
  reload: () => Promise<void>;
  /** AC-3-8: 저장하지 않은 변경 사항이 있을 때 탭 이동을 가로채기 위해 하위 탭이 등록하는 가드. */
  setUnsavedGuard: (guard: (() => boolean) | null) => void;
}

export function useChatbotDetailContext(): ChatbotDetailContext {
  return useOutletContext<ChatbotDetailContext>();
}

/** S2~S4가 공유하는 헤더/탭바(ui-spec §3.2). `/chatbots/:chatbotId`(탭 없음)는 `App.tsx`에서 `/dashboard`로 리다이렉트된다. */
export function ChatbotDetailLayout(): JSX.Element {
  const { chatbotId } = useParams<{ chatbotId: string }>();
  const { showToast } = useToast();
  const [chatbot, setChatbot] = useState<Chatbot | null>(null);
  const [groups, setGroups] = useState<ChatbotGroupWithCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [archiveDialogOpen, setArchiveDialogOpen] = useState(false);
  // AC-3-8: TopBar의 "챗봇 목록" 링크도 동일한 가드를 타도록 전역 컨텍스트의 가드를 그대로 사용한다.
  const { setGuard: setUnsavedGuard, confirmNavigation } = useUnsavedGuard();

  const load = useCallback(async () => {
    if (!chatbotId) return;
    setLoading(true);
    setNotFound(false);
    try {
      const [chatbotData, groupList] = await Promise.all([chatbotsApi.findOne(chatbotId), groupsApi.list()]);
      setChatbot(chatbotData);
      setGroups(groupList.items);
    } catch (e) {
      setNotFound(true);
      if (!(e instanceof ApiError && e.status === 404)) {
        showToast(e instanceof ApiError ? e.message : MESSAGES.errors.generic);
      }
    } finally {
      setLoading(false);
    }
  }, [chatbotId, showToast]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleStatusChange(nextStatus: Chatbot['status']): Promise<void> {
    if (!chatbot) return;
    try {
      const updated = await chatbotsApi.updateStatus(chatbot.id, { status: nextStatus });
      setChatbot(updated);
      showToast(MESSAGES.detail.statusChangeSuccess);
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : MESSAGES.errors.generic);
    }
  }

  async function handleArchiveConfirm(): Promise<void> {
    if (!chatbot) return;
    try {
      await chatbotsApi.archive(chatbot.id);
      setArchiveDialogOpen(false);
      await load();
      showToast(MESSAGES.chatbot.archiveSuccess);
    } catch (e) {
      setArchiveDialogOpen(false);
      showToast(e instanceof ApiError ? e.message : MESSAGES.errors.generic);
    }
  }

  if (loading) {
    return (
      <p role="status" aria-live="polite">
        {MESSAGES.common.loading}
      </p>
    );
  }

  if (notFound || !chatbot) {
    return (
      <div className="error-state" role="alert">
        <p className="error-state-title">
          <span aria-hidden="true">⚠</span> {MESSAGES.detail.notFound}
        </p>
        <Link to="/chatbots" className="btn btn-secondary">
          {MESSAGES.common.backToList}
        </Link>
      </div>
    );
  }

  const groupName = groups.find((g) => g.id === chatbot.groupId)?.name;

  return (
    <div className="chatbot-detail-shell">
      <ChatbotDetailHeader chatbot={chatbot} groupName={groupName} onBeforeNavigate={confirmNavigation} />
      <StatusTransitionControls
        status={chatbot.status}
        onActivate={() => handleStatusChange('ACTIVE')}
        onArchiveRequest={() => setArchiveDialogOpen(true)}
        onRestore={() => handleStatusChange('DRAFT')}
      />
      <TabNav chatbotId={chatbot.id} onBeforeNavigate={confirmNavigation} />
      <div className="tab-content">
        <Outlet context={{ chatbot, reload: load, setUnsavedGuard } satisfies ChatbotDetailContext} />
      </div>

      <ConfirmDialog
        isOpen={archiveDialogOpen}
        title={MESSAGES.chatbot.archiveTitle}
        description={MESSAGES.chatbot.archiveDesc}
        confirmLabel={MESSAGES.chatbot.actionArchive}
        onConfirm={handleArchiveConfirm}
        onCancel={() => setArchiveDialogOpen(false)}
        danger
      />
    </div>
  );
}
