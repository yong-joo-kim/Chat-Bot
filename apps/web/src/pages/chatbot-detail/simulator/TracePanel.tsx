import { useId, useState } from 'react';
import type { TraceStep } from '@chat-bot/shared-types';
import { MESSAGES } from '../../../constants/messages';
import { TraceStepRow } from './TraceStepRow';

/** 메시지별 판정 근거 토글(FR-10-9). 기본 접힘, 키보드로 펼칠 수 있다(`aria-expanded`). */
export function TracePanel({ trace, chatbotId }: { trace: TraceStep[]; chatbotId: string }): JSX.Element | null {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  if (trace.length === 0) return null;
  const msg = MESSAGES.simulator.tracePanel;

  return (
    <div className="trace-panel">
      <button type="button" className="trace-panel-toggle" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen((o) => !o)}>
        {open ? msg.toggleHide : msg.toggleShow} <span aria-hidden="true">{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <ul id={panelId} className="trace-step-list">
          {trace.map((step, i) => (
            <TraceStepRow key={i} step={step} chatbotId={chatbotId} />
          ))}
        </ul>
      )}
    </div>
  );
}
