import type { ButtonActionView } from '@chat-bot/shared-types/output-view';
import { MESSAGES } from '../../../constants/messages';
import { ChatBubble } from './ChatBubble';
import type { SimMessage } from './types';

/** 메시지 목록(사용자/봇 말풍선) — 응답 대기 중에는 타이핑 인디케이터를 표시한다(UIUX §8). */
export function ChatMessageList({
  messages,
  chatbotId,
  sending,
  sendingLabel,
  onButtonClick,
  onRetry,
}: {
  messages: SimMessage[];
  chatbotId: string;
  sending: boolean;
  /** `useRag` 턴은 "문서에서 찾아보고 있어요"로 문구를 전환한다(ui-spec §4.2.2). 기본은 §{sending}. */
  sendingLabel?: string;
  onButtonClick: (action: ButtonActionView) => void;
  onRetry: (message: SimMessage) => void;
}): JSX.Element {
  return (
    <div className="chat-message-list" role="log" aria-live="polite" aria-relevant="additions">
      {messages.map((m) => (
        <ChatBubble key={m.id} message={m} chatbotId={chatbotId} onButtonClick={onButtonClick} onRetry={onRetry} />
      ))}
      {sending && (
        <div className="chat-bubble chat-bubble--bot chat-bubble--typing" role="status">
          <span aria-hidden="true">●●●</span> {sendingLabel ?? MESSAGES.simulator.sending}
        </div>
      )}
    </div>
  );
}
