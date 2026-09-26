import { useId, useState } from 'react';
import type { WorkflowStepView } from '@chat-bot/shared-types';
import { MESSAGES } from '../../../constants/messages';

/**
 * SIM1-ext — "업무 요청(모의)" 단계 패널(`workflow-automation-ui-spec.md` §3.6, `ApiStepPanel`과 동형
 * 접이식). 실제로는 전송되지 않는다는 것을 항상 알린다(FR-WF2-7 · J-13) — LIVE/MOCK 토글과 무관하다.
 */
export function WorkflowStepPanel({ step }: { step: WorkflowStepView }): JSX.Element {
  const msg = MESSAGES.simulator;
  const [open, setOpen] = useState(false);
  const panelId = useId();

  const targetLabel =
    step.targetState === 'MISSING' ? msg.workflowStepMissing : step.targetName ?? msg.workflowStepMissing;

  return (
    <div className="trace-panel workflow-step-panel">
      <button type="button" className="trace-panel-toggle" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen((o) => !o)}>
        {msg.workflowStepTitle} <span aria-hidden="true">{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <div id={panelId} className="workflow-step-detail">
          <p>
            {msg.workflowStepTarget}: {targetLabel} · {msg.workflowStepAction}: {step.actionKey}
          </p>
          {step.fields.length > 0 && (
            <p>
              {msg.workflowStepFields}:{' '}
              {/* [코드리뷰 R1 M-3] 서버가 내려준 값을 그대로 보여준다 — 클라이언트가 일괄 마스킹하지
                  않는다(이중 마스킹 방지). 필드별 `masked:true`일 때만 접미사를 붙인다. */}
              {step.fields
                .map((f) => `${f.name}=${f.value}${f.masked ? msg.workflowStepFieldMaskedSuffix : ''}`)
                .join(', ')}
              {step.rawPersonalData && ` (${msg.workflowStepRawPersonalData})`}
            </p>
          )}
          {step.bindingMissing ? (
            <p className="field-hint field-hint--warning">
              <span aria-hidden="true">ⓘ</span> {msg.workflowStepBindingMissing}
            </p>
          ) : (
            <p className="field-hint">
              <span aria-hidden="true">ⓘ</span> {msg.workflowStepNotSent}
            </p>
          )}
          {step.targetState === 'DISABLED' && (
            <p className="field-hint field-hint--warning">{msg.workflowStepTargetDisabled}</p>
          )}
          {step.targetState === 'PAUSED' && <p className="field-hint field-hint--warning">{msg.workflowStepTargetPaused}</p>}
          {step.targetState === 'SECRET_MISSING' && (
            <p className="field-hint field-hint--warning">{msg.workflowStepSecretMissing}</p>
          )}
        </div>
      )}
    </div>
  );
}
