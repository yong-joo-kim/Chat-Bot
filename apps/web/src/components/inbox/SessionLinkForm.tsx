import { useState } from 'react';
import { MESSAGES } from '../../constants/messages';
import { InlineFieldError } from '../InlineFieldError';

/**
 * OI-2 "다른 대화 연결"(`omnichannel-inbox-ui-spec.md` §3.5 `SessionLinkForm`) — 챗봇 셀렉트 +
 * `sessionRef` 입력(자동완성 없음, §12 D-5).
 */
export function SessionLinkForm({
  participatingChatbots,
  saving,
  error,
  onSubmit,
  onCancel,
}: {
  participatingChatbots: Array<{ id: string; name: string }>;
  saving: boolean;
  error?: string;
  onSubmit: (chatbotId: string, sessionRef: string) => void;
  onCancel: () => void;
}): JSX.Element {
  const msg = MESSAGES.inbox;
  const [chatbotId, setChatbotId] = useState(participatingChatbots[0]?.id ?? '');
  const [sessionRef, setSessionRef] = useState('');

  function handleSubmit(e: React.FormEvent): void {
    e.preventDefault();
    if (!chatbotId || sessionRef.trim().length === 0) return;
    onSubmit(chatbotId, sessionRef.trim());
  }

  return (
    <form className="session-link-form" onSubmit={handleSubmit} noValidate>
      <div className="form-field">
        <label htmlFor="session-link-chatbot">{msg.sessionLinkChatbotLabel}</label>
        <select id="session-link-chatbot" value={chatbotId} onChange={(e) => setChatbotId(e.target.value)}>
          {participatingChatbots.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
      <div className="form-field">
        <label htmlFor="session-link-ref">{msg.sessionLinkSessionRefLabel}</label>
        <input id="session-link-ref" type="text" value={sessionRef} onChange={(e) => setSessionRef(e.target.value)} aria-describedby="session-link-ref-error" />
        <InlineFieldError id="session-link-ref-error" message={error} />
      </div>
      <div className="form-actions">
        <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={saving}>
          {msg.cancel}
        </button>
        <button type="submit" className="btn btn-primary" disabled={saving}>
          {saving ? MESSAGES.common.saving : msg.sessionLinkSubmit}
        </button>
      </div>
    </form>
  );
}
