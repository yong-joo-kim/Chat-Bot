import { useId, useRef, useState, type FormEvent } from 'react';
import type { GuardrailPiiExitSettings, GuardrailRuleBody, GuardrailStage, GuardrailTestRequest, GuardrailTestResponse } from '@chat-bot/shared-types';
import { GUARDRAIL_LIMITS } from '@chat-bot/shared-types';
import { ApiError } from '../../../api/client';
import { guardrailsApi } from '../../../api/guardrails';
import { ErrorState } from '../../../components/ErrorState';
import { InlineFieldError } from '../../../components/InlineFieldError';
import { MESSAGES } from '../../../constants/messages';
import { TestResultBadge, TestResultView } from './TestResultView';

export interface GuardrailTestPanelProps {
  chatbotId: string;
  /** `rules` = 규칙 목록·편집 화면, `pii` = 개인정보 가림 설정 화면(AI 답변 위치로 고정). */
  mode: 'rules' | 'pii';
  /** GR-2: 편집 중인 규칙 본문. 필수 항목이 비어 완성되지 않았으면 null. */
  draftRule?: GuardrailRuleBody | null;
  draftRuleId?: string;
  /** GR-2에서만 "지금 편집 중인 내용 / 저장된 규칙만" 선택을 보인다. */
  showDraftChoice?: boolean;
  /** GR-3: 저장 전 폼 값으로 시험한다. */
  draftPiiExit?: GuardrailPiiExitSettings;
  defaultStage?: GuardrailStage;
  defaultOpen?: boolean;
  /** GR-3 "예시 넣기" 버튼용 예시 문장. */
  exampleText?: string;
}

/**
 * "문장으로 시험하기"(ui-spec §5.5) — 저장 0 · 감사 0 · 걸린 기록 0. 입력 중에는 자동 실행하지 않고 "시험하기" 버튼으로만
 * 호출한다. 결과 배지 한 줄만 라이브 영역(`role="status"`)에 넣어 스크린리더가 시험마다 1회만 읽게 한다.
 */
export function GuardrailTestPanel({
  chatbotId,
  mode,
  draftRule,
  draftRuleId,
  showDraftChoice = false,
  draftPiiExit,
  defaultStage = 'INBOUND',
  defaultOpen = false,
  exampleText,
}: GuardrailTestPanelProps): JSX.Element {
  const m = MESSAGES.guardrails.test;
  const uid = useId();
  const textRef = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState('');
  const [stage, setStage] = useState<GuardrailStage>(mode === 'pii' ? 'OUTBOUND' : defaultStage);
  const [target, setTarget] = useState<'draft' | 'saved'>('draft');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<GuardrailTestResponse | null>(null);
  const [textError, setTextError] = useState<string | undefined>(undefined);
  const [draftHint, setDraftHint] = useState(false);
  const [failed, setFailed] = useState(false);

  const effectiveStage: GuardrailStage = mode === 'pii' ? 'OUTBOUND' : stage;

  async function runTest(): Promise<void> {
    setTextError(undefined);
    setDraftHint(false);
    setFailed(false);
    if (!text.trim()) {
      setTextError(m.textRequired);
      textRef.current?.focus();
      return;
    }
    const useDraft = showDraftChoice && target === 'draft';
    if (useDraft && !draftRule) {
      setDraftHint(true);
      return;
    }
    const req: GuardrailTestRequest = { text, stage: effectiveStage };
    if (useDraft && draftRule) {
      req.draftRule = draftRule;
      if (draftRuleId) req.draftRuleId = draftRuleId;
    }
    if (mode === 'pii' && draftPiiExit) req.draftPiiExit = draftPiiExit;
    setRunning(true);
    try {
      const res = await guardrailsApi.test(chatbotId, req);
      setResult(res);
    } catch (e) {
      if (e instanceof ApiError && e.status === 400) {
        if (useDraft) setDraftHint(true);
        else setTextError(m.textRequired);
      } else {
        setFailed(true);
      }
    } finally {
      setRunning(false);
    }
  }

  function handleSubmit(e: FormEvent): void {
    e.preventDefault();
    if (running) return;
    void runTest();
  }

  const textId = `${uid}-text`;
  return (
    <details className="guardrail-test-panel" open={defaultOpen}>
      <summary>{m.title}</summary>
      <form onSubmit={handleSubmit} noValidate>
        {showDraftChoice && (
          <fieldset className="form-field">
            <legend>{m.targetLegend}</legend>
            <label>
              <input type="radio" name={`${uid}-target`} checked={target === 'draft'} onChange={() => setTarget('draft')} /> {m.targetDraft}
            </label>
            <label>
              <input type="radio" name={`${uid}-target`} checked={target === 'saved'} onChange={() => setTarget('saved')} /> {m.targetSaved}
            </label>
          </fieldset>
        )}
        <div className="form-field">
          <label htmlFor={textId}>{m.textLabel}</label>
          <textarea
            id={textId}
            ref={textRef}
            value={text}
            maxLength={GUARDRAIL_LIMITS.testTextMax}
            rows={4}
            aria-invalid={textError ? true : undefined}
            aria-describedby={textError ? `${textId}-error` : undefined}
            onChange={(e) => {
              setText(e.target.value);
              setTextError(undefined);
            }}
          />
          <p className="char-counter">{m.textCount(Array.from(text).length, GUARDRAIL_LIMITS.testTextMax)}</p>
          <InlineFieldError id={`${textId}-error`} message={textError} />
        </div>
        {mode === 'rules' && (
          <fieldset className="form-field">
            <legend>{m.stageLegend}</legend>
            <label>
              <input type="radio" name={`${uid}-stage`} checked={stage === 'INBOUND'} onChange={() => setStage('INBOUND')} /> {m.stageInbound}
            </label>
            <label>
              <input type="radio" name={`${uid}-stage`} checked={stage === 'OUTBOUND'} onChange={() => setStage('OUTBOUND')} /> {m.stageOutbound}
            </label>
          </fieldset>
        )}
        <div className="form-actions guardrail-test-actions">
          {exampleText && (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                setText(exampleText);
                setTextError(undefined);
              }}
            >
              {m.exampleButton}
            </button>
          )}
          <button type="submit" className="btn btn-primary" disabled={running}>
            {running ? m.running : m.submit}
          </button>
        </div>
      </form>
      {draftHint && <p className="field-hint">{m.draftIncomplete}</p>}
      {failed && <ErrorState title={m.failed} onRetry={() => void runTest()} />}
      <div role="status" aria-live="polite" aria-atomic="true" className="guardrail-test-live">
        {result && !failed && <TestResultBadge result={result} />}
      </div>
      {result && !failed && <TestResultView result={result} showRules={mode === 'rules'} />}
      {!result && <p className="field-hint">{m.alwaysNotice}</p>}
    </details>
  );
}
