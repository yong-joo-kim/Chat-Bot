import type { ButtonActionView } from '@chat-bot/shared-types/output-view';
import { OutputRenderer } from '../../../components/OutputRenderer';
import { SeverityBadge } from '../../../components/SeverityBadge';
import { MESSAGES } from '../../../constants/messages';
import { topicStatusLabel } from '../../dialogue/components/topicBadges';
import { TracePanel } from './TracePanel';
import { ApiStepPanel } from './ApiStepPanel';
import { SurveyStepPanel } from './SurveyStepPanel';
import { WorkflowStepPanel } from './WorkflowStepPanel';
import { OverlayBadge } from './OverlayBadge';
import type { SimMessage } from './types';

/** 말풍선 1개(SIM1/SIM1-D 공유, ui-spec §3.2). */
export function ChatBubble({
  message,
  chatbotId,
  onButtonClick,
  onRetry,
}: {
  message: SimMessage;
  chatbotId: string;
  onButtonClick: (action: ButtonActionView) => void;
  onRetry?: (message: SimMessage) => void;
}): JSX.Element {
  const msg = MESSAGES.simulator;

  if (message.role === 'user') {
    return (
      <div className="chat-bubble chat-bubble--user">
        <p className="chat-bubble-text">{message.text}</p>
      </div>
    );
  }

  if (message.role === 'system') {
    return (
      <div className="chat-bubble chat-bubble--system">
        <p className="chat-bubble-text">{message.text}</p>
      </div>
    );
  }

  if (message.role === 'error') {
    return (
      <div className="chat-bubble chat-bubble--error" role="alert">
        <p className="chat-bubble-text">
          <span aria-hidden="true">⚠</span> {message.text ?? msg.errorBubble.network}
        </p>
        {onRetry && (
          <button type="button" className="btn btn-secondary" onClick={() => onRetry(message)}>
            {MESSAGES.common.retry}
          </button>
        )}
      </div>
    );
  }

  const matchedCaption =
    (message.matchTrace?.ragUsed && msg.matchedCaption.rag(message.matchTrace.ragSourceCount ?? 0)) ||
    (message.matchedNodeName && msg.matchedCaption.node(message.matchedNodeName)) ||
    (message.matchedFaqQuestion && msg.matchedCaption.faq(message.matchedFaqQuestion)) ||
    (message.matchedIntentName && msg.matchedCaption.intent(message.matchedIntentName)) ||
    undefined;

  return (
    <div className="chat-bubble chat-bubble--bot">
      {message.overlayApplied && <OverlayBadge />}
      {matchedCaption && <p className="chat-bubble-caption">{matchedCaption}</p>}
      {message.outputs && message.outputs.length > 0 ? (
        <OutputRenderer outputs={message.outputs} onButtonClick={onButtonClick} />
      ) : (
        <p className="chat-bubble-text">{message.text}</p>
      )}
      {message.unsupportedOutputs && message.unsupportedOutputs.length > 0 && (
        <SeverityBadge
          severity="INFO"
          label={msg.unsupportedOutputsNotice(message.unsupportedOutputs.length, message.unsupportedOutputs.join('/'))}
        />
      )}
      {message.answeredTopic && (
        <p className="field-hint">{MESSAGES.topics.simulatorAnsweredTopic(message.answeredTopic.name, topicStatusLabel(message.answeredTopic.enabled ? 'ACTIVE' : 'INACTIVE'))}</p>
      )}
      {(message.trace || message.target) && (
        <TracePanel trace={message.trace ?? []} chatbotId={chatbotId} matchTrace={message.matchTrace} target={message.target} />
      )}
      {message.apiStep && <ApiStepPanel apiStep={message.apiStep} />}
      {message.surveyStep && <SurveyStepPanel step={message.surveyStep} />}
      {message.workflowSteps?.map((step, i) => <WorkflowStepPanel key={`${step.nodeId}-${i}`} step={step} />)}
    </div>
  );
}
