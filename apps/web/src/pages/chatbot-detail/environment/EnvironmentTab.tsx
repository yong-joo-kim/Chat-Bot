import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { VersionCurrentStatus } from '@chat-bot/shared-types';
import { useChatbotDetailContext } from '../../ChatbotDetailLayout';
import { useAuth } from '../../../context/AuthContext';
import { useToast } from '../../../components/Toast';
import { SkeletonCard } from '../../../components/Skeleton';
import { ErrorState } from '../../../components/ErrorState';
import { ForbiddenState } from '../../../components/security/ForbiddenState';
import { ArchivedBanner } from '../ArchivedBanner';
import { MESSAGES } from '../../../constants/messages';
import { versionsApi } from '../../../api/versions';
import { EnvironmentOffPanel } from './EnvironmentOffPanel';
import { EnvironmentStatusPanel } from './EnvironmentStatusPanel';
import { EnvironmentEnableDialog } from './EnvironmentEnableDialog';
import { EnvironmentDisableDialog } from './EnvironmentDisableDialog';

/** EN1 환경 탭 본체(라우트 진입점, `environment-separation-ui-spec.md` §4.1~4.2). */
export function EnvironmentTab(): JSX.Element {
  const { chatbot, environmentStatus, refreshEnvironmentStatus } = useChatbotDetailContext();
  const { can } = useAuth();
  const { showToast } = useToast();
  const msg = MESSAGES.environment;
  // [신규 No.40 — §6·§4.6(c)] `ProdSwitchDialog`의 GATE_CONFIG_ERROR 링크가 `?openGate=1`로 들어오면
  // 게이트 설정 섹션을 펼친 채로 보여준다(쿼리 파라미터로 상태 전달).
  const [searchParams] = useSearchParams();
  const openGateOnLoad = searchParams.get('openGate') === '1';

  const isArchived = chatbot.status === 'ARCHIVED';
  const canDeploy = can('chatbot:deploy') && !isArchived;
  const canPromote = can('dialogue:write') && can('chatbot:write') && !isArchived;
  // [신규 No.40 — §6] EN1 조회는 `chatbot:read`+`dialogue:read`가 모두 필요하다(EnvironmentController 요구사항).
  // `dialogue:read`가 없으면 `ChatbotDetailLayout`이 애초에 상태를 조회하지 않아(§4.2 컨텍스트 확장 관행)
  // `environmentStatus`가 항상 null로 남는다 — 이를 "모드 꺼짐"으로 오인해 보여주지 않고 403 안내로 대체한다.
  const canReadDialogue = can('dialogue:read');

  const [current, setCurrent] = useState<VersionCurrentStatus | null>(null);
  const [currentLoadFailed, setCurrentLoadFailed] = useState(false);
  const [enableOpen, setEnableOpen] = useState(false);
  const [disableOpen, setDisableOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const loadCurrent = useCallback(async () => {
    try {
      const res = await versionsApi.current(chatbot.id);
      setCurrent(res);
      setCurrentLoadFailed(false);
    } catch {
      setCurrentLoadFailed(true);
    }
  }, [chatbot.id]);

  useEffect(() => {
    setLoading(true);
    setLoadError(false);
    Promise.all([
      loadCurrent(),
      new Promise<void>((resolve) => {
        refreshEnvironmentStatus();
        resolve();
      }),
    ])
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatbot.id]);

  function handleRefresh(): void {
    refreshEnvironmentStatus();
    void loadCurrent();
  }

  // [신규 No.40 — §6] `dialogue:read` 없이 EN1에 들어온 사용자(예: AGENT)는 어떤 상태 화면도 렌더하지
  // 않는다 — 조회 자체가 API에서 403이 나는 동작을 콘솔이 선제적으로 안내한다(이전엔 environmentStatus가
  // 항상 null이라 "모드 꺼짐" 화면으로 잘못 보였다).
  if (!canReadDialogue) {
    return <ForbiddenState menuName={msg.tabLabel} />;
  }

  return (
    <div className="environment-tab">
      <ArchivedBanner visible={isArchived} />
      {loading && !environmentStatus ? (
        <>
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </>
      ) : loadError && !environmentStatus ? (
        <ErrorState title={msg.off.loadFailed} onRetry={() => window.location.reload()} />
      ) : environmentStatus?.enabled ? (
        <EnvironmentStatusPanel
          chatbotId={chatbot.id}
          chatbotStatus={chatbot.status}
          status={environmentStatus}
          current={currentLoadFailed ? null : current}
          canDeploy={canDeploy}
          canPromote={canPromote}
          openGateOnLoad={openGateOnLoad}
          onDisableRequested={() => setDisableOpen(true)}
          onRefresh={handleRefresh}
        />
      ) : (
        <EnvironmentOffPanel canDeploy={canDeploy && !isArchived} onEnableClick={() => setEnableOpen(true)} />
      )}

      <EnvironmentEnableDialog
        chatbotId={chatbot.id}
        isOpen={enableOpen}
        onClose={() => setEnableOpen(false)}
        onEnabled={() => {
          setEnableOpen(false);
          showToast(msg.enableDialog.successToast);
          handleRefresh();
        }}
      />
      <EnvironmentDisableDialog
        chatbotId={chatbot.id}
        isOpen={disableOpen}
        onClose={() => setDisableOpen(false)}
        onDisabled={() => {
          setDisableOpen(false);
          showToast(msg.disableDialog.successToast);
          handleRefresh();
        }}
      />
    </div>
  );
}
