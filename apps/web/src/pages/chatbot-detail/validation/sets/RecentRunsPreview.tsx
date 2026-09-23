import { Link } from 'react-router-dom';
import type { TestRun } from '@chat-bot/shared-types';
import { MESSAGES } from '../../../../constants/messages';

/** V2 하단 "최근 실행 5건" 미니 목록(ui-spec §4.2). */
export function RecentRunsPreview({ chatbotId, runs }: { chatbotId: string; runs: TestRun[] }): JSX.Element {
  const msg = MESSAGES.validation.recentRuns;
  const runMsg = MESSAGES.validation.run;
  return (
    <div className="recent-runs-preview">
      <h3>{msg.title}</h3>
      {runs.length === 0 ? (
        <p className="field-hint">{msg.empty}</p>
      ) : (
        <ul>
          {runs.map((r) => (
            <li key={r.id}>
              {new Date(r.createdAt).toLocaleString('ko-KR')} · {runMsg.statusLabel[r.status]}
              {r.summary && ` · ${MESSAGES.validation.set.summaryLine(r.summary.a.pass, r.summary.a.fail, r.summary.a.unresolved)}`}{' '}
              <Link to={`/chatbots/${chatbotId}/validation/runs/${r.id}`}>{msg.resultLink}</Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
