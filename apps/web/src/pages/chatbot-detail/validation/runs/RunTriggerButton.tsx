import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { BundleTarget, EnvironmentStatus } from '@chat-bot/shared-types';
import { ApiError } from '../../../../api/client';
import { testRunsApi } from '../../../../api/validation';
import { Modal } from '../../../../components/Modal';
import { InlineFieldError } from '../../../../components/InlineFieldError';
import { TargetSelectField } from '../../../../components/TargetSelectField';
import { deriveEnvironmentStatusView } from '../../../../lib/environmentStatus';
import { MESSAGES } from '../../../../constants/messages';

export interface RunTriggerButtonProps {
  chatbotId: string;
  /** 세트가 이미 정해진 화면(V2)에서는 1건만 넘긴다. 세트를 새로 골라야 하는 화면(V3)에서는 여러 건. */
  sets: { id: string; name: string; caseCount: number }[];
  defaultSetId?: string;
  disabled?: boolean;
  disabledReason?: string;
  label?: string;
  onStarted: (runId: string) => void;
  /** [신규 No.40 — §4.14] 고급 옵션의 대상 선택 컨트롤 렌더 여부·보기값 산출용. */
  environmentStatus?: EnvironmentStatus | null;
}

/**
 * `RunTriggerButton` + `RunTriggerDialog`(ui-spec §4.2.3, §4.3) — 버튼과 대화상자를 한 컴포넌트로
 * 묶어 V2(세트 상세)·V3(실행 목록)가 동일하게 재사용한다.
 */
export function RunTriggerButton({ chatbotId, sets, defaultSetId, disabled, disabledReason, label, onStarted, environmentStatus }: RunTriggerButtonProps): JSX.Element {
  const msg = MESSAGES.validation.runTrigger;
  const envView = deriveEnvironmentStatusView(environmentStatus);
  const [open, setOpen] = useState(false);
  const [setId, setSetId] = useState(defaultSetId ?? sets[0]?.id ?? '');
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [useRag, setUseRag] = useState(false);
  // [신규 No.40 — §4.14] 실행 대상. 기본 초안. 이 버튼은 오버레이를 지원하지 않으므로(overlaySource
  // 항상 'NONE') 상호배제 로직은 불필요하다.
  const [target, setTarget] = useState<BundleTarget>({ kind: 'DRAFT' });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [inProgressRunId, setInProgressRunId] = useState<string | null>(null);

  const selectedSet = sets.find((s) => s.id === (setId || defaultSetId || sets[0]?.id));

  function openDialog(): void {
    setSetId(defaultSetId ?? sets[0]?.id ?? '');
    setUseRag(false);
    setTarget({ kind: 'DRAFT' });
    setAdvancedOpen(false);
    setError(undefined);
    setInProgressRunId(null);
    setOpen(true);
  }

  async function handleStart(): Promise<void> {
    if (!setId) return;
    setSubmitting(true);
    setError(undefined);
    setInProgressRunId(null);
    try {
      const res = await testRunsApi.start(chatbotId, setId, {
        overlaySource: 'NONE',
        useRag,
        target: target.kind === 'DRAFT' ? undefined : target,
      });
      setOpen(false);
      onStarted(res.runId);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'TEST_RUN_IN_PROGRESS') {
        setError(msg.inProgressError);
        try {
          const runs = await testRunsApi.list(chatbotId, { setId, pageSize: 5 });
          const running = runs.items.find((r) => r.status === 'QUEUED' || r.status === 'RUNNING');
          if (running) setInProgressRunId(running.id);
        } catch {
          // 링크는 보조 정보 — 조회 실패해도 오류 문구는 이미 표시됐다.
        }
      } else if (e instanceof ApiError && e.code === 'TEST_SET_EMPTY') {
        setError(msg.emptySetError);
      } else {
        setError(e instanceof ApiError ? e.message : MESSAGES.errors.generic);
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className="btn btn-primary"
        disabled={disabled}
        aria-disabled={disabled}
        title={disabled ? disabledReason : undefined}
        onClick={openDialog}
      >
        {label ?? MESSAGES.validation.case.runButton}
      </button>
      <Modal isOpen={open} title={msg.dialogTitle(selectedSet?.name ?? '')} onClose={() => setOpen(false)} closeOnEsc={!submitting}>
        {sets.length > 1 && (
          <div className="form-field">
            <label htmlFor="run-trigger-set">{msg.setSelectLabel}</label>
            <select id="run-trigger-set" value={setId} onChange={(e) => setSetId(e.target.value)}>
              {sets.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        )}
        {selectedSet && <p className="field-hint">{msg.targetCaseCount(selectedSet.caseCount)}</p>}

        <button type="button" className="collapsible-toggle" aria-expanded={advancedOpen} onClick={() => setAdvancedOpen((v) => !v)}>
          <span aria-hidden="true">{advancedOpen ? '▾' : '▸'}</span> {msg.advancedToggle}
        </button>
        {advancedOpen && (
          <div className="form-field">
            <label className="form-field--inline">
              <input type="checkbox" checked={useRag} onChange={(e) => setUseRag(e.target.checked)} />
              {msg.ragCheckboxLabel}
            </label>
            <p className="field-hint">{msg.ragCheckboxHint}</p>
            <TargetSelectField
              chatbotId={chatbotId}
              value={target}
              onChange={setTarget}
              environmentEnabled={envView.isEnabled}
              stagingVersionNo={envView.stagingVersionNo}
              prodVersionNo={envView.prodVersionNo}
            />
          </div>
        )}

        <InlineFieldError id="run-trigger-error" message={error} />
        {inProgressRunId && (
          <p>
            <Link to={`/chatbots/${chatbotId}/validation/runs/${inProgressRunId}`}>{msg.viewInProgressLink}</Link>
          </p>
        )}

        <div className="modal-actions">
          <button type="button" className="btn btn-secondary" onClick={() => setOpen(false)} disabled={submitting}>
            {msg.cancelButton}
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void handleStart()} disabled={submitting || !setId}>
            {msg.startButton}
          </button>
        </div>
      </Modal>
    </>
  );
}
