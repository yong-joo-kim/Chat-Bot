import type { ConversationState } from '@chat-bot/shared-types';
import { MESSAGES } from '../../../constants/messages';

/** 세션 상태 우측 패널(FR-10-11). 값은 마스킹 없이 관리자에게만 표시된다(NFR-S6). */
export function SessionStatePanel({ state }: { state: ConversationState | null }): JSX.Element {
  const msg = MESSAGES.simulator.session;
  const session = state?.contextSession ?? null;

  return (
    <aside className="session-state-panel" aria-label={msg.title}>
      <h3>{msg.title}</h3>
      {!session ? (
        <p className="field-hint">{msg.empty}</p>
      ) : (
        <dl className="session-state-details">
          <div>
            <dt>{msg.slot(session.currentSlotIndex, Object.keys(session.filledValues).length || session.currentSlotIndex + 1)}</dt>
            <dd>{msg.status[session.status]}</dd>
          </div>
          {Object.entries(session.filledValues).map(([key, value]) => (
            <div key={key}>
              <dt>{key}</dt>
              <dd>{value || msg.unfilled}</dd>
            </div>
          ))}
          <div>
            <dt>{msg.retryCount(session.retryCount)}</dt>
          </div>
        </dl>
      )}
      <p className="field-hint session-state-caption">{MESSAGES.simulator.statsCaption}</p>
    </aside>
  );
}
