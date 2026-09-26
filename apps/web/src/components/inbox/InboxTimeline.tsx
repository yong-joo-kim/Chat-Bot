import type { TimelineConversationUnit, TimelineEntryUnit, TimelineUnit } from '@chat-bot/shared-types';
import { MESSAGES } from '../../constants/messages';
import { formatDateTime } from '../../lib/date';
import { GovernedTextValue } from '../DataGovernanceBadges';
import { ChannelFamilyBadge } from './badges';

function unitKey(unit: TimelineUnit): string {
  return unit.kind === 'CONVERSATION' ? `conv:${unit.sessionRef}:${unit.startedAt}` : `entry:${unit.entryId}`;
}

/** `TranscriptPanel`의 발신자 라벨 관례를 그대로 따른다(hybrid-cs-ui-spec.md §3.3). */
const HANDOFF_SENDER_LABEL: Record<'USER' | 'AGENT' | 'SYSTEM', string> = { USER: '사용자', AGENT: '상담원', SYSTEM: '시스템' };

function ConversationUnitRow({ unit }: { unit: TimelineConversationUnit }): JSX.Element {
  return (
    <div className="transcript-entry">
      <p className="transcript-line">
        <ChannelFamilyBadge family="DEPLOY" label={unit.channel.label} /> {unit.chatbot.name} {formatDateTime(unit.startedAt)}
      </p>
      {unit.turns.map((t, i) => (
        <div key={i}>
          <p className="transcript-line">
            <strong>사용자</strong> <GovernedTextValue text={t.user} purged={t.purged} /> <span className="field-hint">{formatDateTime(t.at)}</span>
          </p>
          <p className="transcript-line">
            <strong>봇</strong> <GovernedTextValue text={t.bot} purged={t.purged} />
          </p>
        </div>
      ))}
      {/* [2026-09-26 계약 보강] `handoffs[].messages`가 채워진다 — 마스킹본(`GovernedTextValue`가
          파기/복호화 실패 자리를 대신 그린다) + 발신자 라벨을 표시한다(§3.2 타임라인 상담 구간). */}
      {unit.handoffs.map((h) => (
        <div key={h.handoffId}>
          <p className="transcript-line">
            [{MESSAGES.inbox.actionsTitle} {formatDateTime(h.startedAt)} · {h.agentName}]
          </p>
          {h.messages.map((m, i) => (
            <p key={i} className="transcript-line">
              <strong>{HANDOFF_SENDER_LABEL[m.sender]}</strong> <GovernedTextValue text={m.text} purged={m.purged} />{' '}
              <span className="field-hint">{formatDateTime(m.at)}</span>
            </p>
          ))}
        </div>
      ))}
    </div>
  );
}

function EntryUnitRow({
  unit,
  onRevertMerge,
  canRevert,
  onEditNote,
  canEditNote,
}: {
  unit: TimelineEntryUnit;
  onRevertMerge?: (mergeId: string) => void;
  // [코드 리뷰 R1 Low] 되돌리기 비활성 사유는 항목마다 다를 수 있어(로그인 승격/일반 병합·ADMIN 여부)
  // 정적 문자열 prop이 아니라 `canRevert(unit).reason`으로만 받는다(죽은 prop `revertDisabledReason`
  // 제거 — 항상 이 함수의 반환값을 썼고 별도 prop을 쓴 적이 없었다).
  canRevert?: (unit: TimelineEntryUnit) => { allowed: boolean; reason?: string };
  onEditNote?: (entryId: string) => void;
  canEditNote?: boolean;
}): JSX.Element {
  const msg = MESSAGES.inbox;
  if (unit.kind === 'SYSTEM') {
    const isRevertible = unit.system?.event === 'MERGED_IN' || unit.system?.event === 'PROMOTED';
    // [2026-09-26 계약 보강] `inbox.store.ts` 647행 — SYSTEM 항목 meta에 `mergeId`가 실린다
    // (`POST /inbox/merges/:mergeId/revert`의 경로 값, §3.6b).
    const mergeId = isRevertible ? String(unit.system?.data.mergeId ?? '') : '';
    const revertCheck = isRevertible && canRevert ? canRevert(unit) : undefined;
    return (
      <div className="transcript-entry transcript-entry--handoff">
        <p className="transcript-line">
          [{formatDateTime(unit.at)}] <GovernedTextValue text={unit.text} purged={unit.purged} />{' '}
          {isRevertible &&
            mergeId &&
            (revertCheck?.allowed ? (
              <button type="button" className="btn btn-secondary" onClick={() => onRevertMerge?.(mergeId)}>
                {msg.revertButton}
              </button>
            ) : (
              revertCheck?.reason && <span className="field-hint">{revertCheck.reason}</span>
            ))}
        </p>
      </div>
    );
  }
  return (
    <div className={`transcript-entry transcript-entry--${unit.kind.toLowerCase()}`}>
      <p className="transcript-line">
        [{unit.kind === 'NOTE' ? msg.noteFormTitle : unit.kind === 'RECORD' ? msg.recordFormTitle : msg.simulationBadge} {formatDateTime(unit.at)}
        {unit.author && ` · ${unit.author.name}`}]
      </p>
      <p className="transcript-line">
        <GovernedTextValue text={unit.text} purged={unit.purged} />
        {unit.kind === 'NOTE' && unit.editable && onEditNote && canEditNote && (
          <button type="button" className="btn btn-secondary" onClick={() => onEditNote(unit.entryId)}>
            {msg.noteEditButton}
          </button>
        )}
      </p>
    </div>
  );
}

/**
 * OI-2 타임라인(`omnichannel-inbox-ui-spec.md` §2.3 `InboxTimeline`) — 대화 단위·항목 단위를
 * 시간순 한 줄기로. `role="log"`, 새 항목은 `aria-live="polite"` 1회(폴링 갱신 시 재생성 방지를
 * 위해 각 행의 key를 안정 id로 고정한다).
 */
export function InboxTimeline({
  units,
  nextCursor,
  onLoadMore,
  loadingMore,
  onRevertMerge,
  canRevert,
  onEditNote,
  canEditNote,
}: {
  units: TimelineUnit[];
  nextCursor: string | null;
  onLoadMore: () => void;
  loadingMore: boolean;
  onRevertMerge?: (mergeId: string) => void;
  canRevert?: (unit: TimelineEntryUnit) => { allowed: boolean; reason?: string };
  onEditNote?: (entryId: string) => void;
  canEditNote?: boolean;
}): JSX.Element {
  return (
    <div className="transcript-log" role="log" aria-live="polite" aria-label={MESSAGES.inbox.title}>
      {units.map((unit) =>
        unit.kind === 'CONVERSATION' ? (
          <ConversationUnitRow key={unitKey(unit)} unit={unit} />
        ) : (
          <EntryUnitRow
            key={unitKey(unit)}
            unit={unit}
            onRevertMerge={onRevertMerge}
            canRevert={canRevert}
            onEditNote={onEditNote}
            canEditNote={canEditNote}
          />
        ),
      )}
      {nextCursor && (
        <button type="button" className="btn btn-secondary" onClick={onLoadMore} disabled={loadingMore}>
          {loadingMore ? MESSAGES.common.loading : MESSAGES.inbox.loadMoreTimeline}
        </button>
      )}
    </div>
  );
}
