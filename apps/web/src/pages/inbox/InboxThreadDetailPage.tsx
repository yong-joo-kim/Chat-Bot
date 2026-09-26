import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type {
  CustomerLinkSource,
  CustomerSearchItem,
  InboxAssigneeItem,
  InboxTagItem,
  InboxThreadDetail,
  InboxThreadStatus,
  TimelineEntryUnit,
} from '@chat-bot/shared-types';
import { inboxApi } from '../../api/inbox';
import { ApiError } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../components/Toast';
import { useLatestRequest } from '../../lib/useLatestRequest';
import { SkeletonRow, SkeletonCard } from '../../components/Skeleton';
import { ErrorState } from '../../components/ErrorState';
import { Modal, ConfirmDialog } from '../../components/Modal';
import { InlineFieldError } from '../../components/InlineFieldError';
import { MESSAGES } from '../../constants/messages';
import { CustomerCardPanel } from '../../components/inbox/CustomerCardPanel';
import { InboxThreadStatusBadge, CustomerKindBadge } from '../../components/inbox/badges';
import { InboxTimeline } from '../../components/inbox/InboxTimeline';
import { ThreadActionPanel, type LinkedConversationRow } from '../../components/inbox/ThreadActionPanel';
import { NoteForm } from '../../components/inbox/NoteForm';
import { ManualRecordForm } from '../../components/inbox/ManualRecordForm';
import { SessionLinkForm } from '../../components/inbox/SessionLinkForm';
import { CustomerSearchModal } from '../../components/inbox/CustomerSearchModal';
import { MergeConfirmDialog } from '../../components/inbox/MergeConfirmDialog';
import { SimulationChatPanel } from '../../components/inbox/SimulationChatPanel';

const POLL_INTERVAL_MS = 10000;

function linkedConversationsFrom(detail: InboxThreadDetail): LinkedConversationRow[] {
  return detail.timeline.units
    .filter((u): u is Extract<typeof u, { kind: 'CONVERSATION' }> => u.kind === 'CONVERSATION')
    .map((u) => ({
      linkId: u.linkId,
      chatbotName: u.chatbot.name,
      channelLabel: u.channel.label,
      source: u.linkSource,
      sessionRef: u.sessionRef,
    }));
}

/** OI-2 — 고객 스레드 상세(`omnichannel-inbox-ui-spec.md` §3.2 `/inbox/:threadId`). */
export function InboxThreadDetailPage(): JSX.Element {
  const { threadId } = useParams<{ threadId: string }>();
  const navigate = useNavigate();
  const { user, can } = useAuth();
  const { showToast } = useToast();
  const msg = MESSAGES.inbox;
  const guard = useLatestRequest();

  const [detail, setDetail] = useState<InboxThreadDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  // [코드 리뷰 R1 M-4] 가져가기 경합은 별도 문구(`claimConflictBanner`)를 쓴다 — 그 밖의 쓰기 경합은
  // 공용 문구(`conflictBanner`)를 쓴다. 문구 자체를 상태로 들고 있어 배너 렌더는 한 곳뿐이다.
  const [conflictBannerText, setConflictBannerText] = useState<string | null>(null);
  const [assignees, setAssignees] = useState<InboxAssigneeItem[]>([]);
  const [allTags, setAllTags] = useState<InboxTagItem[]>([]);
  const [identitySpaces, setIdentitySpaces] = useState<string[]>([]);
  // OI-2 시뮬레이션·"다른 대화 연결"의 챗봇 셀렉트는 참여 챗봇 전체가 대상이다(설계서 §3.5·§3.7).
  // `InboxThreadDetail`에는 이 목록이 없어(§20 인계에 없는 계약 공백) 목록 API의 메타를 재사용한다.
  const [participatingChatbots, setParticipatingChatbots] = useState<Array<{ id: string; name: string }>>([]);

  const [noteFormOpen, setNoteFormOpen] = useState(false);
  const [recordFormOpen, setRecordFormOpen] = useState(false);
  const [sessionLinkOpen, setSessionLinkOpen] = useState(false);
  const [sessionLinkError, setSessionLinkError] = useState<string | undefined>();
  const [sessionLinkSaving, setSessionLinkSaving] = useState(false);
  const [mergeSearchOpen, setMergeSearchOpen] = useState(false);
  const [mergeTarget, setMergeTarget] = useState<CustomerSearchItem | null>(null);
  const [mergeSaving, setMergeSaving] = useState(false);
  const [mergeError, setMergeError] = useState<string | undefined>();
  const [forceUnlink, setForceUnlink] = useState<{ linkId: string } | null>(null);
  const [forceUnlinkSaving, setForceUnlinkSaving] = useState(false);
  const [forceUnlinkError, setForceUnlinkError] = useState<string | undefined>();
  const [deleteTestCustomerOpen, setDeleteTestCustomerOpen] = useState(false);
  const [tagError, setTagError] = useState<string | undefined>();
  const [revertConfirm, setRevertConfirm] = useState<{ mergeId: string } | null>(null);
  const [revertSaving, setRevertSaving] = useState(false);
  const [revertError, setRevertError] = useState<string | undefined>();

  const cancelledRef = useRef(false);

  const load = useCallback(
    async (opts: { silent?: boolean } = {}) => {
      if (!threadId) return;
      const reqId = guard.next();
      try {
        const res = await inboxApi.threadDetail(threadId);
        if (guard.isStale(reqId) || cancelledRef.current) return;
        setDetail(res);
        setNotFound(false);
      } catch (e) {
        if (guard.isStale(reqId) || cancelledRef.current) return;
        if (e instanceof ApiError && e.status === 404) setNotFound(true);
      } finally {
        if (!guard.isStale(reqId)) setLoading(false);
      }
      void opts;
    },
    [threadId, guard],
  );

  useEffect(() => {
    cancelledRef.current = false;
    setLoading(true);
    setDetail(null);
    setNotFound(false);
    void load();
    return () => {
      cancelledRef.current = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load({ silent: true });
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  useEffect(() => {
    inboxApi
      .assignees()
      .then(setAssignees)
      .catch(() => undefined);
    inboxApi.tags
      .list()
      .then(setAllTags)
      .catch(() => undefined);
    inboxApi
      .identitySpaces()
      .then((res) => setIdentitySpaces(res.map((s) => s.ref)))
      .catch(() => undefined);
    inboxApi
      .threads({ pageSize: 1 })
      .then((res) => setParticipatingChatbots(res.participatingChatbots))
      .catch(() => undefined);
  }, []);

  function showConflictBanner(text: string): void {
    setConflictBannerText(text);
    window.setTimeout(() => setConflictBannerText(null), 2000);
    void load();
  }

  async function withConflictHandling(action: () => Promise<void>): Promise<void> {
    try {
      await action();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'INBOX_THREAD_CONFLICT') {
        showConflictBanner(msg.conflictBanner);
        return;
      }
      throw e;
    }
  }

  async function handleStatusChange(status: InboxThreadStatus, snoozeUntil?: string): Promise<void> {
    if (!detail) return;
    await withConflictHandling(async () => {
      const updated = await inboxApi.updateState(detail.thread.threadId, {
        status,
        snoozeUntil: snoozeUntil ? new Date(snoozeUntil) : undefined,
        version: detail.thread.version,
      });
      setDetail((prev) => (prev ? { ...prev, thread: updated } : prev));
    });
  }

  async function handleClaim(): Promise<void> {
    if (!detail) return;
    try {
      const updated = await inboxApi.claim(detail.thread.threadId, detail.thread.version);
      setDetail((prev) => (prev ? { ...prev, thread: updated } : prev));
    } catch (e) {
      if (e instanceof ApiError && e.code === 'INBOX_THREAD_CONFLICT') {
        showConflictBanner(msg.claimConflictBanner);
        return;
      }
      throw e;
    }
  }

  async function handleAssign(userId: string): Promise<void> {
    if (!detail) return;
    await withConflictHandling(async () => {
      const updated = await inboxApi.assign(detail.thread.threadId, { userId, version: detail.thread.version });
      setDetail((prev) => (prev ? { ...prev, thread: updated } : prev));
    });
  }

  async function handleRelease(): Promise<void> {
    if (!detail) return;
    await withConflictHandling(async () => {
      const updated = await inboxApi.release(detail.thread.threadId, { version: detail.thread.version });
      setDetail((prev) => (prev ? { ...prev, thread: updated } : prev));
    });
  }

  async function handleSetTags(tagIds: string[]): Promise<void> {
    if (!detail) return;
    setTagError(undefined);
    try {
      await withConflictHandling(async () => {
        const updated = await inboxApi.setTags(detail.thread.threadId, { tagIds, version: detail.thread.version });
        setDetail((prev) => (prev ? { ...prev, thread: updated } : prev));
      });
    } catch (e) {
      if (e instanceof ApiError && e.code === 'LIMIT_EXCEEDED') setTagError(msg.tagLimitError);
      else throw e;
    }
  }

  async function handleMaskPreview(text: string): Promise<string> {
    const res = await inboxApi.maskPreview(text);
    return res.masked;
  }

  async function handleCreateNote(text: string): Promise<void> {
    if (!detail) return;
    await inboxApi.createNote(detail.thread.threadId, { text });
    setNoteFormOpen(false);
    void load();
  }

  async function handleCreateRecord(dto: Parameters<typeof inboxApi.createRecord>[1]): Promise<void> {
    if (!detail) return;
    await inboxApi.createRecord(detail.thread.threadId, dto);
    setRecordFormOpen(false);
    void load();
  }

  async function handleSessionLinkSubmit(chatbotId: string, sessionRef: string): Promise<void> {
    if (!detail) return;
    setSessionLinkSaving(true);
    setSessionLinkError(undefined);
    try {
      await inboxApi.linkSession(detail.thread.customer.id, { chatbotId, sessionRef });
      setSessionLinkOpen(false);
      void load();
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) setSessionLinkError(msg.sessionRefNotFoundError);
      else if (e instanceof ApiError && e.code === 'CUSTOMER_LINK_LOCKED') setSessionLinkError(msg.linkLockedError);
      else setSessionLinkError(e instanceof ApiError ? e.message : MESSAGES.errors.generic);
    } finally {
      setSessionLinkSaving(false);
    }
  }

  function handlePickMergeTarget(item: CustomerSearchItem): void {
    setMergeTarget(item);
    setMergeSearchOpen(false);
    setMergeError(undefined);
  }

  async function handleMergeConfirm(): Promise<void> {
    if (!detail || !mergeTarget) return;
    setMergeSaving(true);
    setMergeError(undefined);
    try {
      const result = await inboxApi.merge(detail.thread.customer.id, { targetCustomerId: mergeTarget.customerId });
      if (result.targetThreadId) navigate(`/inbox/${result.targetThreadId}`);
      else navigate('/inbox');
    } catch (e) {
      if (e instanceof ApiError && e.code === 'CUSTOMER_MERGE_FORBIDDEN') {
        setMergeError(
          mergeTarget.kind === 'IDENTIFIED' ? msg.mergeForbiddenIdentity : mergeTarget.kind === 'TEST' ? msg.mergeForbiddenTest : msg.mergeForbiddenPurged,
        );
      } else {
        setMergeError(e instanceof ApiError ? e.message : MESSAGES.errors.generic);
      }
    } finally {
      setMergeSaving(false);
    }
  }

  async function handleUnlink(linkId: string, source: CustomerLinkSource): Promise<void> {
    if (!detail) return;
    if (source === 'IDENTITY') {
      setForceUnlinkError(undefined);
      setForceUnlink({ linkId });
      return;
    }
    try {
      await inboxApi.unlink(detail.thread.customer.id, linkId);
      void load();
    } catch (e) {
      // [코드 리뷰 R1 M-3(Low)] 비-IDENTITY 분리 실패도 조용히 삼키지 않고 토스트로 알린다.
      showToast(e instanceof ApiError ? e.message : MESSAGES.errors.generic);
    }
  }

  async function handleForceUnlinkConfirm(): Promise<void> {
    if (!detail || !forceUnlink) return;
    setForceUnlinkSaving(true);
    setForceUnlinkError(undefined);
    try {
      await inboxApi.unlink(detail.thread.customer.id, forceUnlink.linkId);
      setForceUnlink(null);
      void load();
    } catch (e) {
      // [코드 리뷰 R1 M-3] 실패 시 모달을 닫지 않고 안 인라인 오류로 보여준다.
      setForceUnlinkError(e instanceof ApiError ? e.message : MESSAGES.errors.generic);
    } finally {
      setForceUnlinkSaving(false);
    }
  }

  async function handleRevertMergeConfirm(): Promise<void> {
    if (!revertConfirm) return;
    setRevertSaving(true);
    setRevertError(undefined);
    try {
      await inboxApi.revertMerge(revertConfirm.mergeId);
      setRevertConfirm(null);
      void load();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'CUSTOMER_MERGE_NOT_REVERTIBLE') setRevertError(msg.revertNotRevertibleError);
      else if (e instanceof ApiError && e.status === 403) setRevertError(e.message || msg.revertDisabledReasonAdminOnly);
      else setRevertError(e instanceof ApiError ? e.message : MESSAGES.errors.generic);
    } finally {
      setRevertSaving(false);
    }
  }

  async function handleDeleteTestCustomer(): Promise<void> {
    if (!detail) return;
    await inboxApi.removeTestCustomer(detail.thread.customer.id);
    navigate('/inbox');
  }

  if (!threadId) return <ErrorState title={MESSAGES.errors.generic} />;
  if (notFound) {
    return (
      <ErrorState title={msg.notFoundError} onRetry={() => void load()} />
    );
  }
  if (loading || !detail) {
    return (
      <>
        <SkeletonRow />
        <SkeletonCard />
        <SkeletonRow />
        <SkeletonRow />
        <SkeletonRow />
      </>
    );
  }

  const { thread, card } = detail;
  const isAdmin = user?.role === 'ADMIN';
  const isMine = thread.assignee?.id === user?.id;
  const canWrite = can('cs:write');
  // [코드 리뷰 R1 M-1] OI-7 시뮬레이션은 `simulation:write`가 있어야 한다(AGENT는 없음, ui-spec §5
  // 권한표). 시험 고객 생성·삭제·시뮬레이션 실행 엔드포인트도 전부 같은 권한이다(cs:write와 무관).
  const canSimulate = can('simulation:write');
  const isTestCustomer = thread.customer.kind === 'TEST';
  const linkedConversations = linkedConversationsFrom(detail);
  const mergeRevertHours = detail.mergeRevertHours;

  // [코드 리뷰 R1 M-2 계약 보강] SYSTEM 항목 meta에 `mergedByUserId`·`mergedAt`·`mergeKind`가 실린다
  // (`inbox.store.ts` 733행) — 이제 클라이언트에서 선제 판정할 수 있다(§3.6b). ADMIN은 항상 허용,
  // 로그인 승격(PROMOTED)은 ADMIN 전용, 일반 병합(MANUAL)은 `cs:write` + 본인 수행 + `mergeRevertHours`
  // 이내일 때만 허용한다. 메타 필드가 없는 옛 항목은 현행 동작(허용)을 유지한다.
  function canRevert(unit: TimelineEntryUnit): { allowed: boolean; reason?: string } {
    if (isAdmin) return { allowed: true };
    const isPromotion = unit.system?.event === 'PROMOTED';
    if (isPromotion) return { allowed: false, reason: msg.revertDisabledReasonAdminOnly };

    const data = unit.system?.data;
    const mergedByUserId = data?.mergedByUserId;
    const mergedAt = data?.mergedAt;
    const mergeKind = data?.mergeKind;
    if (mergedByUserId === undefined || mergedAt === undefined || mergeKind === undefined) {
      // 옛 항목(계약 보강 이전에 생성된 SYSTEM 항목) — 서버 응답으로 판정을 넘긴다.
      return { allowed: true };
    }

    const isActor = canWrite && typeof mergedByUserId === 'string' && mergedByUserId === user?.id;
    if (!isActor) return { allowed: false, reason: msg.revertDisabledReasonNotActor };

    const mergedAtMs = new Date(String(mergedAt)).getTime();
    // 서버(inbox-customers.service.ts revertMerge)와 같은 경계(`<=`)로 판정한다.
    const withinWindow = Date.now() - mergedAtMs <= mergeRevertHours * 3600_000;
    if (!withinWindow) return { allowed: false, reason: msg.revertDisabledReasonExpired(mergeRevertHours) };

    return { allowed: true };
  }

  return (
    <div className="inbox-thread-detail-page">
      <p>
        <Link to="/inbox">{msg.backToInbox}</Link>
      </p>
      <h2>
        {msg.breadcrumb(thread.customer.displayName ?? thread.customer.alias)} <CustomerKindBadge kind={thread.customer.kind} />{' '}
        <InboxThreadStatusBadge status={thread.status} snoozeUntil={thread.snoozeUntil} snoozeExpired={thread.snoozeExpired} />
      </h2>

      {detail.activeHandoffs.length > 0 && <p className="field-hint">{msg.activeHandoffBanner(detail.activeHandoffs.length)}</p>}
      {thread.noParticipatingChatbot && <p className="field-hint">{msg.noParticipatingChatbotThread}</p>}
      {conflictBannerText && (
        <p className="form-banner form-banner--info" role="status">
          {conflictBannerText}
        </p>
      )}

      <div className="inbox-thread-detail-layout">
        <div className="inbox-thread-detail-left">
          <CustomerCardPanel card={card} />

          {isTestCustomer ? (
            canSimulate ? (
              <>
                <SimulationChatPanel customerId={thread.customer.id} participatingChatbots={participatingChatbots} onEntryAdded={() => void load()} />
                <button type="button" className="btn btn-danger" onClick={() => setDeleteTestCustomerOpen(true)}>
                  {msg.deleteTestCustomerButton}
                </button>
              </>
            ) : (
              <p className="field-hint">{msg.simulationPermissionMissing}</p>
            )
          ) : null}

          <ThreadActionPanel
            detail={detail}
            assignees={assignees}
            allTags={allTags}
            isAdmin={Boolean(isAdmin)}
            isMine={isMine}
            canWrite={canWrite}
            canManageTags={isAdmin}
            linkedConversations={linkedConversations}
            onStatusChange={(s, snooze) => void handleStatusChange(s, snooze)}
            onClaim={() => void handleClaim()}
            onAssign={(userId) => void handleAssign(userId)}
            onRelease={() => void handleRelease()}
            onSetTags={(ids) => void handleSetTags(ids)}
            onOpenNote={() => setNoteFormOpen(true)}
            onOpenRecord={() => setRecordFormOpen(true)}
            onOpenLinkForm={() => setSessionLinkOpen(true)}
            onOpenMerge={() => setMergeSearchOpen(true)}
            onUnlink={(linkId, source) => void handleUnlink(linkId, source)}
            snoozeError={undefined}
          />
          <InlineFieldError id="thread-tag-error" message={tagError} />
        </div>

        <div className="inbox-thread-detail-right">
          <InboxTimeline
            units={detail.timeline.units}
            nextCursor={detail.timeline.nextCursor}
            loadingMore={false}
            onLoadMore={() => void load()}
            canRevert={canRevert}
            onRevertMerge={(mergeId) => {
              setRevertError(undefined);
              setRevertConfirm({ mergeId });
            }}
          />
        </div>
      </div>

      <Modal isOpen={noteFormOpen} title={msg.noteFormTitle} onClose={() => setNoteFormOpen(false)}>
        <NoteForm saving={false} onSave={(text) => void handleCreateNote(text)} onCancel={() => setNoteFormOpen(false)} onPreview={handleMaskPreview} />
      </Modal>

      <Modal isOpen={recordFormOpen} title={msg.recordFormTitle} onClose={() => setRecordFormOpen(false)}>
        <ManualRecordForm saving={false} onSave={(dto) => void handleCreateRecord(dto)} onCancel={() => setRecordFormOpen(false)} onPreview={handleMaskPreview} />
      </Modal>

      <Modal isOpen={sessionLinkOpen} title={msg.linkOtherConversationButton} onClose={() => setSessionLinkOpen(false)}>
        <SessionLinkForm
          participatingChatbots={participatingChatbots}
          saving={sessionLinkSaving}
          error={sessionLinkError}
          onSubmit={(chatbotId, sessionRef) => void handleSessionLinkSubmit(chatbotId, sessionRef)}
          onCancel={() => setSessionLinkOpen(false)}
        />
      </Modal>

      <CustomerSearchModal isOpen={mergeSearchOpen} mode="merge" identitySpaces={identitySpaces} onClose={() => setMergeSearchOpen(false)} onPick={handlePickMergeTarget} />

      <MergeConfirmDialog
        isOpen={mergeTarget !== null}
        sourceLabel={thread.customer.displayName ?? thread.customer.alias}
        targetLabel={mergeTarget ? (mergeTarget.displayName ?? mergeTarget.alias) : ''}
        saving={mergeSaving}
        error={mergeError}
        onConfirm={() => void handleMergeConfirm()}
        onCancel={() => setMergeTarget(null)}
      />

      <ConfirmDialog
        isOpen={revertConfirm !== null}
        title={msg.revertConfirmTitle}
        description={msg.revertConfirmDesc}
        confirmLabel={revertSaving ? MESSAGES.common.saving : msg.revertButton}
        confirmDisabled={revertSaving}
        onConfirm={() => void handleRevertMergeConfirm()}
        onCancel={() => setRevertConfirm(null)}
      >
        <InlineFieldError id="revert-merge-error" message={revertError} />
      </ConfirmDialog>

      <ConfirmDialog
        isOpen={forceUnlink !== null}
        title={msg.unlinkIdentityConfirmTitle}
        description={msg.unlinkIdentityConfirmDesc}
        confirmLabel={forceUnlinkSaving ? MESSAGES.common.saving : msg.forceUnlinkConfirmButton}
        confirmDisabled={forceUnlinkSaving}
        danger
        onConfirm={() => void handleForceUnlinkConfirm()}
        onCancel={() => {
          setForceUnlink(null);
          setForceUnlinkError(undefined);
        }}
      >
        <InlineFieldError id="force-unlink-error" message={forceUnlinkError} />
      </ConfirmDialog>

      <ConfirmDialog
        isOpen={deleteTestCustomerOpen}
        title={msg.deleteTestCustomerButton}
        description={msg.deleteTestCustomerConfirmDesc}
        confirmLabel={msg.deleteTestCustomerButton}
        danger
        onConfirm={() => void handleDeleteTestCustomer()}
        onCancel={() => setDeleteTestCustomerOpen(false)}
      />
    </div>
  );
}
