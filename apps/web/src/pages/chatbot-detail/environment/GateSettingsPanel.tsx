import { useEffect, useState } from 'react';
import type { EnvironmentGateSettings, TestCaseSet } from '@chat-bot/shared-types';
import { ENVIRONMENT_LIMITS } from '@chat-bot/shared-types';
import { MESSAGES } from '../../../constants/messages';
import { ApiError } from '../../../api/client';
import { environmentApi } from '../../../api/environment';
import { testSetsApi } from '../../../api/validation';

export interface GateSettingsPanelProps {
  chatbotId: string;
  gate: EnvironmentGateSettings;
  canWrite: boolean;
  onSaved: (gate: EnvironmentGateSettings) => void;
  /**
   * [신규 No.40 — §4.6(c)] `ProdSwitchDialog`의 `GATE_CONFIG_ERROR` 링크(`?openGate=1`)로 들어왔을 때
   * 펼친 상태로 시작한다(EN1 진입 즉시 게이트 설정을 확인·수정할 수 있도록 — 이전엔 링크를 눌러도 접힌
   * 채였다).
   */
  initiallyExpanded?: boolean;
  /** 현재 게이트에 지정된 TC 세트 이름(1회 조회 — `EnvironmentStatusPanel`이 미리 넘긴다). */
  currentTestSetName?: string;
}

/** EN1-e 게이트 설정 인라인 확장 섹션(`environment-separation-ui-spec.md` §4.7). */
export function GateSettingsPanel({ chatbotId, gate, canWrite, onSaved, initiallyExpanded = false, currentTestSetName }: GateSettingsPanelProps): JSX.Element {
  const msg = MESSAGES.environment.gate;
  const [expanded, setExpanded] = useState(initiallyExpanded);
  const [mode, setMode] = useState(gate.mode);
  const [testSetId, setTestSetId] = useState(gate.testSetId ?? '');
  const [minPassRate, setMinPassRate] = useState(gate.minPassRate);
  const [validHours, setValidHours] = useState(gate.validHours);
  const [testSets, setTestSets] = useState<TestCaseSet[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);

  useEffect(() => {
    if (!expanded) return;
    setMode(gate.mode);
    setTestSetId(gate.testSetId ?? '');
    setMinPassRate(gate.minPassRate);
    setValidHours(gate.validHours);
    setError(null);
    setFieldError(null);
    testSetsApi
      .list(chatbotId, { pageSize: 100 })
      .then((res) => setTestSets(res.items))
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded, chatbotId]);

  async function handleSave(): Promise<void> {
    if (mode === 'BLOCK' && !testSetId) {
      setFieldError(msg.testSetRequiredError);
      return;
    }
    setFieldError(null);
    setSaving(true);
    setError(null);
    try {
      const res = await environmentApi.updateGate(chatbotId, {
        mode,
        testSetId: testSetId ? testSetId : null,
        minPassRate,
        validHours,
      });
      setExpanded(false);
      onSaved(res);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : MESSAGES.errors.generic);
    } finally {
      setSaving(false);
    }
  }

  const summaryText = (() => {
    if (gate.mode === 'WARN') return msg.summaryWarnText;
    // 펼치기 전(`testSets`가 아직 비어있을 때)에는 호출부가 1회 조회해 넘긴 `currentTestSetName`으로
    // 대체한다(§4.6(d) — 요약 줄에 이름 없이 "TC 세트 미지정"으로 잘못 보이던 문제).
    const setName = testSets.find((s) => s.id === gate.testSetId)?.name ?? currentTestSetName;
    return gate.testSetId && setName ? msg.summaryBlockText(setName, gate.minPassRate) : msg.summaryBlockNoSetText;
  })();

  return (
    <div className="gate-settings-panel">
      <button type="button" className="link-button" aria-expanded={expanded} onClick={() => setExpanded((v) => !v)}>
        <span aria-hidden="true">{expanded ? '▾' : '▸'}</span> {msg.toggleLabel}
      </button>
      {!expanded && <p className="field-hint">{summaryText}</p>}
      {expanded && (
        <div className="gate-settings-form">
          {error && (
            <p className="modal-banner modal-banner--error" role="alert">
              {error}
            </p>
          )}
          <fieldset className="form-field" disabled={!canWrite}>
            <legend>{msg.modeLabel}</legend>
            <label>
              <input type="radio" name="gate-mode" checked={mode === 'WARN'} onChange={() => setMode('WARN')} />
              {msg.modeWarn}
            </label>
            <label>
              <input type="radio" name="gate-mode" checked={mode === 'BLOCK'} onChange={() => setMode('BLOCK')} />
              {msg.modeBlock}
            </label>
          </fieldset>

          <div className="form-field">
            <label htmlFor="gate-test-set">{msg.testSetLabel}</label>
            <select id="gate-test-set" value={testSetId} onChange={(e) => setTestSetId(e.target.value)} disabled={!canWrite}>
              <option value="">{msg.testSetNone}</option>
              {testSets.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            {fieldError && (
              <p className="field-error" role="alert">
                {fieldError}
              </p>
            )}
          </div>

          <div className="form-field">
            <label htmlFor="gate-min-pass-rate">{msg.minPassRateLabel}</label>
            <input
              id="gate-min-pass-rate"
              type="number"
              min={ENVIRONMENT_LIMITS.gateMinPassRateMin}
              max={ENVIRONMENT_LIMITS.gateMinPassRateMax}
              value={minPassRate}
              disabled={!canWrite}
              onChange={(e) => setMinPassRate(Number(e.target.value))}
            />
          </div>

          <div className="form-field">
            <label htmlFor="gate-valid-hours">{msg.validHoursLabel}</label>
            <input
              id="gate-valid-hours"
              type="number"
              min={ENVIRONMENT_LIMITS.gateValidHoursMin}
              max={ENVIRONMENT_LIMITS.gateValidHoursMax}
              value={validHours}
              disabled={!canWrite}
              onChange={(e) => setValidHours(Number(e.target.value))}
            />
          </div>

          <div className="modal-actions">
            <button type="button" className="btn btn-secondary" onClick={() => setExpanded(false)} disabled={saving}>
              {msg.cancelButton}
            </button>
            {canWrite && (
              <button type="button" className="btn btn-primary" onClick={() => void handleSave()} disabled={saving}>
                {saving ? msg.saving : msg.saveButton}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
