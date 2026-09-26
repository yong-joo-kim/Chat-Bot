import { useState } from 'react';
import type { ButtonActionView } from '@chat-bot/shared-types/output-view';
import { ChannelType, CHANNEL_TYPE_LABELS, CHANNEL_TYPE_ORDER } from '@chat-bot/shared-types';
import { MESSAGES } from '../../constants/messages';
import { inboxApi } from '../../api/inbox';
import { ApiError } from '../../api/client';
import { ChatBubble } from '../../pages/chatbot-detail/simulator/ChatBubble';
import { MessageComposer } from '../../pages/chatbot-detail/simulator/MessageComposer';
import type { SimMessage } from '../../pages/chatbot-detail/simulator/types';
import { SimulationBadge } from './badges';

let seq = 0;
function nextId(): string {
  seq += 1;
  return `sim-${seq}`;
}

/**
 * OI-7 시뮬레이션 패널(`omnichannel-inbox-ui-spec.md` §3.7 `SimulationChatPanel`) — `ChatBubble`·
 * `MessageComposer`를 재사용하되(§2.1), 모든 말풍선에 "시뮬레이션" 라벨을 **병기**해야 하므로(NFR-OCA3)
 * `ChatMessageList`의 내부 매핑 대신 이 컴포넌트가 직접 래핑한다(같은 `role="log"` 골격 유지).
 */
export function SimulationChatPanel({
  customerId,
  participatingChatbots,
  onEntryAdded,
}: {
  customerId: string;
  participatingChatbots: Array<{ id: string; name: string }>;
  onEntryAdded?: () => void;
}): JSX.Element {
  const msg = MESSAGES.inbox;
  const [chatbotId, setChatbotId] = useState(participatingChatbots[0]?.id ?? '');
  const [channel, setChannel] = useState<ChannelType>(CHANNEL_TYPE_ORDER[0]);
  const [messages, setMessages] = useState<SimMessage[]>([]);
  const [sending, setSending] = useState(false);

  async function handleSend(text: string): Promise<void> {
    if (!chatbotId) return;
    setMessages((prev) => [...prev, { id: nextId(), role: 'user', text }]);
    setSending(true);
    try {
      const res = await inboxApi.simulate(customerId, { chatbotId, simulatedChannel: channel, message: text });
      setMessages((prev) => [...prev, { id: nextId(), role: 'bot', outputs: res.outputs }]);
      onEntryAdded?.();
    } catch (e) {
      setMessages((prev) => [...prev, { id: nextId(), role: 'error', text: e instanceof ApiError ? e.message : MESSAGES.errors.generic }]);
    } finally {
      setSending(false);
    }
  }

  function handleButtonClick(action: ButtonActionView): void {
    if (action.kind === 'MESSAGE') void handleSend(action.text ?? action.label);
  }

  return (
    <section className="settings-card simulation-chat-panel">
      <h3>{msg.simulationTitle(CHANNEL_TYPE_LABELS[channel])}</h3>
      <div className="form-field form-field--inline">
        <label htmlFor="sim-chatbot-select">{msg.simulationChatbotLabel}</label>
        <select id="sim-chatbot-select" value={chatbotId} onChange={(e) => setChatbotId(e.target.value)}>
          {participatingChatbots.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <label htmlFor="sim-channel-select">{msg.simulationChannelLabel}</label>
        <select id="sim-channel-select" value={channel} onChange={(e) => setChannel(e.target.value as ChannelType)}>
          {CHANNEL_TYPE_ORDER.map((c) => (
            <option key={c} value={c}>
              {CHANNEL_TYPE_LABELS[c]}
            </option>
          ))}
        </select>
      </div>

      <div className="chat-message-list" role="log" aria-live="polite" aria-relevant="additions">
        {messages.map((m) => (
          <div key={m.id} className="chat-bubble-wrapper">
            {m.role !== 'error' && <SimulationBadge />}
            <ChatBubble message={m} chatbotId={chatbotId} onButtonClick={handleButtonClick} onRetry={() => undefined} />
          </div>
        ))}
        {sending && (
          <div className="chat-bubble chat-bubble--bot chat-bubble--typing" role="status">
            <span aria-hidden="true">●●●</span> {MESSAGES.simulator.sending}
          </div>
        )}
      </div>

      <MessageComposer disabled={sending || !chatbotId} onSend={(text) => void handleSend(text)} />
      <p className="field-hint">{msg.simulationNotRealNotice}</p>
      <p className="field-hint">{msg.simulationRefreshResetNotice}</p>
    </section>
  );
}
