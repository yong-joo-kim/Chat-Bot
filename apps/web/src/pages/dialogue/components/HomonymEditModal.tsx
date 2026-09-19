import { useEffect, useMemo, useRef, useState } from 'react';
import type { HomonymDictionary, HomonymMeaning, HomonymPolicy, HomonymResolution, TraceStep } from '@chat-bot/shared-types';
import { Modal } from '../../../components/Modal';
import { InlineFieldError } from '../../../components/InlineFieldError';
import { ChipListEditor } from '../../../components/ChipListEditor';
import { ReorderableList } from '../../../components/ReorderableList';
import { ResourcePickerField } from '../../../components/ResourcePickerField';
import { useToast } from '../../../components/Toast';
import { MESSAGES } from '../../../constants/messages';
import { homonymsApi, intentsApi } from '../../../api/dialogue';
import { ApiError } from '../../../api/client';

export interface HomonymEditModalProps {
  isOpen: boolean;
  chatbotId: string;
  homonymId: string | null;
  onClose: () => void;
  onSaved: () => void;
  readOnly?: boolean;
}

interface MeaningRow extends HomonymMeaning {
  key: string;
}

let keySeq = 0;
function nextKey(): string {
  keySeq += 1;
  return `meaning-${keySeq}-${Date.now()}`;
}

function emptyMeaning(): MeaningRow {
  return { key: nextKey(), label: '', contextHints: [] };
}

/** D3a — 동음이의어 편집 모달 + 테스트 패널(ui-spec §4.5). */
export function HomonymEditModal({ isOpen, chatbotId, homonymId, onClose, onSaved, readOnly = false }: HomonymEditModalProps): JSX.Element {
  const msg = MESSAGES.dialogue.homonyms;
  const { showToast } = useToast();
  const [word, setWord] = useState('');
  const [description, setDescription] = useState('');
  const [meanings, setMeanings] = useState<MeaningRow[]>([emptyMeaning(), emptyMeaning()]);
  const [policy, setPolicy] = useState<HomonymPolicy>('ASK');
  const [clarifyPrompt, setClarifyPrompt] = useState('');
  const [defaultMeaningIndex, setDefaultMeaningIndex] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [formError, setFormError] = useState<string | undefined>(undefined);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const savedSnapshotRef = useRef<string>('');
  const [testText, setTestText] = useState('');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ resolution: HomonymResolution | null; trace: TraceStep[] } | null>(null);
  const [resolvedIntentName, setResolvedIntentName] = useState<string | null>(null);
  const [traceOpen, setTraceOpen] = useState(false);

  useEffect(() => {
    const intentId = testResult?.resolution?.intentId;
    if (!intentId) {
      setResolvedIntentName(null);
      return;
    }
    let cancelled = false;
    intentsApi
      .findOne(chatbotId, intentId)
      .then((i) => !cancelled && setResolvedIntentName(i.name))
      .catch(() => !cancelled && setResolvedIntentName(null));
    return () => {
      cancelled = true;
    };
  }, [testResult, chatbotId]);

  useEffect(() => {
    if (!isOpen) return;
    setFormError(undefined);
    setFieldErrors({});
    setTestResult(null);
    setTestText('');
    setSaved(false);
    if (homonymId) {
      setLoading(true);
      homonymsApi
        .findOne(chatbotId, homonymId)
        .then((detail: HomonymDictionary) => {
          setWord(detail.word);
          setDescription(detail.description ?? '');
          setMeanings(detail.meanings.map((m) => ({ ...m, key: nextKey() })));
          setPolicy(detail.policy);
          setClarifyPrompt(detail.clarifyPrompt ?? '');
          setDefaultMeaningIndex(detail.defaultMeaningIndex ?? null);
          setSaved(true);
          savedSnapshotRef.current = JSON.stringify({
            word: detail.word,
            description: detail.description ?? '',
            meanings: detail.meanings,
            policy: detail.policy,
            clarifyPrompt: detail.clarifyPrompt ?? '',
            defaultMeaningIndex: detail.defaultMeaningIndex ?? null,
          });
        })
        .catch(() => showToast(MESSAGES.errors.generic))
        .finally(() => setLoading(false));
    } else {
      setWord('');
      setDescription('');
      setMeanings([emptyMeaning(), emptyMeaning()]);
      setPolicy('ASK');
      setClarifyPrompt('');
      setDefaultMeaningIndex(null);
    }
  }, [isOpen, homonymId, chatbotId, showToast]);

  // 저장된 스냅샷과 현재 폼 상태를 비교해 "저장하지 않은 변경" 안내(테스트 패널) 노출 여부를 갱신한다.
  useEffect(() => {
    if (!homonymId || !savedSnapshotRef.current) return;
    const current = JSON.stringify({
      word,
      description,
      meanings: meanings.map(({ key: _key, ...rest }) => rest),
      policy,
      clarifyPrompt,
      defaultMeaningIndex,
    });
    setSaved(current === savedSnapshotRef.current);
  }, [homonymId, word, description, meanings, policy, clarifyPrompt, defaultMeaningIndex]);

  // FR-7-4: 문맥 힌트가 다른 의미 블록과 겹치면 두 블록 모두에 즉시 경고한다.
  const hintWarnings = useMemo(() => {
    const owners = new Map<string, number[]>();
    meanings.forEach((m, index) => {
      m.contextHints.forEach((hint) => {
        const k = hint.trim().toLowerCase();
        owners.set(k, [...(owners.get(k) ?? []), index]);
      });
    });
    return meanings.map((m, index) =>
      m.contextHints
        .filter((hint) => (owners.get(hint.trim().toLowerCase()) ?? []).length > 1)
        .map((hint) => {
          const otherIndex = (owners.get(hint.trim().toLowerCase()) ?? []).find((i) => i !== index);
          const otherLabel = otherIndex !== undefined ? meanings[otherIndex]?.label || `${otherIndex + 1}번째` : '다른';
          return msg.hintDuplicateWarning(otherLabel);
        }),
    );
  }, [meanings, msg]);

  function updateMeaning(key: string, patch: Partial<HomonymMeaning>): void {
    setMeanings((prev) => prev.map((m) => (m.key === key ? { ...m, ...patch } : m)));
  }

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (readOnly) return;
    if (meanings.length < 2) {
      setFormError(msg.meaningMinError);
      return;
    }
    setFormError(undefined);
    setFieldErrors({});
    setSaving(true);
    try {
      const payload = {
        word,
        description: description || undefined,
        meanings: meanings.map(({ key: _key, ...m }) => m),
        policy,
        clarifyPrompt: policy === 'ASK' ? clarifyPrompt || undefined : undefined,
        defaultMeaningIndex: policy === 'DEFAULT_MEANING' ? defaultMeaningIndex : undefined,
      };
      if (homonymId) {
        await homonymsApi.update(chatbotId, homonymId, payload);
      } else {
        await homonymsApi.create(chatbotId, payload);
      }
      showToast(msg.saveSuccess);
      setSaved(true);
      onSaved();
      onClose();
    } catch (e2) {
      if (e2 instanceof ApiError) {
        if (e2.code === 'INVALID_REFERENCE') {
          setFormError(msg.intentNotFoundError);
        } else if (e2.details && e2.details.length > 0) {
          setFieldErrors(Object.fromEntries(e2.details.map((d) => [d.field, d.message])));
        } else {
          setFormError(e2.message);
        }
      } else {
        showToast(MESSAGES.errors.generic);
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleTest(): Promise<void> {
    if (!testText.trim() || !homonymId) return;
    setTesting(true);
    try {
      const res = await homonymsApi.test(chatbotId, testText);
      setTestResult({ resolution: res.resolution, trace: res.trace });
    } catch {
      showToast(MESSAGES.errors.generic);
    } finally {
      setTesting(false);
    }
  }

  return (
    <Modal isOpen={isOpen} title={homonymId ? msg.editTitle(word || '') : msg.newTitle} onClose={onClose}>
      {loading ? (
        <p role="status">{MESSAGES.common.loading}</p>
      ) : (
        <form onSubmit={handleSubmit} noValidate>
          {formError && (
            <div className="form-banner form-banner--error" role="alert">
              {formError}
            </div>
          )}
          <fieldset disabled={readOnly} style={{ border: 'none', padding: 0, margin: 0 }}>
            <div className="form-field">
              <label htmlFor="homonym-word">
                {msg.wordLabel} <span className="required-mark" aria-hidden="true">*</span>
              </label>
              <input
                id="homonym-word"
                type="text"
                value={word}
                maxLength={50}
                onChange={(e) => setWord(e.target.value)}
                aria-describedby={fieldErrors.word ? 'homonym-word-error' : undefined}
                aria-invalid={Boolean(fieldErrors.word)}
              />
              <InlineFieldError id="homonym-word-error" message={fieldErrors.word} />
            </div>
            <div className="form-field">
              <label htmlFor="homonym-description">{msg.descriptionLabel}</label>
              <input id="homonym-description" type="text" value={description} maxLength={300} onChange={(e) => setDescription(e.target.value)} />
            </div>

            <div className="form-field">
              <span className="field-label-static">{msg.meaningsTitle(meanings.length, 10)}</span>
              <ReorderableList
                items={meanings}
                getKey={(m) => m.key}
                onChange={setMeanings}
                minItems={2}
                maxItems={10}
                onAdd={() => setMeanings((prev) => [...prev, emptyMeaning()])}
                addLabel={msg.addMeaning}
                onRemove={(key) => setMeanings((prev) => prev.filter((m) => m.key !== key))}
                itemLabel={(m, i) => `${i + 1}번째 의미(${m.label || '이름 없음'})`}
                renderItem={(m, index) => (
                  <div>
                    <div className="form-field">
                      <label htmlFor={`meaning-label-${m.key}`}>
                        {msg.meaningLabel} <span className="required-mark" aria-hidden="true">*</span>
                      </label>
                      <input
                        id={`meaning-label-${m.key}`}
                        type="text"
                        value={m.label}
                        maxLength={100}
                        onChange={(e) => updateMeaning(m.key, { label: e.target.value })}
                      />
                    </div>
                    <ChipListEditor
                      id={`meaning-hints-${m.key}`}
                      label={msg.contextHintsLabel(m.contextHints.length, 30)}
                      values={m.contextHints}
                      onChange={(hints) => updateMeaning(m.key, { contextHints: hints })}
                      placeholder={msg.contextHintPlaceholder}
                      maxItems={30}
                    />
                    {hintWarnings[index]?.map((w, i) => (
                      <p key={i} className="field-error" role="alert">
                        <span aria-hidden="true">⚠</span> {w}
                      </p>
                    ))}
                    <ResourcePickerField
                      id={`meaning-intent-${m.key}`}
                      label={msg.linkedIntentLabel}
                      resourceType="intent"
                      chatbotId={chatbotId}
                      multiple={false}
                      value={m.intentId ?? null}
                      onChange={(v) => updateMeaning(m.key, { intentId: (v as string) || undefined })}
                    />
                    <div className="form-field">
                      <label htmlFor={`meaning-desc-${m.key}`}>{msg.meaningDescriptionLabel}</label>
                      <input
                        id={`meaning-desc-${m.key}`}
                        type="text"
                        value={m.description ?? ''}
                        maxLength={300}
                        onChange={(e) => updateMeaning(m.key, { description: e.target.value })}
                      />
                    </div>
                  </div>
                )}
              />
            </div>

            <fieldset className="form-field" style={{ border: 'none', padding: 0 }}>
              <legend className="field-label-static">{msg.policyLabel}</legend>
              <label className="form-field--inline">
                <input type="radio" name="homonym-policy" checked={policy === 'ASK'} onChange={() => setPolicy('ASK')} />
                {msg.policyAsk}
              </label>
              <label className="form-field--inline">
                <input
                  type="radio"
                  name="homonym-policy"
                  checked={policy === 'DEFAULT_MEANING'}
                  onChange={() => setPolicy('DEFAULT_MEANING')}
                />
                {msg.policyDefault}
              </label>
              <label className="form-field--inline">
                <input type="radio" name="homonym-policy" checked={policy === 'IGNORE'} onChange={() => setPolicy('IGNORE')} />
                {msg.policyIgnore}
              </label>
            </fieldset>

            {policy === 'ASK' && (
              <div className="form-field">
                <label htmlFor="clarify-prompt">{msg.clarifyPromptLabel}</label>
                <input id="clarify-prompt" type="text" value={clarifyPrompt} maxLength={200} onChange={(e) => setClarifyPrompt(e.target.value)} />
              </div>
            )}
            {policy === 'DEFAULT_MEANING' && (
              <div className="form-field">
                <label htmlFor="default-meaning">{msg.defaultMeaningLabel}</label>
                <select
                  id="default-meaning"
                  value={defaultMeaningIndex ?? ''}
                  onChange={(e) => setDefaultMeaningIndex(e.target.value === '' ? null : Number(e.target.value))}
                >
                  <option value="">—</option>
                  {meanings.map((m, i) => (
                    <option key={m.key} value={i}>
                      {m.label || `${i + 1}번째`}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </fieldset>

          {homonymId && (
            <div className="form-field">
              <span className="field-label-static">{msg.testTitle}</span>
              {!saved && <p className="field-hint">{msg.testUnsavedNotice}</p>}
              <div className="chip-list-editor-input-row">
                <label htmlFor="homonym-test-input" className="sr-only">
                  {msg.testPlaceholder}
                </label>
                <input
                  id="homonym-test-input"
                  type="text"
                  placeholder={msg.testPlaceholder}
                  value={testText}
                  onChange={(e) => setTestText(e.target.value)}
                />
                <button type="button" className="btn btn-secondary" onClick={handleTest} disabled={testing || !testText.trim()}>
                  {msg.testButton}
                </button>
              </div>
              {testResult && (
                <div className="form-banner form-banner--info" role="status">
                  {testResult.resolution?.status === 'RESOLVED' &&
                    (resolvedIntentName
                      ? msg.testResultResolved(testResult.resolution.meaningLabel ?? '', resolvedIntentName)
                      : msg.testResultResolvedNoIntent(testResult.resolution.meaningLabel ?? ''))}
                  {testResult.resolution?.status === 'AMBIGUOUS' && msg.testResultAmbiguous}
                  {testResult.resolution?.status === 'IGNORED' && msg.testResultIgnored}
                  {!testResult.resolution && msg.testResultIgnored}
                  <div>
                    <button type="button" className="link-button" onClick={() => setTraceOpen((v) => !v)} aria-expanded={traceOpen}>
                      {msg.traceTitle}
                    </button>
                    {traceOpen && (
                      <ul>
                        {testResult.trace.map((t, i) => (
                          <li key={i}>
                            {t.stage} / {t.code} {t.message ? `— ${t.message}` : ''}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="modal-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              {MESSAGES.common.cancel}
            </button>
            {!readOnly && (
              <button type="submit" className="btn btn-primary" disabled={saving}>
                {saving ? MESSAGES.common.saving : MESSAGES.common.save}
              </button>
            )}
          </div>
        </form>
      )}
    </Modal>
  );
}
