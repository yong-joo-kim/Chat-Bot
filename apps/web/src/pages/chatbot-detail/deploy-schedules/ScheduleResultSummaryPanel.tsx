import { Link } from 'react-router-dom';
import type { DeployScheduleDetail, PostRunTestOutcome } from '@chat-bot/shared-types';
import { MESSAGES } from '../../../constants/messages';

function PostRunTestResult({ chatbotId, outcome }: { chatbotId: string; outcome: PostRunTestOutcome }): JSX.Element {
  const msg = MESSAGES.deploySchedules.detail;
  if (outcome.status === 'STARTED' && outcome.testRunId) {
    return (
      <p>
        <Link to={`/chatbots/${chatbotId}/validation/runs/${outcome.testRunId}`}>{msg.tcResultLink}</Link>
      </p>
    );
  }
  return <p>{msg.postRunTestSkipped}</p>;
}

/**
 * `resultSummary` 판별 유니온 렌더(`scheduled-deploy-ui-spec.md` §4.2.1-(B), §설계서 §13.2). RESTORE
 * 변형의 `backupVersionNo`/`backupVersionId`는 `outcome==='NOOP'`일 때 값이 없을 수 있다(백엔드
 * 리뷰 반영 — 항상 존재한다고 가정하지 않는다).
 */
export function ScheduleResultSummaryPanel({ chatbotId, detail }: { chatbotId: string; detail: DeployScheduleDetail }): JSX.Element | null {
  const summary = detail.resultSummary;
  if (!summary) return null;
  const msg = MESSAGES.deploySchedules.detail;

  if (summary.kind === 'RESTORE') {
    const isNoop = detail.outcome === 'NOOP';
    return (
      <div className="schedule-result-summary">
        {!isNoop && summary.backupVersionNo !== undefined && summary.backupVersionId !== undefined && (
          <p>
            {msg.revertLink(summary.backupVersionNo)}{' '}
            <Link to={`/chatbots/${chatbotId}/versions/${summary.backupVersionId}/content`}>{msg.revertAction}</Link>
          </p>
        )}
        {isNoop && <p>{msg.noopNotice}</p>}
        {detail.outcome === 'RECOVERED' && <p>{msg.recoveredNotice}</p>}
        {(detail.delaySeconds ?? 0) > 0 && <p>{msg.delayedNotice(detail.delaySeconds as number)}</p>}
        {summary.reindexWasRunning && <p>{MESSAGES.versions.restore.result.reindexContinueNotice}</p>}
        {summary.classifierDeleted && <p>{MESSAGES.versions.restore.result.classifierDeletedNotice}</p>}
        {summary.postRunTest && <PostRunTestResult chatbotId={chatbotId} outcome={summary.postRunTest} />}
      </div>
    );
  }

  if (summary.kind === 'PUBLISH') {
    return (
      <div className="schedule-result-summary">
        <p>
          {summary.statusBefore} → {summary.statusAfter}
        </p>
        {summary.channelBefore !== summary.channelAfter && (
          <p>
            {String(summary.channelBefore ?? '—')} → {String(summary.channelAfter)}
          </p>
        )}
        {summary.postRunTest && <PostRunTestResult chatbotId={chatbotId} outcome={summary.postRunTest} />}
      </div>
    );
  }

  return (
    <div className="schedule-result-summary">
      <p>
        {String(summary.channelBefore ?? '—')} → {String(summary.channelAfter)}
      </p>
    </div>
  );
}
