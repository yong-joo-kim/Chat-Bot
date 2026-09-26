import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { LiveSessionListResponse, LiveSessionRow } from '@chat-bot/shared-types';
import { formatDateTime } from '../../lib/date';
import { MESSAGES } from '../../constants/messages';
import { GovernedTextValue } from '../DataGovernanceBadges';
import { AlertLevelBadge, HandoffStateBadge } from './badges';
import { SessionRefLabel } from './SessionRefLabel';

/**
 * [신규 No.45] G5 — 진행 중 세션 목록의 마지막 사용자 발화도 보존기간 경과로 소거될 수 있다
 * (data-governance-ui-spec.md §3.7 "진행 중 목록의 마지막 발화", `LiveSessionRow.lastUserTextPurged`).
 */
function isLastUserTextPurged(row: LiveSessionRow): boolean {
  return row.lastUserTextPurged === true;
}

/** HC1 상단 요약 카운터(hybrid-cs-ui-spec.md §2.2 `SessionSummaryBar`). */
export function SessionSummaryBar({ summary }: { summary: LiveSessionListResponse['summary'] }): JSX.Element {
  const msg = MESSAGES.handoffConsole;
  return (
    <div className="session-summary-bar">
      <span>
        {msg.summaryLive} {summary.live}
      </span>
      <span>
        <span aria-hidden="true">⛔</span> {msg.summaryWarning} {summary.warning}
      </span>
      <span>
        <span aria-hidden="true">▲</span> {msg.summaryCaution} {summary.caution}
      </span>
      <span>
        {msg.summaryConnected} {summary.handoffActive}
      </span>
    </div>
  );
}

/** 폴링 30초 연속 실패 시에만 렌더(hybrid-cs-ui-spec.md §2.2 `PollingStaleBanner`). */
export function PollingStaleBanner({ failedCount }: { failedCount: number }): JSX.Element | null {
  if (failedCount < 15) return null; // 2초(HC2)/5초(HC1) 주기 기준 30초 상당 — 호출부가 문턱을 맞춰 전달
  return (
    <p className="error-state-title" role="alert">
      <span aria-hidden="true">⚠</span> {MESSAGES.handoffConsole.pollingStaleBanner}
    </p>
  );
}

/**
 * HC1 진행 중 세션 표(hybrid-cs-ui-spec.md §2.2 `LiveSessionTable`). 갱신 시 스크롤·정렬 상태를
 * 유지한다(UIUX §8 보강) — 행을 `sessionRef` key로 유지해 불필요한 리마운트를 막는다. 새 경고
 * 세션 발생만 `aria-live="polite"` 1회 안내한다(NFR-CSA2).
 */
export function LiveSessionTable({
  items,
  chatbotId,
}: {
  items: LiveSessionRow[];
  chatbotId: string;
}): JSX.Element {
  const msg = MESSAGES.handoffConsole;
  const knownWarningRefs = useRef<Set<string>>(new Set());
  const [announce, setAnnounce] = useState('');

  useEffect(() => {
    const currentWarnings = items.filter((i) => i.alertLevel === 'WARNING').map((i) => i.sessionRef);
    const newOnes = currentWarnings.filter((ref) => !knownWarningRefs.current.has(ref));
    if (newOnes.length > 0) setAnnounce(msg.newAlertAnnounce(newOnes.length));
    knownWarningRefs.current = new Set(currentWarnings);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  return (
    <div className="live-session-table-responsive">
      <p className="sr-only" role="status" aria-live="polite">
        {announce}
      </p>
      {/* 데스크톱·태블릿(§8.1) — <640px에서는 CSS로 숨기고 카드 목록을 보여준다. */}
      <div className="import-report-table-wrap live-session-table--wide">
        <table className="import-report-table">
          <thead>
            <tr>
              <th scope="col">{msg.columnStatus}</th>
              <th scope="col">{msg.columnAlias}</th>
              <th scope="col">{msg.columnLastMessage}</th>
              <th scope="col">{msg.columnLastActivity}</th>
              <th scope="col">{msg.columnUnanswered}</th>
              <th scope="col">{msg.columnAssignee}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((row) => (
              <tr key={row.sessionRef}>
                <td>
                  <AlertLevelBadge level={row.alertLevel} consecutive={row.consecutiveUnanswered} />
                </td>
                <td>
                  <Link to={`/handoff-console/${chatbotId}/live/${row.sessionRef}`}>
                    <SessionRefLabel value={row.sessionRef} />
                  </Link>{' '}
                  {row.handoff?.clientMode === 'LEGACY' && <HandoffStateBadge kind="LEGACY" />}
                </td>
                <td>
                  <GovernedTextValue text={row.lastUserText} purged={isLastUserTextPurged(row)} />
                  {row.lastUnansweredReason === 'API_NOTICE' && (
                    <p className="field-hint">{msg.unansweredReasonApiNotice}</p>
                  )}
                </td>
                <td>{formatDateTime(row.lastAt)}</td>
                <td>
                  {row.consecutiveUnanswered}/{row.windowUnanswered}
                </td>
                <td>{renderAssignee(row, msg)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 모바일(<640px, §8.1) — 행마다 카드로. 데스크톱·태블릿에서는 CSS로 숨긴다. */}
      <ul className="live-session-card-list">
        {items.map((row) => (
          <li key={row.sessionRef} className="live-session-card">
            <Link to={`/handoff-console/${chatbotId}/live/${row.sessionRef}`} className="live-session-card-link">
              <div className="live-session-card-header">
                <AlertLevelBadge level={row.alertLevel} consecutive={row.consecutiveUnanswered} />
                <SessionRefLabel value={row.sessionRef} />
                {row.handoff?.clientMode === 'LEGACY' && <HandoffStateBadge kind="LEGACY" />}
              </div>
              <p className="live-session-card-message">
                <GovernedTextValue text={row.lastUserText} purged={isLastUserTextPurged(row)} />
              </p>
              <p className="field-hint">
                {formatDateTime(row.lastAt)} · {msg.columnUnanswered} {row.consecutiveUnanswered}/{row.windowUnanswered} · {renderAssignee(row, msg)}
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function renderAssignee(row: LiveSessionRow, msg: typeof MESSAGES.handoffConsole): string {
  if (!row.handoff) return '—';
  if (row.handoff.isMine) return msg.handoffConnectedMine;
  return row.handoff.status === 'CONNECTING' ? msg.handoffConnecting(row.handoff.assignedUserName) : msg.handoffConnected(row.handoff.assignedUserName);
}
