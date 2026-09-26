import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { HandoffBrief, InterveneHandoffResponse, LiveSessionRow, SendAgentMessageResponse } from '@chat-bot/shared-types';
import { handoffApi } from '../../api/handoff';
import { useAuth } from '../../context/AuthContext';
import { ErrorState } from '../../components/ErrorState';
import { SkeletonRow } from '../../components/Skeleton';
import { TranscriptPanel } from '../../components/handoff/TranscriptPanel';
import { HintPanel } from '../../components/handoff/HintPanel';
import { InterveneButton } from '../../components/handoff/InterveneButton';
import { HandoffActionBar } from '../../components/handoff/HandoffActionBar';
import { AgentMessageComposer } from '../../components/handoff/AgentMessageComposer';
import { SessionRefLabel } from '../../components/handoff/SessionRefLabel';
import { AlertLevelBadge, UnverifiedAttemptBadge } from '../../components/handoff/badges';
import { SessionLinkCard } from '../../components/inbox/SessionLinkCard';
import { MESSAGES } from '../../constants/messages';
import { useHandoffConsoleChatbotContext } from './HandoffConsoleChatbotShell';

const POLL_INTERVAL_MS = 5000;

/** HC2 — 대화 보기·개입(+응답힌트 패널)(hybrid-cs-ui-spec.md §3.3, `/handoff-console/:chatbotId/live/:sessionRef`). */
export function LiveSessionDetailPage(): JSX.Element {
  const { chatbotId } = useHandoffConsoleChatbotContext();
  const { sessionRef } = useParams<{ sessionRef: string }>();
  const { user, can } = useAuth();
  const msg = MESSAGES.handoffConsole;

  const [siblingItems, setSiblingItems] = useState<LiveSessionRow[]>([]);
  const [handoff, setHandoff] = useState<HandoffBrief | null>(null);
  const [lastUserKey, setLastUserKey] = useState<string | null>(null);
  const [composerText, setComposerText] = useState('');
  const [banner, setBanner] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  // M1(코드 리뷰 1회차): `HANDOFF_NOT_ASSIGNEE`를 받으면 이 값을 올려 `TranscriptPanel`을 강제로
  // 재마운트해 최신 상태(담당자·상태)를 즉시 재조회한다(다음 2초 폴링을 기다리지 않는다).
  const [refreshKey, setRefreshKey] = useState(0);
  // M3(코드 리뷰 1회차 §8.1): 모바일(<640px)에서는 목록·대화·힌트를 전체화면으로 교대 표시한다
  // (3단 동시 표시 안 함). 태블릿 이상에서는 CSS가 이 값을 무시하고 그리드로 함께 보여준다.
  const [mobileView, setMobileView] = useState<'master' | 'main' | 'hints'>('main');

  // 세션을 바꿔 들어오면(마스터 목록 클릭) 모바일 화면은 항상 대화 보기로 돌아온다.
  useEffect(() => {
    setMobileView('main');
  }, [sessionRef]);

  const loadSiblings = useCallback(async () => {
    try {
      const res = await handoffApi.liveSessions(chatbotId, {});
      setSiblingItems(res.items);
    } catch {
      // 좌측 목록 갱신 실패는 대화 보기 자체를 막지 않는다.
    }
  }, [chatbotId]);

  useEffect(() => {
    void loadSiblings();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void loadSiblings();
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [loadSiblings]);

  if (!sessionRef) return <ErrorState title={MESSAGES.errors.generic} />;
  if (notFound) return <ErrorState title={msg.notFoundBanner} />;

  const isAdmin = user?.role === 'ADMIN';
  // H1(코드 리뷰 1회차 반영): 서버가 계산한 `handoff.isMine`을 그대로 쓴다(이름 비교 제거).
  const isAssignee = Boolean(handoff?.isMine);
  const canFillComposer = Boolean(handoff?.status === 'CONNECTED' && isAssignee);
  const currentRow = siblingItems.find((i) => i.sessionRef === sessionRef);

  function handleInterveneSuccess(detail: InterveneHandoffResponse): void {
    setHandoff(detail);
    // M4(코드 리뷰 1회차): 관찰 창 밖 개입(EX-CS-3)이면 "다음 발화 때 연결" 안내를, 아니면 배너를 지운다.
    setBanner(detail.watchWindowMissed ? msg.interveneWatchWindowMissedBanner : null);
    void loadSiblings();
  }

  /** M1: 상담이 이미 종료됐다 — 화면 전체를 종료 후 상태로 전환한다(§3.3 필드-오류 매핑). */
  function handleNotActive(): void {
    setHandoff((prev) => (prev ? { ...prev, status: 'ENDED' } : prev));
    void loadSiblings();
  }

  /** M1: 담당자가 바뀌었다 — 배너로 알리고 `TranscriptPanel`을 재마운트해 즉시 재조회한다. */
  function handleNotAssignee(): void {
    setRefreshKey((k) => k + 1);
    void loadSiblings();
  }

  return (
    // M3(§8.1): `data-mobile-view`는 <640px에서만 CSS가 읽는다 — 태블릿 이상은 무시하고 그리드로 함께 보여준다.
    <div className="live-session-detail-page" data-mobile-view={mobileView}>
      <div className="live-session-detail-master">
        {siblingItems.map((row) => (
          <Link
            key={row.sessionRef}
            to={`/handoff-console/${chatbotId}/live/${row.sessionRef}`}
            className={row.sessionRef === sessionRef ? 'live-session-master-item--active' : 'live-session-master-item'}
          >
            <AlertLevelBadge level={row.alertLevel} consecutive={row.consecutiveUnanswered} /> <SessionRefLabel value={row.sessionRef} />
          </Link>
        ))}
      </div>

      <div className="live-session-detail-main">
        <div className="live-session-detail-mobile-nav">
          <button type="button" className="btn btn-secondary live-session-mobile-only" onClick={() => setMobileView('master')}>
            {msg.mobileBackToList}
          </button>
          <button type="button" className="btn btn-secondary live-session-mobile-only" onClick={() => setMobileView('hints')}>
            {msg.mobileShowHints}
          </button>
        </div>
        <h2>
          <SessionRefLabel value={sessionRef} /> {currentRow && <AlertLevelBadge level={currentRow.alertLevel} consecutive={currentRow.consecutiveUnanswered} />}
          {handoff && <UnverifiedAttemptBadge count={handoff.unverifiedAttemptCount} />}
        </h2>

        {/* [신규 No.42] OI-10 — <h2> 바로 아래, TranscriptPanel 위(omnichannel-inbox-ui-spec.md §3.10). */}
        <SessionLinkCard chatbotId={chatbotId} sessionRef={sessionRef} />

        {banner && (
          <p className="error-state-title" role="alert">
            <span aria-hidden="true">⚠</span> {banner}
          </p>
        )}

        <TranscriptPanel
          key={`${sessionRef}-${refreshKey}`}
          chatbotId={chatbotId}
          sessionRef={sessionRef}
          onHandoffChange={setHandoff}
          onLastUserKeyChange={setLastUserKey}
          onNotFound={() => setNotFound(true)}
        />

        {can('cs:write') && (!handoff || handoff.status === 'ENDED') && (
          <InterveneButton
            chatbotId={chatbotId}
            sessionRef={sessionRef}
            disabledReason={
              currentRow?.handoff && currentRow.handoff.status !== 'ENDED' && !currentRow.handoff.isMine
                ? msg.interveneDisabledReason(currentRow.handoff.assignedUserName)
                : undefined
            }
            onSuccess={handleInterveneSuccess}
            onConflict={(m) => {
              setBanner(m);
              void loadSiblings();
            }}
            onError={(m) => setBanner(m)}
          />
        )}

        {/*
          H2(코드 리뷰 1회차): `HandoffActionBar`(강제 인수 포함)는 상담이 `CONNECTED`이면 담당 여부와
          무관하게 렌더한다 — 비담당 AGENT에게는 버튼을 숨기지 않고 비활성 + 사유로 보여준다
          (NFR-CSA6). 전송(`AgentMessageComposer`)도 같은 원칙으로 항상 렌더하되 담당자·ADMIN이
          아니면 비활성화한다(종료는 `HandoffActionBar` 내부에서 같은 조건으로 비활성화).
        */}
        {can('cs:write') && handoff && handoff.status === 'CONNECTED' && (
          <>
            <AgentMessageComposer
              chatbotId={chatbotId}
              handoffId={handoff.id}
              value={composerText}
              onChange={setComposerText}
              disabled={!isAssignee && !isAdmin}
              disabledReason={!isAssignee && !isAdmin ? msg.composerDisabledNotAssignee : undefined}
              onSent={(res: SendAgentMessageResponse) => {
                void res;
              }}
              onNotActive={handleNotActive}
              onNotAssignee={handleNotAssignee}
            />
            <HandoffActionBar
              chatbotId={chatbotId}
              handoffId={handoff.id}
              isAssignee={isAssignee}
              isAdmin={Boolean(isAdmin)}
              // M-2(코드 리뷰 2회차 후속): `endButtonLabel`이 `HandoffBriefSchema`로 옮겨져 2초
              // 폴링(`TranscriptPanel`)의 `handoff`에도 항상 들어온다 — 개입/인수 응답에서
              // 기회적으로 저장해 두던 별도 state를 없애고 `handoff.endButtonLabel`을 그대로 쓴다.
              endButtonPreviewLabel={handoff.endButtonLabel}
              onEnded={(detail) => {
                setHandoff(detail);
                void loadSiblings();
              }}
              onTakenOver={(detail) => {
                setHandoff(detail);
                void loadSiblings();
              }}
              onError={(m) => setBanner(m)}
              onNotActive={handleNotActive}
              onNotAssignee={handleNotAssignee}
            />
          </>
        )}
      </div>

      <div className="live-session-detail-hints">
        <button
          type="button"
          className="btn btn-secondary live-session-mobile-only"
          onClick={() => setMobileView('main')}
        >
          {msg.mobileBackToConversation}
        </button>
        {can('cs:read') && (
          <HintPanel
            chatbotId={chatbotId}
            sessionRef={sessionRef}
            lastUserKey={lastUserKey}
            canFillComposer={canFillComposer}
            onFill={(text) => setComposerText((prev) => (prev ? `${prev} ${text}` : text))}
          />
        )}
      </div>
    </div>
  );
}
