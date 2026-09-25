import { useId, useState } from 'react';
import type { MatchTrace, ResolvedBundleTarget, TraceStep } from '@chat-bot/shared-types';
import { MESSAGES } from '../../../constants/messages';
import { TargetBadge } from '../../../components/TargetBadge';
import { TraceStepRow } from './TraceStepRow';
import { MatchScorePanel } from './MatchScorePanel';

/**
 * 메시지별 판정 근거 토글(FR-10-9). 기본 접힘, 키보드로 펼칠 수 있다(`aria-expanded`).
 * `matchTrace`(FR-N3-10)가 있으면 같은 펼침 영역 안에 `MatchScorePanel`을 함께 보여준다(ui-spec §4.2.3).
 * [신규 No.40] `target`(비초안 대상일 때만)이 있으면 "대상: 운영(v43)" 줄을 함께 보여준다(§4.13).
 */
export function TracePanel({
  trace,
  chatbotId,
  matchTrace,
  target,
}: {
  trace: TraceStep[];
  chatbotId: string;
  matchTrace?: MatchTrace;
  target?: ResolvedBundleTarget;
}): JSX.Element | null {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  if (trace.length === 0 && !matchTrace && !target) return null;
  const msg = MESSAGES.simulator.tracePanel;

  return (
    <div className="trace-panel">
      <button type="button" className="trace-panel-toggle" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen((o) => !o)}>
        {open ? msg.toggleHide : msg.toggleShow} <span aria-hidden="true">{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <div id={panelId}>
          {target && (
            <p className="field-hint">
              <TargetBadge target={target} />
            </p>
          )}
          {matchTrace && <MatchScorePanel matchTrace={matchTrace} />}
          {trace.length > 0 && (
            <ul className="trace-step-list">
              {trace.map((step, i) => (
                <TraceStepRow key={i} step={step} chatbotId={chatbotId} />
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
