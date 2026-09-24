import { useState } from 'react';
import type { ApiCallOutcome, SimulateMockResponse } from '@chat-bot/shared-types';
import { MESSAGES } from '../../../constants/messages';

type SourceKind = 'sample' | 'manual' | 'failure';

const FAILURE_OPTIONS: ApiCallOutcome[] = ['TIMEOUT', 'HTTP_ERROR', 'INVALID_RESPONSE'];

export interface MockResponseSelectorProps {
  value: SimulateMockResponse | undefined;
  onChange: (value: SimulateMockResponse | undefined) => void;
}

/**
 * SIM1-ext — 봇 응답을 재현할 목 원천 선택(ui-spec §3.7 `MockResponseSelector`). 전송 **전에**
 * 미리 지정해 요청의 `mockResponse`에 싣는다. ⚠ 구현 메모: ui-spec 원안은 `connectionId` 기준으로
 * 연결 샘플 드롭다운을 보여주지만, 시뮬레이터는 메시지 전송 전에는 어떤 노드/연결이 매칭될지 알 수
 * 없어(같은 턴의 매칭 결과에 달려 있음) `connectionId`를 미리 받을 수 없다. 그래서 "연결 샘플"은
 * 라벨 자유 입력(서버가 매칭된 노드의 연결에서 같은 라벨을 찾는다)으로 단순화했다 — 최종 보고에 기재.
 */
export function MockResponseSelector({ value, onChange }: MockResponseSelectorProps): JSX.Element {
  const msg = MESSAGES.simulator;
  const initialKind: SourceKind = value && 'failure' in value ? 'failure' : value && 'httpStatus' in value ? 'manual' : 'sample';
  const [kind, setKind] = useState<SourceKind>(initialKind);
  const [sampleLabel, setSampleLabel] = useState(value && 'sampleLabel' in value ? value.sampleLabel : '');
  const [manualStatus, setManualStatus] = useState(value && 'httpStatus' in value ? value.httpStatus : 200);
  const [manualBody, setManualBody] = useState(value && 'httpStatus' in value ? JSON.stringify(value.body, null, 2) : '{}');
  const [failure, setFailure] = useState<ApiCallOutcome>(value && 'failure' in value ? value.failure : 'TIMEOUT');

  function applyKind(next: SourceKind): void {
    setKind(next);
    if (next === 'sample') {
      onChange(sampleLabel ? { sampleLabel } : undefined);
    } else if (next === 'manual') {
      try {
        onChange({ httpStatus: manualStatus, body: JSON.parse(manualBody) });
      } catch {
        onChange(undefined);
      }
    } else {
      onChange({ failure });
    }
  }

  return (
    <fieldset className="mock-response-selector form-field">
      <legend>{msg.mockSourceLabel}</legend>
      <label className="form-field--inline">
        <input type="radio" name="mock-source" checked={kind === 'sample'} onChange={() => applyKind('sample')} />
        {msg.mockSourceSample}
      </label>
      <label className="form-field--inline">
        <input type="radio" name="mock-source" checked={kind === 'manual'} onChange={() => applyKind('manual')} />
        {msg.mockSourceManual}
      </label>
      <label className="form-field--inline">
        <input type="radio" name="mock-source" checked={kind === 'failure'} onChange={() => applyKind('failure')} />
        {msg.mockSourceFailure}
      </label>

      {kind === 'sample' && (
        <div className="form-field">
          <label htmlFor="mock-sample-label">{msg.mockSourceSampleLabelInput}</label>
          <input
            id="mock-sample-label"
            type="text"
            maxLength={50}
            value={sampleLabel}
            onChange={(e) => {
              setSampleLabel(e.target.value);
              onChange(e.target.value ? { sampleLabel: e.target.value } : undefined);
            }}
          />
        </div>
      )}

      {kind === 'manual' && (
        <div className="key-value-row">
          <div className="form-field">
            <label htmlFor="mock-manual-status">상태코드</label>
            <input
              id="mock-manual-status"
              type="number"
              min={100}
              max={599}
              value={manualStatus}
              onChange={(e) => {
                const status = Number(e.target.value);
                setManualStatus(status);
                try {
                  onChange({ httpStatus: status, body: JSON.parse(manualBody) });
                } catch {
                  onChange(undefined);
                }
              }}
            />
          </div>
          <div className="form-field">
            <label htmlFor="mock-manual-body">본문(JSON)</label>
            <textarea
              id="mock-manual-body"
              rows={3}
              value={manualBody}
              onChange={(e) => {
                setManualBody(e.target.value);
                try {
                  onChange({ httpStatus: manualStatus, body: JSON.parse(e.target.value) });
                } catch {
                  onChange(undefined);
                }
              }}
            />
          </div>
        </div>
      )}

      {kind === 'failure' && (
        <div className="form-field">
          <label htmlFor="mock-failure">{msg.mockSourceFailureLabel}</label>
          <select
            id="mock-failure"
            value={failure}
            onChange={(e) => {
              const next = e.target.value as ApiCallOutcome;
              setFailure(next);
              onChange({ failure: next });
            }}
          >
            {FAILURE_OPTIONS.map((o) => (
              <option key={o} value={o}>
                {MESSAGES.apiCallLogs.outcomeLabel[o]}
              </option>
            ))}
          </select>
        </div>
      )}
    </fieldset>
  );
}
