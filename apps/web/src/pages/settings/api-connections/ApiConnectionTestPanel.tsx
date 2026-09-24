import { useState } from 'react';
import type { ApiConnectionTestResult } from '@chat-bot/shared-types';
import { apiConnectionsApi } from '../../../api/apiConnections';
import { ApiError } from '../../../api/client';
import { MESSAGES } from '../../../constants/messages';

export interface ApiConnectionTestPanelProps {
  connectionId: string;
  disabled?: boolean;
}

/**
 * AC1 — 연결 테스트(ui-spec §3.1.3). 결과는 상태 코드·지연·바이트 수·JSON 파싱 가능 여부만 보여주고
 * 본문은 절대 표시하지 않는다(FR-L2-5). 결과 영역은 `aria-live="polite"`로 스크린리더가 자동으로 읽는다.
 */
export function ApiConnectionTestPanel({ connectionId, disabled }: ApiConnectionTestPanelProps): JSX.Element {
  const msg = MESSAGES.apiConnections;
  const [path, setPath] = useState('/');
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<ApiConnectionTestResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  function guidanceFor(result: ApiConnectionTestResult): string {
    if (result.guidance) return result.guidance;
    return '';
  }

  async function handleTest(): Promise<void> {
    setTesting(true);
    setError(null);
    setResult(null);
    try {
      const res = await apiConnectionsApi.test(connectionId, { path });
      setResult(res);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : MESSAGES.errors.generic);
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="form-field api-connection-test-panel">
      <span className="field-label-static">{msg.testPanelTitle}</span>
      <div className="key-value-row">
        <div className="form-field">
          <label htmlFor="api-connection-test-path">{msg.testPathLabel}</label>
          <input id="api-connection-test-path" type="text" maxLength={300} value={path} onChange={(e) => setPath(e.target.value)} />
        </div>
        <button type="button" className="btn btn-secondary" onClick={() => void handleTest()} disabled={disabled || testing}>
          {testing ? MESSAGES.common.saving : msg.testButton}
        </button>
      </div>
      <div role="status" aria-live="polite" className="api-connection-test-result">
        {result && result.outcome === 'SUCCESS' && (
          <p className="form-banner form-banner--success">
            {msg.testSuccess(result.httpStatus ?? 0, result.latencyMs)}
          </p>
        )}
        {result && result.outcome !== 'SUCCESS' && (
          <p className="form-banner form-banner--error" role="alert">
            <span aria-hidden="true">✖</span> {guidanceFor(result)}
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
