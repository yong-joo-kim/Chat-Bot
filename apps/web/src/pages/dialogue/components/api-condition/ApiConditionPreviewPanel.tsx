import { useEffect, useState } from 'react';
import type { ApiConditionOutputPayloadV2, ApiSampleResponse } from '@chat-bot/shared-types';
import { buildApiVariables, evaluateApiConditions, renderApiTokens } from '@chat-bot/shared-types';
import { apiConnectionsApi } from '../../../../api/apiConnections';
import { dialogNodesApi } from '../../../../api/dialogue';
import { MESSAGES } from '../../../../constants/messages';

export interface ApiConditionPreviewPanelProps {
  payload: ApiConditionOutputPayloadV2;
  chatbotId: string;
}

type SubstitutionState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ok'; text: string }
  | { status: 'noTarget' }
  | { status: 'noTextOutput' }
  | { status: 'error' };

/**
 * D1a-v2 — 샘플 응답 미리보기(`legacy-api-integration-ui-spec.md` §3.4 `ApiConditionPreviewPanel`).
 * 서버 왕복 없이 공유 순수 함수(`@chat-bot/shared-types`의 `buildApiVariables`/`evaluateApiConditions`)를
 * 브라우저에서 직접 호출한다(엔진·시뮬레이터와 동일한 판정 로직). 순수 진단이며 저장을 막지 않는다.
 * "치환 미리보기"는 선택된 분기(일치 조건 또는 불일치 시 기본 분기) 노드를 1회 조회해 그 노드의 첫 TEXT
 * 아웃풋에 `renderApiTokens()`(엔진 `outputs.ts`와 동일 함수)를 적용한다(§3.4).
 */
export function ApiConditionPreviewPanel({ payload, chatbotId }: ApiConditionPreviewPanelProps): JSX.Element {
  const msg = MESSAGES.dialogue.outputFields;
  const [source, setSource] = useState<'sample' | 'manual'>('sample');
  const [samples, setSamples] = useState<ApiSampleResponse[]>([]);
  const [selectedLabel, setSelectedLabel] = useState('');
  const [manualJson, setManualJson] = useState('{}');
  const [result, setResult] = useState<{ vars: Record<string, string>; matchedIndex: number | null; missingRequired: string[] } | null>(null);
  const [substitution, setSubstitution] = useState<SubstitutionState>({ status: 'idle' });

  useEffect(() => {
    if (!payload.connectionId) {
      setSamples([]);
      return;
    }
    let cancelled = false;
    apiConnectionsApi
      .samples(payload.connectionId)
      .then((res) => {
        if (cancelled) return;
        setSamples(res.items);
        if (res.items.length > 0) setSelectedLabel(res.items[0].label);
      })
      .catch(() => setSamples([]));
    return () => {
      cancelled = true;
    };
  }, [payload.connectionId]);

  async function loadSubstitution(vars: Record<string, string>, matchedIndex: number | null): Promise<void> {
    const targetNodeId = matchedIndex !== null ? payload.conditions[matchedIndex]?.nextNodeId : payload.defaultNodeId;
    if (!targetNodeId) {
      setSubstitution({ status: 'noTarget' });
      return;
    }
    setSubstitution({ status: 'loading' });
    try {
      const node = await dialogNodesApi.findOne(chatbotId, targetNodeId);
      const firstText = node.outputs.find((o) => o.type === 'TEXT');
      if (!firstText || firstText.type !== 'TEXT') {
        setSubstitution({ status: 'noTextOutput' });
        return;
      }
      setSubstitution({ status: 'ok', text: renderApiTokens(firstText.payload.text, vars) });
    } catch {
      setSubstitution({ status: 'error' });
    }
  }

  function runPreview(): void {
    let json: unknown;
    if (source === 'sample') {
      const sample = samples.find((s) => s.label === selectedLabel);
      if (!sample) return;
      json = sample.body;
    } else {
      try {
        json = JSON.parse(manualJson);
      } catch {
        return;
      }
    }
    const { vars, missingRequired } = buildApiVariables(json, payload.responseMappings);
    const matchedIndex = evaluateApiConditions(json, payload.conditions);
    setResult({ vars, matchedIndex, missingRequired });
    void loadSubstitution(vars, matchedIndex);
  }

  return (
    <div className="dialogue-panel api-condition-preview-panel">
      <p className="field-label-static">{msg.apiPreviewTitle}</p>
      <div className="form-field--inline">
        <label className="form-field--inline">
          <input type="radio" name="api-preview-source" checked={source === 'sample'} onChange={() => setSource('sample')} />
          {msg.apiPreviewSourceSample}
        </label>
        <label className="form-field--inline">
          <input type="radio" name="api-preview-source" checked={source === 'manual'} onChange={() => setSource('manual')} />
          {msg.apiPreviewSourceManual}
        </label>
      </div>

      {source === 'sample' &&
        (samples.length === 0 ? (
          <p className="field-hint">{msg.apiPreviewNoSamples}</p>
        ) : (
          <div className="form-field">
            <label htmlFor="api-preview-sample">{msg.apiPreviewTextSample}</label>
            <select id="api-preview-sample" value={selectedLabel} onChange={(e) => setSelectedLabel(e.target.value)}>
              {samples.map((s) => (
                <option key={s.label} value={s.label}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
        ))}

      {source === 'manual' && (
        <div className="form-field">
          <label htmlFor="api-preview-manual">JSON</label>
          <textarea id="api-preview-manual" rows={3} value={manualJson} onChange={(e) => setManualJson(e.target.value)} />
        </div>
      )}

      <button type="button" className="btn btn-secondary" onClick={runPreview}>
        {msg.apiPreviewButton}
      </button>

      {result && (
        <div className="api-preview-result" role="status" aria-live="polite">
          <p className="field-label-static">{msg.apiPreviewVariables}</p>
          <ul>
            {Object.entries(result.vars).map(([k, v]) => (
              <li key={k}>
                {k} = {v}
              </li>
            ))}
          </ul>
          {result.matchedIndex !== null ? (
            <p>{msg.apiPreviewMatchedCondition(result.matchedIndex + 1)}</p>
          ) : (
            <p>{msg.apiPreviewNoMatch}</p>
          )}
          {result.missingRequired.map((name) => (
            <p key={name} className="field-hint field-hint--warning">
              {msg.apiPreviewMissingRequired(name)}
            </p>
          ))}

          <p className="field-label-static">{msg.apiPreviewSubstitutionTitle}</p>
          {substitution.status === 'loading' && <p className="field-hint">{MESSAGES.common.saving}</p>}
          {substitution.status === 'ok' && <p className="api-preview-substitution-text">"{substitution.text}"</p>}
          {substitution.status === 'noTarget' && <p className="field-hint">{msg.apiPreviewSubstitutionNoTarget}</p>}
          {substitution.status === 'noTextOutput' && <p className="field-hint">{msg.apiPreviewSubstitutionNoTextOutput}</p>}
          {substitution.status === 'error' && <p className="field-hint field-hint--warning">{msg.apiPreviewSubstitutionLoadFailed}</p>}
        </div>
      )}
    </div>
  );
}
