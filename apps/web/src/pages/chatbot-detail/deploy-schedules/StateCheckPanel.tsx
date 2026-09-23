import { useState } from 'react';
import type { DeployScheduleStateCheck } from '@chat-bot/shared-types';
import { deploySchedulesApi } from '../../../api/deploySchedules';
import { MESSAGES } from '../../../constants/messages';
import { SeverityBadge } from '../../../components/SeverityBadge';
import { formatScheduleDateTime } from '../../../lib/scheduleTime';

/** "지금 기준 상태 점검"(`scheduled-deploy-ui-spec.md` §4.2.1) — DB 변경 0, 클릭 시에만 조회한다. */
export function StateCheckPanel({ chatbotId, scheduleId, timezone }: { chatbotId: string; scheduleId: string; timezone: string }): JSX.Element {
  const msg = MESSAGES.deploySchedules.detail;
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<DeployScheduleStateCheck | null>(null);
  const [error, setError] = useState(false);

  async function handleCheck(): Promise<void> {
    setChecking(true);
    setError(false);
    try {
      const res = await deploySchedulesApi.stateCheck(chatbotId, scheduleId);
      setResult(res);
    } catch {
      setError(true);
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="state-check-panel">
      <button type="button" className="btn btn-secondary" onClick={() => void handleCheck()} disabled={checking}>
        {msg.stateCheckButton}
      </button>{' '}
      {checking ? (
        <span role="status" aria-live="polite">
          {msg.stateCheckChecking}
        </span>
      ) : result ? (
        <span>{msg.stateCheckAt(formatScheduleDateTime(result.checkedAt, timezone))}</span>
      ) : (
        <span>{msg.stateCheckNotChecked}</span>
      )}
      {error && (
        <p className="field-error" role="alert">
          {MESSAGES.errors.generic}
        </p>
      )}
      {result && !result.matches && result.applicable && <SeverityBadge severity="WARNING" label={msg.stateCheckMismatch} />}
    </div>
  );
}
