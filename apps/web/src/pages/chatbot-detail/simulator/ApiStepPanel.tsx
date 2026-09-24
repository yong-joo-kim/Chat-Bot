import { useId, useState } from 'react';
import type { ApiStepView } from '@chat-bot/shared-types';
import { MESSAGES } from '../../../constants/messages';

/**
 * SIM1-ext — "외부 API 단계" 패널(`legacy-api-integration-ui-spec.md` §3.7). `TracePanel`과 동일한
 * 접이식(`aria-expanded`) 토글 패턴이며 기본 접힘이다. `variables`는 서버가 이미 마스킹한 값을
 * 그대로 렌더링한다 — 클라이언트가 다시 마스킹하지 않는다(이중 마스킹 방지, ui-spec §9-7).
 */
export function ApiStepPanel({ apiStep }: { apiStep: ApiStepView }): JSX.Element {
  const msg = MESSAGES.simulator;
  const [open, setOpen] = useState(false);
  const panelId = useId();

  const statusLine = apiStep.mode === 'LIVE' && !apiStep.downgradeReason ? msg.apiStepLive(apiStep.latencyMs ?? 0) : null;
  const mockLine = (apiStep.mode === 'MOCK' && !apiStep.downgradeReason) ? msg.apiStepMock(apiStep.sampleLabel ?? '') : null;
  const downgradedLine = apiStep.downgradeReason ? msg.apiStepDowngraded(apiStep.downgradeReason) : null;
  // MOCK 라벨이 연결 샘플에 없으면 서버가 실패 분기를 재현하고 `noSample: true`를 준다.
  const noSample = apiStep.noSample === true;

  return (
    <div className="trace-panel api-step-panel">
      <button type="button" className="trace-panel-toggle" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen((o) => !o)}>
        {msg.apiStepTitle} <span aria-hidden="true">{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <div id={panelId} className="api-step-detail">
          <p>
            {msg.apiStepConnection}: {apiStep.connectionName} · {apiStep.method} {apiStep.pathTemplate} · {msg.apiStepBranch}:{' '}
            {apiStep.conditionIndex !== undefined ? MESSAGES.apiCallLogs.branchCondition(apiStep.conditionIndex) : apiStep.branch}
          </p>
          {apiStep.variables.length > 0 && (
            <p>
              {msg.apiStepVariables}: {apiStep.variables.map((v) => `${v.name}=${v.value}`).join(', ')}
            </p>
          )}
          {statusLine && (
            <p className="field-hint">
              <span aria-hidden="true">ⓘ</span> {statusLine}
            </p>
          )}
          {mockLine && (
            <p className="field-hint">
              <span aria-hidden="true">ⓘ</span> {mockLine}
            </p>
          )}
          {downgradedLine && (
            <p className="field-hint">
              <span aria-hidden="true">ⓘ</span> {downgradedLine}
            </p>
          )}
          {noSample && (
            <p className="field-hint field-hint--warning">
              <span aria-hidden="true">ⓘ</span> {msg.apiStepNoSample}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
