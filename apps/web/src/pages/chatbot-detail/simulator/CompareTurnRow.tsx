import { useId, useState } from 'react';
import type { CompareResponse } from '@chat-bot/shared-types';
import { OutputRenderer } from '../../../components/OutputRenderer';
import { MESSAGES } from '../../../constants/messages';
import { DiffBadge } from './DiffBadge';
import { TracePanel } from './TracePanel';

type CompareTurn = CompareResponse['turns'][number];

/** 비교 결과 1행 — 좌(A)/우(B) 2단, 차이 행에 `변경됨` 배지(FR-10-28). */
export function CompareTurnRow({ turn, chatbotId }: { turn: CompareTurn; chatbotId: string }): JSX.Element {
  const msg = MESSAGES.simulator.compare;
  const [open, setOpen] = useState(false);
  const detailId = useId();
  const noop = (): void => undefined;

  return (
    <div className="compare-turn-row">
      <div className="compare-turn-header">
        <button type="button" className="compare-turn-toggle" aria-expanded={open} aria-controls={detailId} onClick={() => setOpen((o) => !o)}>
          {turn.index + 1}. {turn.message}
        </button>
        <DiffBadge status={turn.diff.status} />
      </div>
      <div className="compare-turn-columns">
        <div className="compare-turn-column">
          <p className="compare-turn-column-label">{msg.columnA}</p>
          {turn.a.matchedNodeName && <p className="chat-bubble-caption">{turn.a.matchedNodeName}</p>}
          {turn.a.outputs.length > 0 ? <OutputRenderer outputs={turn.a.outputs} onButtonClick={noop} /> : <p>{msg.noOutputs}</p>}
        </div>
        <div className="compare-turn-column">
          <p className="compare-turn-column-label">{msg.columnB}</p>
          {turn.b.matchedNodeName && <p className="chat-bubble-caption">{turn.b.matchedNodeName}</p>}
          {turn.b.outputs.length > 0 ? <OutputRenderer outputs={turn.b.outputs} onButtonClick={noop} /> : <p>{msg.noOutputs}</p>}
        </div>
      </div>
      {open && (
        <div id={detailId} className="compare-turn-detail">
          <div className="compare-turn-column">
            <TracePanel trace={turn.a.trace} chatbotId={chatbotId} />
          </div>
          <div className="compare-turn-column">
            <TracePanel trace={turn.b.trace} chatbotId={chatbotId} />
          </div>
        </div>
      )}
    </div>
  );
}
