import { useCallback, useEffect, useRef, useState } from 'react';
import {
  UTTERANCE_ANALYSIS_LIMITS,
  type UtteranceApplyExcludeReason,
  type UtteranceApplyPreviewResponse,
  type UtteranceApplyRequest,
  type UtteranceApplyResponse,
} from '@chat-bot/shared-types';
import { ApiError } from '../../../api/client';
import { utteranceAnalysesApi } from '../../../api/utteranceAnalyses';
import { MESSAGES } from '../../../constants/messages';
import { AsyncJobProgress } from '../../../components/AsyncJobProgress';
import { AutoSnapshotNotice } from '../../../components/AutoSnapshotNotice';
import { InlineFieldError } from '../../../components/InlineFieldError';
import { Modal } from '../../../components/Modal';
import { ResourcePickerField } from '../../../components/ResourcePickerField';

type Step = 1 | 2 | 3;
type TargetKind = '' | 'EXISTING' | 'NEW';

export interface ApplyDialogCloseInfo {
  /** 결과 화면까지 간 경우: 성공·제외된 발화(선택에서 뺀다). 실패한 발화는 남긴다. */
  removeIds?: string[];
  /** 일부가 들어갔을 수 있어 목록을 다시 읽어야 하는 경우. */
  reload?: boolean;
}

export interface ApplyToIntentDialogProps {
  chatbotId: string;
  analysisId: string;
  /** 선택한 발화(id → 가린 문장). 확인 화면의 "빠지는 문장" 표시에 쓴다(미리보기 응답에는 제외 문장의 본문이 없다). */
  selected: Map<string, string>;
  onClose: (info?: ApplyDialogCloseInfo) => void;
}

/** 제외 사유 → 문구. */
export function excludeReasonText(reason: UtteranceApplyExcludeReason, conflictIntentName?: string): string {
  const map = MESSAGES.utteranceAnalysis.excludeReason;
  if (reason === 'DUPLICATE_IN_OTHER_INTENT') return map.DUPLICATE_IN_OTHER_INTENT(conflictIntentName ?? '');
  return map[reason];
}

function ExcludedTable({ rows, textById }: { rows: Array<{ utteranceId: string; reason: UtteranceApplyExcludeReason; conflictIntentName?: string }>; textById: Map<string, string> }): JSX.Element {
  const msg = MESSAGES.utteranceAnalysis;
  return (
    <table className="dialogue-table">
      <caption className="sr-only">{msg.applyExcludedCaption}</caption>
      <thead>
        <tr>
          <th scope="col">{msg.applyExcludedColText}</th>
          <th scope="col">{msg.applyExcludedColReason}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.utteranceId}>
            <td>{textById.get(r.utteranceId) ?? msg.noneDash}</td>
            <td>{excludeReasonText(r.reason, r.conflictIntentName)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function failedReasonText(code: string): string {
  const errors = MESSAGES.utteranceAnalysis.errors as Record<string, unknown>;
  const v = errors[code];
  return typeof v === 'string' ? v : MESSAGES.utteranceAnalysis.genericError;
}

/**
 * 예문으로 넣기 대화상자(UA-3a, §5.7) — 1/3 넣을 곳 → 2/3 확인(반드시 거친다) → 3/3 결과. 자산을 바꾸는 유일한 경로다(FR-0-288).
 * 요청 중에는 닫기가 막히고, 단계가 바뀔 때마다 단계 제목으로 포커스를 옮긴다. 부모는 열릴 때만 이 컴포넌트를 마운트한다.
 */
export function ApplyToIntentDialog({ chatbotId, analysisId, selected, onClose }: ApplyToIntentDialogProps): JSX.Element {
  const msg = MESSAGES.utteranceAnalysis;
  const ids = [...selected.keys()];
  const [step, setStep] = useState<Step>(1);
  const [kind, setKind] = useState<TargetKind>('');
  const [intentId, setIntentId] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [errors, setErrors] = useState<{ target?: string; intent?: string; name?: string }>({});
  const [busy, setBusy] = useState<null | 'preview' | 'apply'>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [wholeFailed, setWholeFailed] = useState(false);
  const [preview, setPreview] = useState<UtteranceApplyPreviewResponse | null>(null);
  const [result, setResult] = useState<UtteranceApplyResponse | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  // `Modal`은 `onClose`가 바뀌면 포커스를 다시 잡으므로 안정된 콜백 + ref로 최신 상태를 읽는다.
  const stateRef = useRef({ busy, step, result, wholeFailed });
  stateRef.current = { busy, step, result, wholeFailed };
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const idsRef = useRef(ids);
  idsRef.current = ids;

  const requestClose = useCallback((): void => {
    const s = stateRef.current;
    if (s.busy) return;
    if (s.step === 3 && s.result) {
      const failed = new Set(s.result.failed.map((f) => f.utteranceId));
      onCloseRef.current({ removeIds: idsRef.current.filter((id) => !failed.has(id)), reload: true });
      return;
    }
    onCloseRef.current(s.wholeFailed ? { reload: true } : undefined);
  }, []);

  useEffect(() => {
    headingRef.current?.focus();
  }, [step]);

  function buildRequest(): UtteranceApplyRequest | null {
    if (kind === 'EXISTING' && intentId) return { utteranceIds: ids, target: { kind: 'EXISTING', intentId } };
    if (kind === 'NEW' && newName.trim()) return { utteranceIds: ids, target: { kind: 'NEW', intentName: newName.trim() } };
    return null;
  }

  function validateStep1(): boolean {
    const errs: typeof errors = {};
    if (kind === '') errs.target = msg.applyTargetRequired;
    else if (kind === 'EXISTING' && !intentId) errs.intent = msg.applyIntentRequired;
    else if (kind === 'NEW') {
      const n = newName.trim();
      if (n.length < 1) errs.name = msg.applyNewNameRequired;
      else if (n.length > UTTERANCE_ANALYSIS_LIMITS.newIntentNameMax) errs.name = msg.applyNewNameRequired;
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  function handleStepError(e: unknown, from: 'preview' | 'apply'): void {
    if (e instanceof ApiError && e.status === 404) {
      // 의도가 그 사이 삭제됨(EX-DC-10) — 1단계로 돌아가 선택기를 비운다.
      setIntentId(null);
      setErrors({ intent: msg.errors.INTENT_NOT_FOUND });
      setPreview(null);
      setStep(1);
      return;
    }
    if (e instanceof ApiError && e.code === 'CHATBOT_ARCHIVED') {
      setBanner(msg.errors.CHATBOT_ARCHIVED);
      return;
    }
    if (e instanceof ApiError && e.status === 409) {
      setBanner(msg.errors.APPLY_INVALID_STATUS);
      return;
    }
    if (e instanceof ApiError && e.status === 403) {
      setBanner(msg.forbiddenWrite);
      return;
    }
    if (from === 'apply') {
      setWholeFailed(true);
      setBanner(msg.applyWholeFailed);
      return;
    }
    setBanner(msg.genericError);
  }

  async function handlePreview(): Promise<void> {
    if (busy) return;
    setBanner(null);
    if (!validateStep1()) return;
    const req = buildRequest();
    if (!req) return;
    setBusy('preview');
    try {
      const res = await utteranceAnalysesApi.previewApply(chatbotId, analysisId, req);
      setPreview(res);
      setStep(2);
    } catch (e) {
      handleStepError(e, 'preview');
    } finally {
      setBusy(null);
    }
  }

  async function handleApply(): Promise<void> {
    if (busy || !preview) return;
    const req = buildRequest();
    if (!req) return;
    setBusy('apply');
    setBanner(null);
    try {
      const res = await utteranceAnalysesApi.apply(chatbotId, analysisId, req);
      setResult(res);
      setStep(3);
    } catch (e) {
      handleStepError(e, 'apply');
    } finally {
      setBusy(null);
    }
  }

  // 미리보기 응답의 본문 + 선택 시 저장해 둔 본문으로 id → 문장 매핑을 만든다.
  const textById = new Map<string, string>(selected);
  preview?.included.forEach((i) => textById.set(i.utteranceId, i.text));

  const includedCount = preview?.included.length ?? 0;

  return (
    <Modal isOpen title={msg.applyDialogTitle} onClose={requestClose} initialFocusSelector="[data-step-title]" closeOnEsc={busy === null}>
      <div className="ua-apply-dialog">
        <h3 tabIndex={-1} ref={headingRef} data-step-title className="ua-step-title">
          {msg.applyStepLabel[step]}
        </h3>
        {banner && (
          <div className="form-banner form-banner--error" role="alert">
            {banner}
          </div>
        )}

        {step === 1 && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void handlePreview();
            }}
            noValidate
          >
            <p>{msg.applyStep1Intro(ids.length, UTTERANCE_ANALYSIS_LIMITS.applyMaxUtterances)}</p>
            <fieldset className="ua-fieldset" aria-describedby={errors.target ? 'ua-apply-target-error' : undefined}>
              <legend>
                {msg.applyTargetLegend}{' '}
                <span className="required-mark" aria-hidden="true">
                  *
                </span>
              </legend>
              <label className="ua-radio-label">
                <input
                  type="radio"
                  name="ua-apply-target"
                  checked={kind === 'EXISTING'}
                  onChange={() => {
                    setKind('EXISTING');
                    setErrors({});
                  }}
                />{' '}
                {msg.applyTargetExisting}
              </label>
              <ResourcePickerField
                id="ua-apply-intent"
                label={msg.applyIntentPickerLabel}
                resourceType="intent"
                chatbotId={chatbotId}
                multiple={false}
                value={intentId}
                onChange={(v) => {
                  setIntentId((v as string | null) ?? null);
                  setErrors((prev) => ({ ...prev, intent: undefined }));
                }}
                required
                disabled={kind !== 'EXISTING'}
                errorMessage={errors.intent}
              />
              <label className="ua-radio-label">
                <input
                  type="radio"
                  name="ua-apply-target"
                  checked={kind === 'NEW'}
                  onChange={() => {
                    setKind('NEW');
                    setErrors({});
                  }}
                />{' '}
                {msg.applyTargetNew}
              </label>
              <div className="form-field">
                <label htmlFor="ua-apply-new-name">
                  {msg.applyNewNameLabel}{' '}
                  <span className="required-mark" aria-hidden="true">
                    *
                  </span>
                </label>
                <input
                  id="ua-apply-new-name"
                  type="text"
                  value={newName}
                  disabled={kind !== 'NEW'}
                  aria-required="true"
                  aria-invalid={Boolean(errors.name)}
                  aria-describedby={errors.name ? 'ua-apply-new-name-error' : undefined}
                  onChange={(e) => {
                    setNewName(e.target.value);
                    setErrors((prev) => ({ ...prev, name: undefined }));
                  }}
                />
                <span className="field-hint" aria-hidden="true">
                  {msg.applyNewNameCounter(newName.length, UTTERANCE_ANALYSIS_LIMITS.newIntentNameMax)}
                </span>
                <InlineFieldError id="ua-apply-new-name-error" message={errors.name} />
              </div>
              <p className="field-hint">{msg.applyNewIntentNote}</p>
              <InlineFieldError id="ua-apply-target-error" message={errors.target} />
            </fieldset>
            {busy === 'preview' && <AsyncJobProgress label={msg.applyPreviewing} />}
            <div className="modal-actions">
              <button type="button" className="btn btn-secondary" onClick={requestClose} disabled={busy !== null}>
                {msg.applyClose}
              </button>
              <button type="submit" className="btn btn-primary" disabled={busy !== null}>
                {msg.applyPreviewButton}
              </button>
            </div>
          </form>
        )}

        {step === 2 && preview && (
          <div>
            <p>
              {preview.target.resolution === 'EXISTING' && msg.applyResolution.EXISTING(preview.target.intentName)}
              {preview.target.resolution === 'NEW' && msg.applyResolution.NEW(preview.target.intentName)}
              {preview.target.resolution === 'NEW' && preview.linkedNodeCount === null && <> {msg.applyResolution.NEW_UNLINKED}</>}
            </p>
            {preview.target.resolution === 'EXISTING_BY_NAME' && (
              <p className="form-banner form-banner--warning">
                <span aria-hidden="true">⚠</span> {msg.applyResolution.EXISTING_BY_NAME(preview.target.intentName)}
              </p>
            )}
            {preview.draftOnly && (
              <p className="form-banner form-banner--warning">
                <span aria-hidden="true">⚠</span> {msg.applyDraftOnly}
              </p>
            )}
            <p>{msg.applyIncludedSummary(includedCount, preview.resultingExampleCount)}</p>
            {includedCount > 0 && (
              <ol className="ua-scroll-list" tabIndex={0} aria-label={msg.applyIncludedList}>
                {preview.included.map((i) => (
                  <li key={i.utteranceId}>
                    {i.text}
                    {i.warnings.includes('MASK_TOKEN') && <p className="field-hint">ⓘ {msg.applyMaskWarning}</p>}
                  </li>
                ))}
              </ol>
            )}
            {preview.excluded.length > 0 && (
              <>
                <h4>{msg.applyExcludedHeading(preview.excluded.length)}</h4>
                <ExcludedTable rows={preview.excluded} textById={textById} />
              </>
            )}
            {preview.linkedNodeCount === 0 && (
              <p className="form-banner form-banner--warning">
                <span aria-hidden="true">⚠</span> {msg.applyNoLinkedNode}
              </p>
            )}
            {!preview.draftOnly && <p className="field-hint">ⓘ {msg.applyAutoSnapshotPre}</p>}
            {includedCount === 0 && (
              <p id="ua-apply-empty-reason" className="field-hint">
                {msg.applyNothingToAdd}
              </p>
            )}
            {busy === 'apply' && <AsyncJobProgress label={msg.applyConfirming} />}
            <div className="modal-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setStep(1)} disabled={busy !== null}>
                {msg.applyBack}
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy !== null}
                aria-disabled={includedCount === 0 ? 'true' : undefined}
                aria-describedby={includedCount === 0 ? 'ua-apply-empty-reason' : undefined}
                onClick={() => {
                  if (includedCount > 0) void handleApply();
                }}
              >
                {busy === 'apply' ? msg.applyConfirming : msg.applyConfirm(includedCount)}
              </button>
            </div>
          </div>
        )}

        {step === 3 && result && (
          <div>
            <div role="status">
              {result.succeeded === 0 ? (
                <p className="form-banner form-banner--warning">
                  <span aria-hidden="true">ⓘ</span> {msg.applyNoneAdded}
                </p>
              ) : (
                <p className="form-banner form-banner--info">
                  <span aria-hidden="true">✔</span> {result.draftOnly ? msg.applyDraftDone : result.appliedImmediately ? MESSAGES.learning.resolveSuccessImmediate : MESSAGES.learning.resolveSuccessQueued}
                </p>
              )}
            </div>
            <p>{msg.applyResultSummary(result.succeeded, result.excluded.length, result.failed.length)}</p>
            {result.created && <p>{msg.applyCreatedIntent(result.intentName)}</p>}
            <AutoSnapshotNotice
              outcome={result.autoSnapshot}
              chatbotId={chatbotId}
              createdText={msg.autoSnapshotCreated}
              viewLinkText={msg.autoSnapshotViewLink}
              failedText={msg.autoSnapshotFailed}
            />
            {result.linkedNodeCount === 0 && (
              <p className="form-banner form-banner--warning">
                <span aria-hidden="true">⚠</span> {msg.applyNoLinkedNode}
              </p>
            )}
            {result.failed.length > 0 && (
              <table className="dialogue-table">
                <caption>{msg.applyFailedCaption}</caption>
                <thead>
                  <tr>
                    <th scope="col">{msg.applyExcludedColText}</th>
                    <th scope="col">{msg.applyExcludedColReason}</th>
                  </tr>
                </thead>
                <tbody>
                  {result.failed.map((f) => (
                    <tr key={f.utteranceId}>
                      <td>{textById.get(f.utteranceId) ?? msg.noneDash}</td>
                      <td>{failedReasonText(f.code)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {result.excluded.length > 0 && (
              <>
                <h4>{msg.applyExcludedHeading(result.excluded.length)}</h4>
                <ExcludedTable rows={result.excluded} textById={textById} />
              </>
            )}
            <div className="modal-actions">
              <button type="button" className="btn btn-primary" onClick={requestClose}>
                {msg.applyDone}
              </button>
            </div>
          </div>
        )}

        {wholeFailed && step === 2 && (
          <div className="modal-actions">
            <button type="button" className="btn btn-secondary" onClick={() => onCloseRef.current({ reload: true })}>
              {msg.applyRecheck}
            </button>
            <button type="button" className="btn btn-secondary" onClick={requestClose}>
              {msg.applyDone}
            </button>
          </div>
        )}
      </div>
    </Modal>
  );
}
