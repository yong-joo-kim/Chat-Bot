import { useChatbotDetailContext } from '../ChatbotDetailLayout';
import { AnswerSettingsPage } from './answer-settings/AnswerSettingsPage';

/** AS1 — AI 답변 설정 탭(`/chatbots/:chatbotId/answer-settings`, `nlu-rag-answering-ui-spec.md` §4.1). */
export function AnswerSettingsTab(): JSX.Element {
  const { chatbot, setUnsavedGuard } = useChatbotDetailContext();
  return <AnswerSettingsPage chatbotId={chatbot.id} isArchived={chatbot.status === 'ARCHIVED'} setUnsavedGuard={setUnsavedGuard} />;
}
