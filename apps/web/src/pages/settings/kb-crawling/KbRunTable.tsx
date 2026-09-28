import { Fragment, type ReactNode } from 'react';
import type { KbRunView } from '@chat-bot/shared-types';
import { formatDateTime } from '../../../lib/date';
import { MESSAGES } from '../../../constants/messages';
import { KbRunStatusBadge } from './badges';
import { KbRunProgress } from './KbRunProgress';

const IN_FLIGHT_STATUSES: KbRunView['status'][] = ['QUEUED', 'CRAWLING', 'INGESTING'];

export interface KbRunTableProps {
  items: KbRunView[];
  expandedId: string | null;
  onToggleExpand: (id: string) => void;
  onCancel?: (run: KbRunView) => void;
  canCancel: boolean;
}

function durationText(msg: typeof MESSAGES.kbRuns, run: KbRunView, inFlight: boolean): string {
  if (run.finishedAt && run.startedAt) {
    return `${Math.max(1, Math.round((new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime()) / 60000))}분`;
  }
  return inFlight ? msg.statusLabel[run.status] : '—';
}

/**
 * 강등 사유 문구. PREVIEW + AUTH_WALL만 "미리보기 경고"(소스 승인 유지 — 서버는 실행에 사유만 기록)로
 * 구분하고, 그 밖(SYNC·FULL_RESEND의 AUTH_WALL · 모든 종류의 NEW_RATIO)은 승인 해제를 동반하는 강등이다.
 */
function demotedText(msg: typeof MESSAGES.kbRuns, run: KbRunView): string | null {
  if (!run.demotedReason) return null;
  if (run.kind === 'PREVIEW' && run.demotedReason === 'AUTH_WALL') return msg.previewWarningReasonLabel.AUTH_WALL;
  return msg.demotionReasonLabel[run.demotedReason];
}

function detailContent(msg: typeof MESSAGES.kbRuns, run: KbRunView): ReactNode {
  return (
    <>
      <p>{msg.crawlSummaryText(run.crawl.discovered, run.crawl.added, run.crawl.changed, run.crawl.unchanged, run.crawl.needsCleanup, Object.values(run.crawl.excluded).reduce((a, b) => a + b, 0))}</p>
      {run.ingest && <p>{msg.ingestSummaryText(run.ingest.total, run.ingest.succeeded, run.ingest.failed, run.ingest.unknown, run.ingest.timeout, run.ingest.skipped)}</p>}
      {run.waitingReason && <p>{msg.waitingReasonLabel[run.waitingReason]}</p>}
      {demotedText(msg, run) && <p className="field-hint field-hint--warning">{demotedText(msg, run)}</p>}
      {run.failureCode && <p className="field-hint field-hint--warning">{msg.failureCodeLabel[run.failureCode]}</p>}
      {run.maxPagesReached && <p className="field-hint field-hint--warning">{msg.maxPagesReachedWarning}</p>}
    </>
  );
}

/**
 * KB4 — 실행 이력 표(`kb-crawling-ui-spec.md` §3.4 레이아웃 · §9 반응형) — 진행/완료 공통 행 + 펼침
 * 상세. 펼침 트리거는 실제 `<button>`(키보드 Enter·Space로 조작 가능)이며 `aria-expanded`·
 * `aria-controls`를 그 버튼에 건다(No.43 R1 H2 — `<tr onClick>`만으로는 키보드 조작이 불가능했다).
 * 행 클릭(`onClick`)은 마우스 사용자를 위한 보조 수단으로 남겨둔다(선택 사항).
 */
export function KbRunTable({ items, expandedId, onToggleExpand, onCancel, canCancel }: KbRunTableProps): JSX.Element {
  const msg = MESSAGES.kbRuns;

  return (
    <>
      <table className="dialogue-table desktop-only">
        <caption className="sr-only">{`${msg.tabRuns} — 총 ${items.length}건`}</caption>
        <thead>
          <tr>
            <th scope="col">{msg.columnKind}</th>
            <th scope="col">{msg.columnTrigger}</th>
            <th scope="col">{msg.columnStatus}</th>
            <th scope="col">{msg.columnStarted}</th>
            <th scope="col">{msg.columnDuration}</th>
            <th scope="col">{MESSAGES.common.actionsColumnLabel}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((run) => {
            const inFlight = IN_FLIGHT_STATUSES.includes(run.status);
            const expanded = expandedId === run.id;
            const detailRowId = `kb-run-detail-${run.id}`;
            return (
              <Fragment key={run.id}>
                <tr className="kb-run-row" onClick={() => onToggleExpand(run.id)}>
                  <td>{msg.runKindLabel[run.kind]}</td>
                  <td>{msg.triggerLabel[run.trigger]}</td>
                  <td>{inFlight ? <KbRunProgress run={run} /> : <KbRunStatusBadge status={run.status} />}</td>
                  <td>{run.startedAt ? formatDateTime(run.startedAt) : formatDateTime(run.createdAt)}</td>
                  <td>{durationText(msg, run, inFlight)}</td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      aria-expanded={expanded}
                      aria-controls={detailRowId}
                      onClick={() => onToggleExpand(run.id)}
                    >
                      {expanded ? msg.detailCollapse : msg.detailToggle}
                    </button>
                    {inFlight && canCancel && onCancel && (
                      <button type="button" className="btn btn-secondary" onClick={() => onCancel(run)}>
                        {msg.cancelButton}
                      </button>
                    )}
                  </td>
                </tr>
                {/* [No.43 R2 Low] `aria-controls`가 항상 가리키는 대상이 실제로 존재하도록, 접힌
                    상태에서도 DOM에는 남겨두고 `hidden`으로만 감춘다(조건부 렌더로 없앴다가
                    aria-controls가 존재하지 않는 id를 참조하게 되는 것을 막는다). */}
                <tr className="kb-run-detail-row" id={detailRowId} hidden={!expanded}>
                  <td colSpan={6}>
                    <div className="kb-run-detail-panel">{detailContent(msg, run)}</div>
                  </td>
                </tr>
              </Fragment>
            );
          })}
        </tbody>
      </table>

      {/* 반응형(≤640px) — `settings-card-list mobile-only`(KB2·KB5 선례). 펼침 버튼은 데스크톱과
          동일하게 실제 <button> + aria-expanded/aria-controls를 쓴다. */}
      <ul className="settings-card-list mobile-only">
        {items.map((run) => {
          const inFlight = IN_FLIGHT_STATUSES.includes(run.status);
          const expanded = expandedId === run.id;
          const detailPanelId = `kb-run-detail-mobile-${run.id}`;
          return (
            <li key={run.id} className="settings-card">
              <div className="settings-card-header">
                <span className="settings-card-title">{msg.runKindLabel[run.kind]}</span>
                {inFlight ? <KbRunProgress run={run} /> : <KbRunStatusBadge status={run.status} />}
              </div>
              <dl className="settings-card-fields">
                <div>
                  <dt>{msg.columnTrigger}</dt>
                  <dd>{msg.triggerLabel[run.trigger]}</dd>
                </div>
                <div>
                  <dt>{msg.columnStarted}</dt>
                  <dd>{run.startedAt ? formatDateTime(run.startedAt) : formatDateTime(run.createdAt)}</dd>
                </div>
                <div>
                  <dt>{msg.columnDuration}</dt>
                  <dd>{durationText(msg, run, inFlight)}</dd>
                </div>
              </dl>
              <div className="kb-run-card-actions">
                <button
                  type="button"
                  className="btn btn-secondary"
                  aria-expanded={expanded}
                  aria-controls={detailPanelId}
                  onClick={() => onToggleExpand(run.id)}
                >
                  {expanded ? msg.detailCollapse : msg.detailToggle}
                </button>
                {inFlight && canCancel && onCancel && (
                  <button type="button" className="btn btn-secondary" onClick={() => onCancel(run)}>
                    {msg.cancelButton}
                  </button>
                )}
              </div>
              <div id={detailPanelId} className="kb-run-detail-panel" hidden={!expanded}>
                {detailContent(msg, run)}
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}
