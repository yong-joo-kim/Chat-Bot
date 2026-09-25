import { useCallback, useEffect, useState } from 'react';
import { Link, Outlet, useOutletContext, useParams } from 'react-router-dom';
import type { Chatbot, ChatbotGroupWithCount, UnansweredQuestionSummary } from '@chat-bot/shared-types';
import { chatbotsApi } from '../api/chatbots';
import { groupsApi } from '../api/groups';
import { learningApi } from '../api/learning';
import { ApiError } from '../api/client';
import { ConfirmDialog } from '../components/Modal';
import { useToast } from '../components/Toast';
import { useAuth } from '../context/AuthContext';
import { MESSAGES } from '../constants/messages';
import { useUnsavedGuard } from '../context/UnsavedGuardContext';
import { useDeployScheduleMeta } from '../lib/useDeployScheduleMeta';
import { useLatestRequest } from '../lib/useLatestRequest';
import { ChatbotDetailHeader } from './chatbot-detail/ChatbotDetailHeader';
import { StatusTransitionControls } from './chatbot-detail/StatusTransitionControls';
import { TabNav } from './chatbot-detail/TabNav';
import { ScheduleDeployDialog } from './chatbot-detail/deploy-schedules/ScheduleDeployDialog';

export interface ChatbotDetailContext {
  chatbot: Chatbot;
  reload: () => Promise<void>;
  /** AC-3-8: 저장하지 않은 변경 사항이 있을 때 탭 이동을 가로채기 위해 하위 탭이 등록하는 가드. */
  setUnsavedGuard: (guard: (() => boolean) | null) => void;
  /**
   * [No.44 R2] 학습현황 요약 — 예전에는 `TabNav`(탭 배지)와 `StatsShell`(서브내비 배지)이 각자
   * `learningApi.summary()`를 호출해 통계 탭 진입 시 요청이 2번 나갔고, 두 상태가 분리돼 있어
   * `LearningQueuePage`에서 반영/무시/되돌리기·일괄처리를 해도 `TabNav` "통계" 배지만 옛 값으로
   * 남는 결함이 있었다. 이제 이 레이아웃(TabNav·Outlet의 공통 부모)이 챗봇 상세 마운트당 1회만
   * 조회해 하위 전체(TabNav/StatsShell/LearningQueuePage)가 같은 상태를 공유한다.
   */
  learningSummary: UnansweredQuestionSummary | null;
  /** 반영/무시/되돌리기/일괄처리 등 변경 액션 뒤 최신값을 다시 받아오기 위해 하위 화면이 호출한다. */
  refreshLearningSummary: () => void;
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
  const { can } = useAuth();
  // No.28 E2 — "공개 예약..."(`scheduled-deploy-ui-spec.md` §4.5.2). 실제 코드에서
  // `StatusTransitionControls`는 `SettingsTab`이 아니라 이 레이아웃(모든 탭 공통 헤더)에 있다
  // (화면설계서가 전제한 위치와 다름 — 완료 보고에 기재).
  const [publishScheduleOpen, setPublishScheduleOpen] = useState(false);
  const deployMeta = useDeployScheduleMeta();
  const canSchedulePublish = chatbot?.status === 'DRAFT' && can('chatbot:write');

  // [No.44 R2] 학습현황 요약 — 챗봇 상세 마운트당 1회 조회, chatbotId 변경 시 재조회. `dialogue:read`가
  // 없으면 호출 자체를 하지 않는다(보조 정보라 실패는 조용히 무시). `useLatestRequest`로 요청 경합을 막는다
  // (반영/무시/되돌리기 등에서 `refreshLearningSummary`를 연달아 호출해도 늦게 도착한 응답이 최신 상태를
  // 덮어쓰지 않는다).
  const [learningSummary, setLearningSummary] = useState<UnansweredQuestionSummary | null>(null);
  const canReadDialogue = can('dialogue:read');
  const learningSummaryGuard = useLatestRequest();

  const refreshLearningSummary = useCallback(() => {
    if (!chatbotId || !canReadDialogue) {
      setLearningSummary(null);
      return;
    }
    const reqId = learningSummaryGuard.next();
    learningApi
      .summary(chatbotId)
      .then((res) => {
        if (learningSummaryGuard.isStale(reqId)) return;
        setLearningSummary(res);
      })
      .catch(() => {
        // 배지는 보조 정보다 — 실패해도 화면 전체를 막지 않는다.
      });
  }, [chatbotId, canReadDialogue, learningSummaryGuard]);

  // [test-automation No.44 자동시험 - 결함 수정] chatbotId가 바뀌는 순간(같은 레이아웃 컴포넌트가
  // 다른 챗봇 상세로 재사용될 때) 새 요약 응답이 오기 전까지 직전 챗봇의 학습현황 배지 값이 화면에
  // 그대로 남아 있었다(TabNav·StatsSubNav가 부모의 learningSummary를 그대로 그릴 뿐 옛 챗봇 것인지
  // 구분하지 않는다). chatbotId 변경 시 즉시 null로 비우고, 아래 refreshLearningSummary 이펙트가
  // 새 값을 채운다.
  useEffect(() => {
    setLearningSummary(null);
  }, [chatbotId]);

  useEffect(() => {
    refreshLearningSummary();
  }, [refreshLearningSummary]);

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
      {canSchedulePublish && (
        <div className="publish-schedule-row">
          <button type="button" className="btn btn-outline" onClick={() => setPublishScheduleOpen(true)}>
            {MESSAGES.deploySchedules.entry.publishScheduleButton}
          </button>
        </div>
      )}
      {deployMeta && (
        <ScheduleDeployDialog
          chatbotId={chatbot.id}
          isOpen={publishScheduleOpen}
          onClose={() => setPublishScheduleOpen(false)}
          onCreated={(label) => {
            setPublishScheduleOpen(false);
            showToast(MESSAGES.deploySchedules.dialog.createSuccess(label));
          }}
          timezone={deployMeta.timezone}
          chatbotStatus={chatbot.status}
          initialAction="PUBLISH"
        />
      )}
      <TabNav chatbotId={chatbot.id} learningSummary={learningSummary} onBeforeNavigate={confirmNavigation} />
      <div className="tab-content">
        <Outlet
          context={
            { chatbot, reload: load, setUnsavedGuard, learningSummary, refreshLearningSummary } satisfies ChatbotDetailContext
          }
        />
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
