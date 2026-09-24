import { useId, useState } from 'react';
import type { SurveyStepView } from '@chat-bot/shared-types';
import { MESSAGES } from '../../../constants/messages';
import { SurveyPreviewSavedBadge } from '../../dialogue/components/survey/badges';

/**
 * SIM1-ext — "설문 단계" 패널(`survey-management-ui-spec.md` §3.6 `SurveyStepPanel`). `TracePanel`과
 * 동일한 접이식(`aria-expanded`) 토글 패턴, 기본 접힘. 판정된 값은 다시 보여주지 않는다(FR-SV9-3).
 */
export function SurveyStepPanel({ step }: { step: SurveyStepView }): JSX.Element {
  const msg = MESSAGES.simulator;
  const [open, setOpen] = useState(false);
  const panelId = useId();

  const progress = step.questionIndex !== undefined ? `${step.questionIndex + 1}/${step.questionCount}` : `-/${step.questionCount}`;
  const outcomes = step.outcomes.map((o) => msg.surveyOutcomeLabel[o]).join(', ');

  return (
    <div className="trace-panel survey-step-panel">
      <button type="button" className="trace-panel-toggle" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen((o) => !o)}>
        {msg.surveyStepTitle} <span aria-hidden="true">{open ? '▴' : '▾'}</span>
      </button>{' '}
      <SurveyPreviewSavedBadge />
      {open && (
        <div id={panelId} className="survey-step-detail">
          <p>{msg.surveyStepLine(step.surveyName, progress, outcomes)}</p>
          {step.reason && <p className="field-hint">{step.reason}</p>}
        </div>
      )}
    </div>
  );
}
