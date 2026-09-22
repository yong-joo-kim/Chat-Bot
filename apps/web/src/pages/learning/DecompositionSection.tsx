import { useEffect, useMemo, useRef, useState } from 'react';
import type { DecomposedEntityAction, DecompositionSpan, DecompositionSpanRole } from '@chat-bot/shared-types';
import { learningApi } from '../../api/learning';
import { keywordsApi } from '../../api/dialogue';
import { MESSAGES } from '../../constants/messages';
import { SkeletonRow } from '../../components/Skeleton';
import { InlineFieldError } from '../../components/InlineFieldError';
import { ProposalContainer } from '../../components/ProposalContainer';
import { cycleRole, mergeSpans, splitSpanAt } from './decompositionEdit';

const msg = MESSAGES.learning;

const ROLE_LABEL: Record<DecompositionSpanRole, string> = {
  ENTITY_CANDIDATE: msg.decompositionRoleEntity,
  INTENT_SIGNAL: msg.decompositionRoleSignal,
  IGNORED: msg.decompositionRoleIgnored,
};

interface BoundaryControl {
  key: string;
  kind: 'split' | 'merge';
  spanIndex: number;
  at?: number;
  label: string;
  leftText: string;
  rightText: string;
}

export interface KeywordOption {
  id: string;
  name: string;
}

export interface DecompositionSectionProps {
  chatbotId: string;
  questionId: string;
  questionText: string;
  canWrite: boolean;
  /** 대기열(등록 예정 엔티티 액션)이 1건 이상이면 상위(`ResolveModal`)가 `resolve-decomposed`로 분기한다. */
  onStateChange: (state: { spans: DecompositionSpan[]; entities: DecomposedEntityAction[]; keywordOptions: KeywordOption[] }) => void;
  onRequestIgnore?: () => void;
  /** 제출(§`ResolveModal`) 시 400(스팬 경계 오류)이 나면 상위가 넘겨준다 — 경계 편집을 초기화하지 않고 인라인 표시(AC-L2-4). */
  serverError?: string;
}

/** B2 — 요소 분해 섹션(`ResolveModal` 확장, ui-spec §5.4). 완전 키보드 조작(드래그앤드롭 없음, NFR-LA2). */
export function DecompositionSection({
  chatbotId,
  questionId,
  questionText,
  canWrite,
  onStateChange,
  onRequestIgnore,
  serverError,
}: DecompositionSectionProps): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [analyzerId, setAnalyzerId] = useState('');
  const [spans, setSpans] = useState<DecompositionSpan[]>([]);
  const [keywordOptions, setKeywordOptions] = useState<KeywordOption[]>([]);
  const [entities, setEntities] = useState<DecomposedEntityAction[]>([]);
  const [boundaryEditActive, setBoundaryEditActive] = useState(false);
  const [focusIndex, setFocusIndex] = useState(0);
  const [pickerSpanKey, setPickerSpanKey] = useState<string | null>(null);
  const [pickerMode, setPickerMode] = useState<'existing' | 'new'>('new');
  const [pickerKeywordId, setPickerKeywordId] = useState('');
  const [pickerNewName, setPickerNewName] = useState('');
  const [pickerError, setPickerError] = useState<string | undefined>();
  const [liveMessage, setLiveMessage] = useState('');

  const boundaryToggleRef = useRef<HTMLButtonElement>(null);
  const controlRefs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    onStateChange({ spans, entities, keywordOptions });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spans, entities, keywordOptions]);

  function announce(text: string): void {
    setLiveMessage(text);
  }

  async function load(): Promise<void> {
    setLoading(true);
    setLoadError(false);
    try {
      const [decomposition, keywords] = await Promise.all([
        learningApi.decomposition(chatbotId, questionId),
        keywordsApi.list(chatbotId, { pageSize: 100 }),
      ]);
      setAnalyzerId(decomposition.analyzerId);
      setSpans(decomposition.spans);
      setKeywordOptions(keywords.items.map((k) => ({ id: k.id, name: k.name })));
      setLoaded(true);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }

  function toggleExpanded(): void {
    const next = !expanded;
    setExpanded(next);
    if (next && !loaded && !loading) void load();
  }

  function spanKey(index: number): string {
    const s = spans[index];
    return `${s.start}-${s.end}`;
  }

  function handleRoleCycle(index: number): void {
    const span = spans[index];
    const nextRole = cycleRole(span.role);
    setSpans((prev) => prev.map((s, i) => (i === index ? { ...s, role: nextRole } : s)));
    announce(msg.decompositionRoleChangedAnnounce(span.text, ROLE_LABEL[nextRole]));
    if (nextRole !== 'ENTITY_CANDIDATE' && pickerSpanKey === spanKey(index)) setPickerSpanKey(null);
  }

  const boundaryControls = useMemo<BoundaryControl[]>(() => {
    if (!boundaryEditActive) return [];
    const controls: BoundaryControl[] = [];
    spans.forEach((span, i) => {
      for (let k = 1; k < span.text.length; k += 1) {
        controls.push({
          key: `split-${span.start}-${k}`,
          kind: 'split',
          spanIndex: i,
          at: span.start + k,
          label: msg.decompositionSplitAt(span.text, k),
          leftText: span.text.slice(0, k),
          rightText: span.text.slice(k),
        });
      }
      if (i < spans.length - 1) {
        controls.push({
          key: `merge-${span.start}-${spans[i + 1].start}`,
          kind: 'merge',
          spanIndex: i,
          label: msg.decompositionMerge(span.text, spans[i + 1].text),
          leftText: span.text,
          rightText: spans[i + 1].text,
        });
      }
    });
    return controls;
  }, [boundaryEditActive, spans]);

  useEffect(() => {
    if (boundaryEditActive) {
      setFocusIndex(0);
      window.setTimeout(() => controlRefs.current[0]?.focus(), 0);
    }
  }, [boundaryEditActive]);

  useEffect(() => {
    if (focusIndex >= boundaryControls.length) {
      setFocusIndex(Math.max(0, boundaryControls.length - 1));
    }
  }, [boundaryControls.length, focusIndex]);

  function focusControl(index: number): void {
    const clamped = Math.max(0, Math.min(index, boundaryControls.length - 1));
    setFocusIndex(clamped);
    controlRefs.current[clamped]?.focus();
  }

  function handleControlKeyDown(e: React.KeyboardEvent, index: number): void {
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      focusControl(index + 1);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      focusControl(index - 1);
    } else if (e.key === 'Home') {
      e.preventDefault();
      focusControl(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      focusControl(boundaryControls.length - 1);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setBoundaryEditActive(false);
      boundaryToggleRef.current?.focus();
    }
  }

  function handleControlActivate(control: BoundaryControl): void {
    if (control.kind === 'split' && control.at !== undefined) {
      setSpans((prev) => splitSpanAt(prev, control.spanIndex, control.at as number));
      announce(msg.decompositionSplitAnnounce(control.leftText, control.rightText));
    } else {
      setSpans((prev) => mergeSpans(prev, control.spanIndex));
      announce(msg.decompositionMergeAnnounce(control.leftText + control.rightText));
    }
  }

  function openPicker(index: number): void {
    const span = spans[index];
    setPickerSpanKey(spanKey(index));
    setPickerMode(span.matchedKeyword ? 'existing' : 'new');
    setPickerKeywordId(span.matchedKeyword?.id ?? '');
    setPickerNewName(span.text);
    setPickerError(undefined);
  }

  function closePicker(): void {
    setPickerSpanKey(null);
    setPickerError(undefined);
  }

  function confirmPicker(span: DecompositionSpan): void {
    if (entities.length >= 10) {
      setPickerError(msg.decompositionQueueMax);
      return;
    }
    if (pickerMode === 'existing') {
      if (!pickerKeywordId) {
        setPickerError(msg.requiredIntentError);
        return;
      }
      const keyword = keywordOptions.find((k) => k.id === pickerKeywordId);
      setEntities((prev) => [...prev, { action: 'ADD_SYNONYM', keywordId: pickerKeywordId, synonym: span.text }]);
      announce(msg.decompositionQueueItemSynonym(span.text, keyword?.name ?? ''));
    } else {
      const name = pickerNewName.trim();
      if (!name) {
        setPickerError(msg.requiredIntentError);
        return;
      }
      setEntities((prev) => [...prev, { action: 'CREATE', name, synonym: span.text }]);
      announce(msg.decompositionQueueItemNew(span.text));
    }
    closePicker();
  }

  function removeEntity(index: number): void {
    setEntities((prev) => prev.filter((_, i) => i !== index));
  }

  const allIgnored = loaded && spans.length > 0 && spans.every((s) => s.role === 'IGNORED');
  const analyzerLabel = analyzerId.startsWith('heuristic') ? msg.decompositionAnalyzerHeuristic : msg.decompositionAnalyzerAdvanced;

  return (
    <div className="decomposition-section">
      <button type="button" className="collapsible-toggle" aria-expanded={expanded} onClick={toggleExpanded}>
        <span aria-hidden="true">{expanded ? '▾' : '▸'}</span> {msg.decompositionSectionTitle}
      </button>

      <div aria-live="polite" className="sr-only">
        {liveMessage}
      </div>

      {expanded && (
        <div className="decomposition-body">
          {loading && <SkeletonRow />}
          {!loading && loadError && <p className="field-error" role="alert">{msg.decompositionLoadFailed}</p>}
          {!loading && !loadError && loaded && (
            <>
              <p className="field-hint decomposition-analyzer-label">{analyzerLabel}</p>

              {allIgnored ? (
                <p className="field-hint">
                  {msg.decompositionEmptyAllIgnored}{' '}
                  {onRequestIgnore && (
                    <button type="button" className="btn btn-secondary" onClick={onRequestIgnore}>
                      {msg.decompositionGoIgnore}
                    </button>
                  )}
                </p>
              ) : (
                <>
                  <div className="decomposition-chip-row" role="group" aria-label={`${msg.decompositionSectionTitle}: ${questionText}`}>
                    {spans.map((span, index) => (
                      <div key={spanKey(index)} className="decomposition-chip-cell">
                        <button
                          type="button"
                          className={`decomposition-chip decomposition-chip--${span.role.toLowerCase()}`}
                          disabled={!canWrite}
                          onClick={() => handleRoleCycle(index)}
                          aria-label={msg.decompositionRoleChipLabel(
                            span.text,
                            span.role === 'ENTITY_CANDIDATE' && span.matchedKeyword
                              ? msg.decompositionRoleEntityMatched(span.matchedKeyword.name)
                              : ROLE_LABEL[span.role],
                          )}
                        >
                          {span.text}
                        </button>
                        <span className="decomposition-chip-role-label">
                          {span.role === 'ENTITY_CANDIDATE' && span.matchedKeyword
                            ? msg.decompositionRoleEntityMatched(span.matchedKeyword.name)
                            : ROLE_LABEL[span.role]}
                        </span>
                        {canWrite && span.role === 'ENTITY_CANDIDATE' && (
                          <button type="button" className="btn btn-secondary" onClick={() => openPicker(index)}>
                            {msg.decompositionRegisterKeyword}
                          </button>
                        )}
                        {pickerSpanKey === spanKey(index) && (
                          <div className="decomposition-entity-picker">
                            <fieldset>
                              <legend className="sr-only">{msg.decompositionRegisterKeyword}</legend>
                              <label>
                                <input
                                  type="radio"
                                  name={`entity-mode-${spanKey(index)}`}
                                  checked={pickerMode === 'existing'}
                                  onChange={() => setPickerMode('existing')}
                                />{' '}
                                {msg.decompositionActionExistingLabel}
                              </label>
                              {pickerMode === 'existing' && (
                                <div className="form-field">
                                  <label htmlFor={`entity-keyword-${spanKey(index)}`} className="sr-only">
                                    {msg.decompositionActionKeywordSelectLabel}
                                  </label>
                                  <select
                                    id={`entity-keyword-${spanKey(index)}`}
                                    value={pickerKeywordId}
                                    onChange={(e) => setPickerKeywordId(e.target.value)}
                                  >
                                    <option value="">—</option>
                                    {keywordOptions.map((k) => (
                                      <option key={k.id} value={k.id}>
                                        {k.name}
                                      </option>
                                    ))}
                                  </select>
                                </div>
                              )}
                              <label>
                                <input
                                  type="radio"
                                  name={`entity-mode-${spanKey(index)}`}
                                  checked={pickerMode === 'new'}
                                  onChange={() => setPickerMode('new')}
                                />{' '}
                                {msg.decompositionActionNewLabel}
                              </label>
                              {pickerMode === 'new' && (
                                <div className="form-field">
                                  <label htmlFor={`entity-newname-${spanKey(index)}`} className="sr-only">
                                    {msg.decompositionActionNewNameLabel}
                                  </label>
                                  <input
                                    id={`entity-newname-${spanKey(index)}`}
                                    type="text"
                                    value={pickerNewName}
                                    onChange={(e) => setPickerNewName(e.target.value)}
                                    maxLength={100}
                                  />
                                </div>
                              )}
                            </fieldset>
                            <InlineFieldError id={`entity-picker-error-${spanKey(index)}`} message={pickerError} />
                            {entities.length >= 10 && <p className="field-hint">{msg.decompositionQueueMax}</p>}
                            <div className="decomposition-entity-picker-actions">
                              <button type="button" className="btn btn-secondary" onClick={closePicker}>
                                {msg.decompositionActionCancel}
                              </button>
                              <button
                                type="button"
                                className="btn btn-primary"
                                onClick={() => confirmPicker(span)}
                                disabled={entities.length >= 10}
                              >
                                {msg.decompositionActionConfirm}
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>

                  {canWrite && (
                    <button
                      type="button"
                      ref={boundaryToggleRef}
                      className="btn btn-secondary"
                      aria-pressed={boundaryEditActive}
                      onClick={() => setBoundaryEditActive((v) => !v)}
                    >
                      {boundaryEditActive ? msg.decompositionBoundaryEditEnd : msg.decompositionBoundaryEditStart}
                    </button>
                  )}

                  {boundaryEditActive && (
                    <div className="decomposition-boundary-wrap">
                      <p className="field-hint">{msg.decompositionBoundaryEditHint}</p>
                      <div className="decomposition-boundary-toolbar" role="toolbar" aria-label={msg.decompositionBoundaryEditHint}>
                        {boundaryControls.map((control, index) => (
                          <button
                            key={control.key}
                            type="button"
                            ref={(el) => {
                              controlRefs.current[index] = el;
                            }}
                            className={`decomposition-boundary-control decomposition-boundary-control--${control.kind}`}
                            tabIndex={index === focusIndex ? 0 : -1}
                            onFocus={() => setFocusIndex(index)}
                            onKeyDown={(e) => handleControlKeyDown(e, index)}
                            onClick={() => handleControlActivate(control)}
                          >
                            {control.kind === 'split' ? '✂' : '⋈'} <span className="sr-only">{control.label}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}

              {entities.length > 0 && (
                <ProposalContainer title={msg.decompositionQueueTitle} safetyNotice={msg.decompositionQueueNotice}>
                  <ul className="entity-action-queue-list">
                    {entities.map((action, index) => {
                      const label =
                        action.action === 'CREATE'
                          ? msg.decompositionQueueItemNew(action.synonym)
                          : msg.decompositionQueueItemSynonym(
                              action.synonym,
                              keywordOptions.find((k) => k.id === action.keywordId)?.name ?? '',
                            );
                      return (
                        <li key={`${action.action}-${action.synonym}-${index}`}>
                          <span>{label}</span>
                          <button
                            type="button"
                            className="btn btn-secondary"
                            onClick={() => removeEntity(index)}
                            aria-label={msg.decompositionQueueRemove(action.synonym)}
                          >
                            ×
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                  {entities.length >= 10 && <p className="field-hint">{msg.decompositionQueueMax}</p>}
                </ProposalContainer>
              )}

              {serverError && (
                <p className="field-error" role="alert">
                  {serverError}
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
