import type { TraceStep } from '@chat-bot/shared-types';
import { MESSAGES } from '../../../constants/messages';

const DEEP_LINK_STAGE: Partial<Record<TraceStep['stage'], (chatbotId: string, targetId: string) => string>> = {
  NODE: (chatbotId, targetId) => `/chatbots/${chatbotId}/dialogue/nodes/${targetId}`,
};
const LIST_LINK_STAGE: Partial<Record<TraceStep['stage'], (chatbotId: string) => string>> = {
  INTENT: (chatbotId) => `/chatbots/${chatbotId}/dialogue/intents`,
  HOMONYM: (chatbotId) => `/chatbots/${chatbotId}/dialogue/homonyms`,
  FAQ: (chatbotId) => `/chatbots/${chatbotId}/dialogue/faqs`,
};

/** trace 1건 — 한국어 레이블 + `href` 기반 편집 이동 링크(FR-10-9, NFR-A5). */
export function TraceStepRow({ step, chatbotId }: { step: TraceStep; chatbotId: string }): JSX.Element {
  const msg = MESSAGES.simulator;
  const stageLabel = msg.traceStage[step.stage];
  const codeLabel = msg.traceLabels[step.code] ?? step.code;
  const href = step.targetId
    ? (DEEP_LINK_STAGE[step.stage]?.(chatbotId, step.targetId) ?? LIST_LINK_STAGE[step.stage]?.(chatbotId))
    : undefined;

  return (
    <li className="trace-step-row">
      <span className="trace-step-stage">{stageLabel}</span>
      <span className="trace-step-code">{codeLabel}</span>
      {step.targetName && <span className="trace-step-target">{step.targetName}</span>}
      {step.message && <span className="trace-step-message">{step.message}</span>}
      {href && (
        <a className="trace-step-link" href={href}>
          {msg.tracePanel.editLink}
        </a>
      )}
    </li>
  );
}
