import { useState } from 'react';
import type { WorkflowTestSendResult } from '@chat-bot/shared-types';
import { workflowTargetsApi } from '../../../api/workflowTargets';
import { ApiError } from '../../../api/client';
import { MESSAGES } from '../../../constants/messages';

export interface WorkflowTargetTestPanelProps {
  targetId: string;
  disabled?: boolean;
}

/**
 * WF1 — 테스트 발송(`WorkflowTargetTestPanel`, ui-spec §3.1.3, `ApiConnectionTestPanel`과 동형).
 * 결과는 서버가 이미 완성한 `guidance` 문자열을 그대로 표시한다(원인+해결 포함, §13-5 확정 유지) —
 * 클라이언트가 코드별 안내를 재구현하지 않는다. 받는 쪽 응답 본문은 절대 표시하지 않는다.
 */
export function WorkflowTargetTestPanel({ targetId, disabled }: WorkflowTargetTestPanelProps): JSX.Element {
  const msg = MESSAGES.workflowTargets;
  const [actionKey, setActionKey] = useState('');
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<WorkflowTestSendResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleTest(): Promise<void> {
    setTesting(true);
    setError(null);
    setResult(null);
    try {
      const res = await workflowTargetsApi.test(targetId, { actionKey: actionKey.trim() || undefined });
      setResult(res);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : MESSAGES.errors.generic);
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="form-field workflow-target-test-panel">
      <span className="field-label-static">{msg.testPanelTitle}</span>
      <div className="key-value-row">
        <div className="form-field">
          <label htmlFor="workflow-target-test-action-key">{msg.testActionKeyLabel}</label>
          <input
            id="workflow-target-test-action-key"
            type="text"
            maxLength={60}
            value={actionKey}
            onChange={(e) => setActionKey(e.target.value)}
          />
        </div>
        <button type="button" className="btn btn-secondary" onClick={() => void handleTest()} disabled={disabled || testing}>
          {testing ? MESSAGES.common.saving : msg.testButton}
        </button>
      </div>
      <div role="status" aria-live="polite" className="workflow-target-test-result">
        {result && result.outcome === 'SUCCESS' && (
          <p className="form-banner form-banner--success">{msg.testSuccess(result.httpStatus ?? 0, result.latencyMs)}</p>
        )}
        {result && result.outcome !== 'SUCCESS' && (
          <p className="form-banner form-banner--error" role="alert">
            <span aria-hidden="true">✖</span> {result.guidance}
          </p>
        )}
        {result?.targetDisabled && (
          <p className="field-hint">
            <span aria-hidden="true">ⓘ</span> {msg.testDisabledNotice}
          </p>
        )}
        {result?.targetPaused && !result.targetDisabled && (
          <p className="field-hint">
            <span aria-hidden="true">ⓘ</span> {msg.testPausedNotice}
          </p>
        )}
        {error && (
          <p className="form-banner form-banner--error" role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
