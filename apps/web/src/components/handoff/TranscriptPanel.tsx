import { useCallback, useEffect, useRef, useState } from 'react';
import type { HandoffBrief, TranscriptEntry, TranscriptResponse } from '@chat-bot/shared-types';
import { handoffApi } from '../../api/handoff';
import { ApiError } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { useLatestRequest } from '../../lib/useLatestRequest';
import { formatDateTime } from '../../lib/date';
import { MESSAGES } from '../../constants/messages';
import { RawTextToggle } from './RawTextToggle';
import { RawViewBadge } from './badges';

const POLL_INTERVAL_MS = 2000;
const STALE_THRESHOLD = 15; // 2초 × 15 = 30초 연속 실패

/**
 * HC2 대화 보기(hybrid-cs-ui-spec.md §2.2·§3.3). 봇 구간·상담 구간을 병합 렌더하고, 2초 폴링으로
 * 갱신한다. 원문은 React state에만 존재하며(§12-4), `rawVisible:false` 수신 시 즉시 삭제한다.
 */
export function TranscriptPanel({
  chatbotId,
  sessionRef,
  readOnly = false,
  onHandoffChange,
  onLastUserKeyChange,
  onNotFound,
}: {
  chatbotId: string;
  sessionRef: string;
  /** HC4(이력 상세)의 읽기 전용 변형 — `includeRaw` 옵션 자체를 렌더하지 않는다(§9.3 H-5). */
  readOnly?: boolean;
  onHandoffChange?: (handoff: HandoffBrief | null) => void;
  onLastUserKeyChange?: (key: string | null) => void;
  /** 교차 챗봇 `sessionRef`(404) — 필드-오류 매핑 §3.3. */
  onNotFound?: () => void;
}): JSX.Element {
  const { user, can } = useAuth();
  const msg = MESSAGES.handoffConsole;

  const [entries, setEntries] = useState<TranscriptEntry[]>([]);
  const [handoff, setHandoff] = useState<HandoffBrief | null>(null);
  const [rawVisible, setRawVisible] = useState(false);
  const [rawEnabled, setRawEnabled] = useState(false);
  const [rawExpiredNotice, setRawExpiredNotice] = useState(false);
  const [blockedDuringHandoff, setBlockedDuringHandoff] = useState(0);
  const [loading, setLoading] = useState(true);
  const [failCount, setFailCount] = useState(0);

  const cursorRef = useRef<string | undefined>(undefined);
  const rawEnabledRef = useRef(false);
  const wasRawEnabledRef = useRef(false);
  const guard = useLatestRequest();

  const fetchOnce = useCallback(
    async (reset: boolean) => {
      if (reset) {
        cursorRef.current = undefined;
        setEntries([]);
      }
      const reqId = guard.next();
      try {
        const res: TranscriptResponse = await handoffApi.transcript(chatbotId, sessionRef, {
          cursor: cursorRef.current,
          includeRaw: !readOnly && rawEnabledRef.current,
        });
        if (guard.isStale(reqId)) return;
        setFailCount(0);
        setEntries((prev) => {
          const byKey = new Map(prev.map((e) => [entryKey(e), e]));
          for (const e of res.entries) byKey.set(entryKey(e), e);
          let merged = Array.from(byKey.values());
          // §9.3/§12-4: rawVisible:false를 받으면 이번 응답의 새 항목뿐 아니라, 이전에 이미 캐시된
          // 항목에 남아 있는 원문도 즉시 지운다 — 캐시가 다음 렌더까지도 남아 있으면 안 된다.
          if (!res.rawVisible) {
            merged = merged.map((e) => (e.kind === 'HANDOFF' && e.rawText !== undefined ? { ...e, rawText: undefined } : e));
          }
          return merged.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
        });
        if (res.nextCursor) cursorRef.current = res.nextCursor;
        setHandoff(res.handoff);
        onHandoffChange?.(res.handoff);
        setBlockedDuringHandoff(res.blockedDuringHandoff);
        setRawVisible(res.rawVisible);
        if (!res.rawVisible && wasRawEnabledRef.current) {
          setRawEnabled(false);
          rawEnabledRef.current = false;
          setRawExpiredNotice(true);
        }
        wasRawEnabledRef.current = res.rawVisible && rawEnabledRef.current;
      } catch (e) {
        if (guard.isStale(reqId)) return;
        if (e instanceof ApiError && e.status === 404) {
          onNotFound?.();
          return;
        }
        setFailCount((c) => c + 1);
      } finally {
        if (!guard.isStale(reqId)) setLoading(false);
      }
    },
    [chatbotId, sessionRef, readOnly, guard, onHandoffChange, onNotFound],
  );

  useEffect(() => {
    // C1(코드 리뷰 1회차 Critical): 세션이 바뀌면 원문 관련 상태를 전부 리셋한다 — 이전 세션에서 켠
    // "원문 보기"가 동의 고지 없이 다음 세션으로 넘어가 원문 요청이 나가면 안 된다. 리셋 직후 첫 조회는
    // 반드시 `includeRaw:false`로 나가야 하므로, ref도 state와 함께 동기적으로 꺼 둔다(fetchOnce는
    // `rawEnabledRef.current`를 읽는다 — state만 꺼두면 이번 틱의 fetchOnce가 아직 true를 읽는다).
    rawEnabledRef.current = false;
    wasRawEnabledRef.current = false;
    setRawEnabled(false);
    setRawVisible(false);
    setRawExpiredNotice(false);
    setLoading(true);
    void fetchOnce(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatbotId, sessionRef]);

  useEffect(() => {
    if (readOnly) return undefined;
    const timer = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      void fetchOnce(false);
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [fetchOnce, readOnly]);

  // 마지막 사용자 발화 key(HintPanel 재요청 트리거, AC-CS5-5) — BOT_TURN.logId 또는 HANDOFF(USER).messageId 중 최신.
  useEffect(() => {
    let lastKey: string | null = null;
    let lastAt = -Infinity;
    for (const e of entries) {
      const at = new Date(e.at).getTime();
      if (e.kind === 'BOT_TURN' && at > lastAt) {
        lastKey = e.logId;
        lastAt = at;
      } else if (e.kind === 'HANDOFF' && e.sender === 'USER' && at > lastAt) {
        lastKey = e.messageId;
        lastAt = at;
      }
    }
    onLastUserKeyChange?.(lastKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries]);

  function handleRawToggle(next: boolean): void {
    setRawEnabled(next);
    rawEnabledRef.current = next;
    setRawExpiredNotice(false);
    void fetchOnce(true);
  }

  const isAdmin = user?.role === 'ADMIN';
  // H1(코드 리뷰 1회차 반영): `HandoffBriefSchema.isMine`(서버가 `assignedUserId === 요청자.id`로 계산)을
  // 그대로 쓴다 — 동명이인 오판이 나던 이름 비교(`assignedUserName === user.name`)를 제거했다.
  // `InterveneButton`/`LiveSessionRow.handoff.isMine`과 같은 기준으로 통일됨.
  const isAssignee = Boolean(handoff?.isMine);
  const rawToggleVisible = !readOnly && !!handoff && handoff.status === 'CONNECTED' && can('cs:write') && (isAdmin || isAssignee);

  return (
    <div className="transcript-panel">
      <div className="transcript-panel-header">
        <h3>{msg.transcriptTitle}</h3>
        <RawTextToggle visible={rawToggleVisible} enabled={rawEnabled} onToggle={handleRawToggle} />
      </div>
      <p className="field-hint">
        <span aria-hidden="true">⚠</span> {msg.transcriptPiiNotice} {rawEnabled && msg.transcriptPiiNoticeRawAddendum}
      </p>
      {rawEnabled && rawVisible && (
        <p className="field-hint" role="status">
          {msg.rawToggleConfirmDesc}
        </p>
      )}
      {rawExpiredNotice && (
        <p className="field-hint" role="status">
          <span aria-hidden="true">ⓘ</span> {msg.rawExpiredNotice}
        </p>
      )}
      {blockedDuringHandoff > 0 && <p className="field-hint">{msg.blockedDuringHandoffBadge(blockedDuringHandoff)}</p>}
      {failCount >= STALE_THRESHOLD && (
        <p className="error-state-title" role="alert">
          <span aria-hidden="true">⚠</span> {msg.pollingStaleBanner}
        </p>
      )}
      <div className="transcript-log" role="log" aria-live="polite" aria-label={msg.transcriptTitle}>
        {loading && entries.length === 0 ? (
          <div className="skeleton skeleton-row" />
        ) : (
          entries.map((e) => <TranscriptEntryRow key={entryKey(e)} entry={e} hideRaw={readOnly} />)
        )}
      </div>
    </div>
  );
}

function entryKey(e: TranscriptEntry): string {
  return e.kind === 'BOT_TURN' ? `bot:${e.logId}` : `handoff:${e.messageId}`;
}

const SENDER_LABEL: Record<'USER' | 'AGENT' | 'SYSTEM', string> = { USER: '사용자', AGENT: '상담원', SYSTEM: '시스템' };

/**
 * HC4(이력 상세)가 재사용하는 정적 렌더 — `HandoffHistoryDetailResponse.entries`는 이미 마스킹본으로
 * 내려오므로(원문 필드 자체가 없다, §9.3 H-5) 폴링·원문 토글 없이 그대로 그린다.
 * M5(코드 리뷰 1회차): `hideRaw`를 항상 `true`로 넘겨 이중 방어한다 — 이 화면 코드 경로에
 * 원문이 등장할 계약상 이유가 없더라도, 렌더 계층에서도 명시적으로 차단한다(§9.3 H-5).
 */
export function TranscriptEntryList({ entries }: { entries: TranscriptEntry[] }): JSX.Element {
  return (
    <div className="transcript-log">
      {entries.map((e) => (
        <TranscriptEntryRow key={entryKey(e)} entry={e} hideRaw />
      ))}
    </div>
  );
}

function TranscriptEntryRow({ entry, hideRaw = false }: { entry: TranscriptEntry; hideRaw?: boolean }): JSX.Element {
  if (entry.kind === 'BOT_TURN') {
    return (
      <div className="transcript-entry transcript-entry--bot">
        <p className="transcript-line">
          <strong>사용자</strong> {entry.userText} <span className="field-hint">{formatDateTime(entry.at)}</span>
        </p>
        <p className="transcript-line">
          <strong>봇</strong>{' '}
          {entry.isAnswered ? entry.botText : MESSAGES.handoffConsole.unansweredReasonFallback}
          {entry.answeredBy && <span className="dialogue-badge dialogue-badge--neutral">{entry.answeredBy.kind}</span>}
        </p>
      </div>
    );
  }
  const showRaw = !hideRaw && entry.rawText !== undefined;
  return (
    <div className={`transcript-entry transcript-entry--handoff transcript-entry--${entry.sender.toLowerCase()}`}>
      <p className="transcript-line">
        <strong>{entry.senderName ?? SENDER_LABEL[entry.sender]}</strong> {entry.text}{' '}
        {showRaw && (
          <>
            <RawViewBadge /> <span className="transcript-raw-text">{entry.rawText}</span>
          </>
        )}{' '}
        <span className="field-hint">{formatDateTime(entry.at)}</span>
      </p>
    </div>
  );
}
