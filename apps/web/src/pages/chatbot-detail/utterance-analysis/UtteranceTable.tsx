import { useEffect, useRef } from 'react';
import type { AnalyzedUtterance, UtteranceCluster } from '@chat-bot/shared-types';
import { MESSAGES } from '../../../constants/messages';
import { formatDateTime } from '../../../lib/date';
import { SeverityBadge } from '../../../components/SeverityBadge';
import { clusterNumberLabel } from './ClusterTable';

/** 금지어가 든 발화와 이미 반영한 발화는 선택 자체를 막는다(서버가 항상 제외하는 항목 — 화면 설계서 §12-2). */
export function isSelectable(u: Pick<AnalyzedUtterance, 'hasBannedWord' | 'applied'>): boolean {
  return !u.hasBannedWord && u.applied === null;
}

function probeText(u: AnalyzedUtterance): string {
  const msg = MESSAGES.utteranceAnalysis;
  if (!u.probe) return msg.probeNone;
  if (!u.probe.answered) return u.probe.wouldUseRag ? msg.probeNotAnsweredRag : msg.probeNotAnswered;
  const kind = u.probe.matchKind;
  if (kind && u.probe.matchName) return msg.probeAnswered[kind](u.probe.matchName);
  return msg.probeAnsweredNoName;
}

/** 표시 배지 4종(학습 후보·금지어·가림 표시·반영됨) — 색 + 아이콘(`aria-hidden`) + 글자를 함께 쓴다. */
export function UtteranceFlagBadges({ u }: { u: AnalyzedUtterance }): JSX.Element {
  const msg = MESSAGES.utteranceAnalysis;
  return (
    <div className="ua-flags">
      {u.learningCandidate && <SeverityBadge severity="WARNING" label={msg.flagCandidate} />}
      {u.hasBannedWord && <SeverityBadge severity="ERROR" label={msg.flagBanned} />}
      {u.hasMaskToken && <SeverityBadge severity="INFO" label={msg.flagMask} />}
      {u.applied && (
        <span className="severity-badge" style={{ backgroundColor: '#DCFCE7', color: '#166534' }} title={msg.flagAppliedTitle(u.applied.byEmail ?? msg.noneDash, formatDateTime(u.applied.at))}>
          <span aria-hidden="true">✔</span> {msg.flagApplied(u.applied.intentName)}
        </span>
      )}
    </div>
  );
}

export interface UtteranceTableProps {
  items: AnalyzedUtterance[];
  clusters: UtteranceCluster[];
  /** 선택 열을 그릴지(쓰기 권한 ∧ 보관 아님). 읽기 전용이면 열 자체가 없다. */
  canSelect: boolean;
  /** 선택한 발화(id → 가린 문장). 페이지·필터가 바뀌어도 유지된다. */
  selected: Map<string, string>;
  maxSelect: number;
  onToggle: (u: AnalyzedUtterance) => void;
  /** 머리 체크박스 — 이 페이지에서 선택 가능한 발화를 모두 선택/해제. */
  onTogglePage: (selectable: AnalyzedUtterance[], selectAll: boolean) => void;
}

/** 발화 표(§5.6) — 선택 열은 쓰기 권한에게만 보인다. 표 머리 체크박스는 `indeterminate`를 지원한다. */
export function UtteranceTable({ items, clusters, canSelect, selected, maxSelect, onToggle, onTogglePage }: UtteranceTableProps): JSX.Element {
  const msg = MESSAGES.utteranceAnalysis;
  const headRef = useRef<HTMLInputElement>(null);
  const clusterById = new Map(clusters.map((c) => [c.id, c]));
  const selectable = items.filter(isSelectable);
  const selectedOnPage = selectable.filter((u) => selected.has(u.id)).length;
  const allSelected = selectable.length > 0 && selectedOnPage === selectable.length;
  const someSelected = selectedOnPage > 0 && !allSelected;
  const maxed = selected.size >= maxSelect;

  useEffect(() => {
    if (headRef.current) headRef.current.indeterminate = someSelected;
  }, [someSelected]);

  return (
    <div className="table-scroll-container" role="region" tabIndex={0} aria-label={msg.tableScrollLabel}>
      <table className="dialogue-table ua-utterance-table">
        <caption>{msg.utteranceCaption}</caption>
        <thead>
          <tr>
            {canSelect && (
              <th scope="col">
                <input
                  ref={headRef}
                  type="checkbox"
                  aria-label={msg.colSelectAll}
                  checked={allSelected}
                  disabled={selectable.length === 0}
                  onChange={() => onTogglePage(selectable, !allSelected)}
                />
              </th>
            )}
            <th scope="col">{msg.colUtterance}</th>
            <th scope="col">{msg.colOccurrence}</th>
            <th scope="col">{msg.colCluster}</th>
            <th scope="col">{msg.colProbe}</th>
            <th scope="col">
              {msg.colScore} <span className="sr-only">{msg.colScoreHelp}</span>
            </th>
            <th scope="col">{msg.colSuggested}</th>
            <th scope="col">{msg.colFlags}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((u) => {
            const c = clusterById.get(u.clusterId);
            const canPick = isSelectable(u);
            const isSel = selected.has(u.id);
            const blockedByMax = canPick && !isSel && maxed;
            const textId = `ua-utt-${u.id}`;
            const reasonId = `ua-utt-reason-${u.id}`;
            const selId = `ua-utt-sel-${u.id}`;
            return (
              <tr key={u.id}>
                {canSelect && (
                  <td>
                    {canPick ? (
                      <>
                        <input
                          type="checkbox"
                          aria-labelledby={`${textId} ${selId}`}
                          aria-describedby={blockedByMax ? reasonId : undefined}
                          aria-disabled={blockedByMax ? 'true' : undefined}
                          checked={isSel}
                          onChange={() => {
                            if (!blockedByMax) onToggle(u);
                          }}
                        />
                        <span id={selId} className="sr-only">
                          {msg.selectRowSuffix}
                        </span>
                        {blockedByMax && (
                          <span id={reasonId} className="sr-only">
                            {msg.notSelectableMax}
                          </span>
                        )}
                      </>
                    ) : (
                      <>
                        <span aria-hidden="true">{msg.noneDash}</span>
                        <span className="sr-only">{u.applied ? msg.notSelectableApplied : msg.notSelectableBanned}</span>
                      </>
                    )}
                  </td>
                )}
                <td id={textId} className="ua-utterance-text">
                  {u.text}
                </td>
                <td>{u.occurrenceCount.toLocaleString('ko-KR')}</td>
                <td>{c?.unassigned ? clusterNumberLabel(c) : `${u.clusterOrdinal} ${u.clusterDisplayName}`}</td>
                <td>{probeText(u)}</td>
                <td>{u.probe?.score !== null && u.probe?.score !== undefined ? msg.scoreText(Math.round(u.probe.score * 100)) : msg.noneDash}</td>
                <td>
                  {u.suggestedIntents.length === 0 ? (
                    msg.noneDash
                  ) : (
                    <ul className="ua-suggested">
                      {u.suggestedIntents.slice(0, 3).map((s) => (
                        <li key={s.intentId}>
                          {msg.suggestedItem(s.name, Math.round(s.score * 100))}
                          {s.source === 'LEXICAL' && <span className="ua-col-note"> {msg.suggestedLexical}</span>}
                        </li>
                      ))}
                    </ul>
                  )}
                </td>
                <td>
                  <UtteranceFlagBadges u={u} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
