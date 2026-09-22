import type { MatchTrace } from '@chat-bot/shared-types';
import { MESSAGES } from '../../../constants/messages';

/**
 * 시뮬레이터 결과에 붙는 매칭 근거 확장 패널(ui-spec §4.2.3). `SimulateResponseSchema.matchTrace`를
 * 바인딩하며 `TracePanel` 펼침 영역 안에 렌더한다(관리자 API 전용, AC-N3-8).
 */
export function MatchScorePanel({ matchTrace }: { matchTrace: MatchTrace }): JSX.Element {
  const msg = MESSAGES.simulator.matchScorePanel;

  return (
    <div className="match-score-panel">
      <p className="match-score-band">
        <strong>{msg.bandLabel[matchTrace.band]}</strong>
      </p>
      <ol className="match-score-candidates">
        {[0, 1, 2].map((i) => {
          const c = matchTrace.top3[i];
          return (
            <li key={i}>
              {msg.rankLabel(i + 1)}{' '}
              {c ? (
                <>
                  {c.label}({c.kind}) {c.score.toFixed(2)}
                </>
              ) : (
                msg.noneLabel
              )}
            </li>
          );
        })}
      </ol>
      {matchTrace.ragUsed ? (
        <p className="match-score-rag-row">
          {msg.ragUsedRow(((matchTrace.ragLatencyMs ?? 0) / 1000).toFixed(1), matchTrace.ragSourceCount ?? 0)}
        </p>
      ) : (
        matchTrace.band === 'FAILED' && <p className="match-score-rag-row">{msg.ragSkippedRow}</p>
      )}
    </div>
  );
}
