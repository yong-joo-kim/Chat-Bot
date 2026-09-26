import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { CustomerSearchItem } from '@chat-bot/shared-types';
import { inboxApi } from '../../api/inbox';
import { ApiError } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { MESSAGES } from '../../constants/messages';
import { CustomerKindBadge } from './badges';
import { CustomerSearchModal } from './CustomerSearchModal';

/**
 * OI-10 — 상담 콘솔(No.24) 고객 카드 연계(`omnichannel-inbox-ui-spec.md` §3.10 `SessionLinkCard`).
 * 폴링 대상이 아니다 — 세션 진입 시 1회 조회, "스레드 만들기" 성공 시에만 재조회한다.
 */
export function SessionLinkCard({ chatbotId, sessionRef }: { chatbotId: string; sessionRef: string }): JSX.Element | null {
  const { can } = useAuth();
  const msg = MESSAGES.inbox;
  const [linkOpen, setLinkOpen] = useState(false);
  const [identitySpaces, setIdentitySpaces] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);

  const [data, setData] = useState<Awaited<ReturnType<typeof inboxApi.sessionLink>> | null>(null);

  function load(): void {
    inboxApi
      .sessionLink(chatbotId, sessionRef)
      .then(setData)
      .catch((e) => {
        // [신규 No.42] 기능 꺼짐(404)이면 영역 자체를 숨긴다 — participating:false와 같은 효과.
        if (e instanceof ApiError && e.status === 404) setData({ participating: false });
      });
  }

  useEffect(() => {
    setData(null);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatbotId, sessionRef]);

  // 회원 번호 검색 탭에 필요한 식별 공간 목록 — 연결 모달을 열 때만 불러온다(Rules of Hooks 준수를
  // 위해 조기 반환보다 앞에 둔다).
  useEffect(() => {
    if (!linkOpen) return;
    inboxApi
      .identitySpaces()
      .then((res) => setIdentitySpaces(res.map((s) => s.ref)))
      .catch(() => undefined);
  }, [linkOpen]);

  async function handlePick(item: CustomerSearchItem): Promise<void> {
    try {
      await inboxApi.linkSession(item.customerId, { chatbotId, sessionRef });
      setLinkOpen(false);
      load();
    } catch {
      // 인라인 오류는 CustomerSearchModal 밖으로 전달하지 않는다(§4.7 표 — 정상 경로 방어).
    }
  }

  async function handleOpenThread(): Promise<void> {
    setCreating(true);
    try {
      await inboxApi.openFromSession({ chatbotId, sessionRef });
      load();
    } finally {
      setCreating(false);
    }
  }

  if (!data || !data.participating) return null;

  if (!can('cs:read')) return null;

  if (data.customer === null) {
    return (
      <div className="session-link-card">
        {can('cs:write') && (
          <button type="button" className="btn btn-secondary" onClick={() => setLinkOpen(true)}>
            {msg.linkToCustomerButton}
          </button>
        )}
        <CustomerSearchModal isOpen={linkOpen} mode="link" identitySpaces={identitySpaces} onClose={() => setLinkOpen(false)} onPick={(item) => void handlePick(item)} />
      </div>
    );
  }

  return (
    <div className="session-link-card">
      <bdi>{data.customer.displayName ?? data.customer.alias}</bdi> <CustomerKindBadge kind={data.customer.kind} />
      <p className="field-hint">
        {msg.sessionCardConversations(data.cardBrief.conversationCount)}
        {data.cardBrief.lastIntentName && ` · ${msg.sessionCardLastIntent(data.cardBrief.lastIntentName)}`}
        {` · ${msg.sessionCardHandoffs(data.cardBrief.handoffCount)}`}
        {data.cardBrief.lastNote && ` · ${msg.sessionCardNote(data.cardBrief.lastNote)}`}
      </p>
      {data.threadId ? (
        <Link to={`/inbox/${data.threadId}`}>{msg.goToThreadButton}</Link>
      ) : (
        can('cs:write') && (
          <button type="button" className="btn btn-secondary" onClick={() => void handleOpenThread()} disabled={creating}>
            {msg.openThreadButton}
          </button>
        )
      )}
    </div>
  );
}
