import { useChatbotDetailContext } from '../ChatbotDetailLayout';
import { MESSAGES } from '../../constants/messages';
import { SimulatorPanel } from './simulator/SimulatorPanel';

/** SIM1 — 응답 테스트 탭(`/chatbots/:chatbotId/simulator`, FR-10-1~17). */
export function SimulatorTab(): JSX.Element {
  const { chatbot, environmentStatus } = useChatbotDetailContext();
  return (
    <div className="simulator-tab">
      <h2>{MESSAGES.simulator.title}</h2>
      <SimulatorPanel chatbotId={chatbot.id} isArchived={chatbot.status === 'ARCHIVED'} mode="tab" environmentStatus={environmentStatus} />
    </div>
  );
}
