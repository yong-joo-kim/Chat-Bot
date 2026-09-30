import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { GuardrailAction, GuardrailAppliesTo } from '@chat-bot/shared-types';
import { GUARDRAIL_ACTION_LABELS, GUARDRAIL_APPLIES_TO_LABELS, GUARDRAIL_CATEGORY_LABELS, GUARDRAIL_LIMITS, GuardrailCategory } from '@chat-bot/shared-types';
import { ApiError } from '../../../api/client';
import { guardrailsApi } from '../../../api/guardrails';
import { ChipListEditor } from '../../../components/ChipListEditor';
import { ConfirmDialog } from '../../../components/Modal';
import { ErrorState } from '../../../components/ErrorState';
import { InlineFieldError } from '../../../components/InlineFieldError';
import { SkeletonCard } from '../../../components/Skeleton';
import { useToast } from '../../../components/Toast';
import { MESSAGES } from '../../../constants/messages';
import { useGuardrailContext } from './guardrailContext';
import { GuardrailTestPanel } from './GuardrailTestPanel';
import {
  buildRuleBody,
  EMPTY_RULE_FORM,
  mapRuleServerError,
  ruleToFormValues,
  validateExpressionOnAdd,
  validateRuleForm,
  type RuleFormErrors,
  type RuleFormValues,
} from './ruleForm';

const APPLIES_TO_OPTIONS: GuardrailAppliesTo[] = ['INBOUND', 'OUTBOUND', 'BOTH'];
const ACTION_OPTIONS: GuardrailAction[] = ['MONITOR', 'REPLACE', 'NO_RAG'];

function RequiredMark(): JSX.Element {
  return (
    <>
      <span className="required-mark" aria-hidden="true">
        {' '}
        *
      </span>
      <span className="sr-only"> ({MESSAGES.guardrails.form.required})</span>
    </>
  );
}

/** GR-2 규칙 만들기 / 고치기(+ 저장 전 시험하기) — `ai-guardrails-ui-spec.md` §5. */
export function GuardrailRuleFormPage(): JSX.Element {
  const { ruleId } = useParams<{ ruleId: string }>();
  const isEdit = Boolean(ruleId);
  const { chatbot, guardrail, setUnsavedGuard } = useGuardrailContext();
  const { canWrite, reload, meta } = guardrail;
  const navigate = useNavigate();
  const { showToast } = useToast();
  const fm = MESSAGES.guardrails.form;
  const listUrl = `/chatbots/${chatbot.id}/guardrails/rules`;

  const [values, setValues] = useState<RuleFormValues>(EMPTY_RULE_FORM);
  const [initial, setInitial] = useState<RuleFormValues>(EMPTY_RULE_FORM);
  const [loading, setLoading] = useState(isEdit);
  const [loadError, setLoadError] = useState(false);
  const [errors, setErrors] = useState<RuleFormErrors>({});
  const [invalidExpressions, setInvalidExpressions] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [status, setStatus] = useState('');
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const expressionInputRef = useRef<HTMLInputElement>(null);
  const skipGuardRef = useRef(false);

  const loadRule = useCallback(async () => {
    if (!ruleId) return;
    setLoading(true);
    setLoadError(false);
    try {
      const rule = await guardrailsApi.getRule(chatbot.id, ruleId);
      const v = ruleToFormValues(rule);
      setValues(v);
      setInitial(v);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) setNotFound(true);
      else setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [chatbot.id, ruleId]);

  useEffect(() => {
    void loadRule();
  }, [loadRule]);

  const dirty = useMemo(() => JSON.stringify(values) !== JSON.stringify(initial), [values, initial]);

  // 이탈 보호(TopBar·탭 이동) — 저장 성공 직후 이동은 막지 않는다.
  useEffect(() => {
    setUnsavedGuard(dirty && !skipGuardRef.current ? () => window.confirm(fm.unsavedConfirm) : null);
    return () => setUnsavedGuard(null);
  }, [dirty, setUnsavedGuard, fm.unsavedConfirm]);

  useEffect(() => {
    function handleBeforeUnload(e: BeforeUnloadEvent): void {
      if (!dirty || skipGuardRef.current) return;
      e.preventDefault();
      e.returnValue = '';
    }
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [dirty]);

  function update<K extends keyof RuleFormValues>(key: K, value: RuleFormValues[K]): void {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  function handleAppliesToChange(next: GuardrailAppliesTo): void {
    setErrors((prev) => ({ ...prev, appliesTo: undefined, action: undefined }));
    // 적용 위치가 "사용자 질문"이 아니게 되면 "AI로 보내지 않음"을 기본 "기록만"으로 되돌리고 1회 알린다.
    if (values.action === 'NO_RAG' && next !== 'INBOUND') {
      setStatus(fm.actionResetNotice);
      setValues((prev) => ({ ...prev, appliesTo: next, action: 'MONITOR' }));
      return;
    }
    setValues((prev) => ({ ...prev, appliesTo: next }));
  }

  function focusFirstError(errs: RuleFormErrors): void {
    const order: Array<[keyof RuleFormErrors, string]> = [
      ['name', 'gr-name'],
      ['category', 'gr-category'],
      ['appliesTo', 'gr-applies-INBOUND'],
      ['action', 'gr-action-MONITOR'],
      ['expressions', 'gr-expressions'],
      ['replacementText', 'gr-replacement'],
    ];
    for (const [key, id] of order) {
      if (errs[key]) {
        document.getElementById(id)?.focus();
        return;
      }
    }
  }

  async function handleSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (saving || !canWrite) return;
    const pre = validateRuleForm(values);
    setInvalidExpressions(pre.invalidExpressions);
    if (Object.keys(pre.errors).length > 0) {
      setErrors(pre.errors);
      focusFirstError(pre.errors);
      return;
    }
    const body = buildRuleBody(values);
    if (!body) {
      setErrors({ form: fm.errors.generic });
      return;
    }
    setErrors({});
    setSaving(true);
    try {
      const saved = isEdit && ruleId ? await guardrailsApi.updateRule(chatbot.id, ruleId, body) : await guardrailsApi.createRule(chatbot.id, body);
      skipGuardRef.current = true;
      setUnsavedGuard(null);
      await reload();
      // 서버가 합친 중복 표현 수(정규화 기준)를 알려 주면 토스트에 덧붙인다.
      const merged = saved.removedDuplicateExpressions ?? Math.max(0, values.expressions.length - saved.expressionCount);
      showToast(merged > 0 ? `${fm.savedToast} ${fm.mergedDuplicates(merged)}` : fm.savedToast);
      navigate(listUrl, { state: { focusHeading: true } });
    } catch (err) {
      const mapped = mapRuleServerError(err, values.expressions);
      setErrors(mapped.errors);
      setInvalidExpressions(mapped.invalidExpressions);
      if (mapped.notFound) setNotFound(true);
      else focusFirstError(mapped.errors);
    } finally {
      setSaving(false);
    }
  }

  function handleCancel(): void {
    if (dirty && !window.confirm(fm.unsavedConfirm)) return;
    skipGuardRef.current = true;
    setUnsavedGuard(null);
    navigate(listUrl);
  }

  async function handleDelete(): Promise<void> {
    if (!ruleId || deleting) return;
    setDeleting(true);
    try {
      await guardrailsApi.deleteRule(chatbot.id, ruleId);
      skipGuardRef.current = true;
      setUnsavedGuard(null);
      await reload();
      showToast(MESSAGES.guardrails.rules.deleted(values.name));
      navigate(listUrl, { state: { focusHeading: true } });
    } catch (err) {
      setDeleteOpen(false);
      const mapped = mapRuleServerError(err, []);
      setErrors({ form: mapped.errors.form ?? MESSAGES.guardrails.rules.deleteFailed });
      if (mapped.notFound) setNotFound(true);
    } finally {
      setDeleting(false);
    }
  }

  const draftRule = useMemo(() => buildRuleBody(values), [values]);
  const title = isEdit ? fm.editTitle(initial.name || values.name) : fm.createTitle;

  const breadcrumb = (
    <p className="guardrail-breadcrumb">
      <Link to={listUrl}>{fm.backToList}</Link> <span aria-hidden="true">&gt;</span> {isEdit ? fm.editTitle(initial.name || '') : fm.createTitle}
    </p>
  );

  if (loading) {
    return (
      <div aria-busy="true">
        {breadcrumb}
        <SkeletonCard />
        <GuardrailTestPanel chatbotId={chatbot.id} mode="rules" showDraftChoice={false} defaultOpen />
      </div>
    );
  }
  if (notFound) {
    return (
      <div>
        {breadcrumb}
        <p className="form-banner form-banner--error" role="alert">
          <span aria-hidden="true">⚠</span> {fm.errors.notFound}
        </p>
        <Link to={listUrl} className="btn btn-secondary">
          {fm.toList}
        </Link>
      </div>
    );
  }
  if (loadError) {
    return (
      <div>
        {breadcrumb}
        <ErrorState title={fm.loadFailed} onRetry={() => void loadRule()} />
        <Link to={listUrl} className="btn btn-secondary">
          {fm.toList}
        </Link>
      </div>
    );
  }

  const ragActive = meta?.ragActive ?? true;
  const noRagLocked = values.appliesTo !== 'INBOUND';
  const replacementEnabled = values.action === 'REPLACE';
  const showWidgetNotice = replacementEnabled && (values.appliesTo === 'OUTBOUND' || values.appliesTo === 'BOTH');
  const showInboundNotice = replacementEnabled && (values.appliesTo === 'INBOUND' || values.appliesTo === 'BOTH');

  // 읽기 전용(보안 쓰기 권한 없음·보관 챗봇) — 컨트롤 대신 dl로 보인다. 시험하기만 쓸 수 있다.
  if (!canWrite) {
    return (
      <div className="guardrail-form-page">
        {breadcrumb}
        <h2 tabIndex={-1}>{title}</h2>
        <p className="field-hint">{fm.readOnlyNote}</p>
        <div className="guardrail-form-layout">
          <section className="settings-card" aria-label={fm.sectionContent}>
            <dl className="guardrail-readonly-list">
              <dt>{fm.name}</dt>
              <dd className="guardrail-break">{values.name}</dd>
              <dt>{fm.category}</dt>
              <dd>{values.category ? GUARDRAIL_CATEGORY_LABELS[values.category] : '—'}</dd>
              <dt>{fm.appliesToLegend}</dt>
              <dd>{values.appliesTo ? GUARDRAIL_APPLIES_TO_LABELS[values.appliesTo] : '—'}</dd>
              <dt>{fm.actionLegend}</dt>
              <dd>{GUARDRAIL_ACTION_LABELS[values.action]}</dd>
              <dt>{fm.expressions}</dt>
              <dd>{values.expressions.join(', ')}</dd>
              <dt>{fm.matchTypeLegend}</dt>
              <dd>{values.matchType === 'CONTAINS' ? fm.matchTypeContains : fm.matchTypeExact}</dd>
              {values.action === 'REPLACE' && (
                <>
                  <dt>{fm.replacement}</dt>
                  <dd className="guardrail-result-text">{values.replacementText}</dd>
                </>
              )}
              <dt>{fm.readOnlyEnabled}</dt>
              <dd>{values.enabled ? MESSAGES.guardrails.rules.enabledLabelOn : MESSAGES.guardrails.rules.enabledLabelOff}</dd>
            </dl>
          </section>
          <GuardrailTestPanel chatbotId={chatbot.id} mode="rules" draftRuleId={ruleId} defaultOpen />
        </div>
      </div>
    );
  }

  return (
    <div className="guardrail-form-page">
      {breadcrumb}
      <h2 tabIndex={-1}>{title}</h2>
      {!ragActive && values.appliesTo !== 'INBOUND' && (
        <p className="form-banner form-banner--info">
          <span aria-hidden="true">ⓘ</span> {MESSAGES.guardrails.rules.infoOutboundInactive}
        </p>
      )}
      <p role="status" className="sr-only">
        {status}
      </p>
      <div className="guardrail-form-layout">
        <form className="settings-card guardrail-rule-form" onSubmit={(e) => void handleSubmit(e)} noValidate aria-label={fm.sectionContent}>
          {errors.form && (
            <p className="form-banner form-banner--error" role="alert">
              <span aria-hidden="true">⚠</span> {errors.form}
              {notFound && (
                <>
                  {' '}
                  <Link to={listUrl}>{fm.toList}</Link>
                </>
              )}
            </p>
          )}

          <div className="form-field">
            <label htmlFor="gr-name">
              {fm.name}
              <RequiredMark />
            </label>
            <input
              id="gr-name"
              type="text"
              value={values.name}
              maxLength={GUARDRAIL_LIMITS.nameMax}
              aria-required="true"
              aria-invalid={errors.name ? true : undefined}
              aria-describedby={errors.name ? 'gr-name-error gr-name-count' : 'gr-name-count'}
              onChange={(e) => {
                update('name', e.target.value);
                setErrors((p) => ({ ...p, name: undefined }));
              }}
            />
            <p id="gr-name-count" className="char-counter">
              {fm.nameCount(Array.from(values.name).length, GUARDRAIL_LIMITS.nameMax)}
            </p>
            <InlineFieldError id="gr-name-error" message={errors.name} />
          </div>

          <div className="form-field">
            <label htmlFor="gr-category">
              {fm.category}
              <RequiredMark />
            </label>
            <select
              id="gr-category"
              value={values.category}
              aria-required="true"
              aria-invalid={errors.category ? true : undefined}
              aria-describedby={errors.category ? 'gr-category-error' : undefined}
              onChange={(e) => {
                update('category', e.target.value as GuardrailCategory | '');
                setErrors((p) => ({ ...p, category: undefined }));
              }}
            >
              <option value="">{fm.categoryPlaceholder}</option>
              {GuardrailCategory.options.map((c) => (
                <option key={c} value={c}>
                  {GUARDRAIL_CATEGORY_LABELS[c]}
                </option>
              ))}
            </select>
            <InlineFieldError id="gr-category-error" message={errors.category} />
          </div>

          <fieldset className="form-field" aria-describedby={errors.appliesTo ? 'gr-applies-error gr-applies-help' : 'gr-applies-help'}>
            <legend>
              {fm.appliesToLegend}
              <RequiredMark />
            </legend>
            {APPLIES_TO_OPTIONS.map((opt) => (
              <label key={opt}>
                <input type="radio" id={`gr-applies-${opt}`} name="gr-applies" checked={values.appliesTo === opt} onChange={() => handleAppliesToChange(opt)} />{' '}
                {GUARDRAIL_APPLIES_TO_LABELS[opt]}
                {opt === 'INBOUND' && ` ${fm.appliesToInboundHint}`}
                {opt === 'OUTBOUND' && ` ${fm.appliesToOutboundHint}`}
              </label>
            ))}
            <p id="gr-applies-help" className="field-hint">
              {fm.appliesToHelp}
            </p>
            <InlineFieldError id="gr-applies-error" message={errors.appliesTo} />
          </fieldset>

          <fieldset className="form-field" aria-describedby={errors.action ? 'gr-action-error gr-action-help' : 'gr-action-help'}>
            <legend>
              {fm.actionLegend}
              <RequiredMark />
            </legend>
            {ACTION_OPTIONS.map((opt) => {
              const locked = opt === 'NO_RAG' && noRagLocked;
              return (
                <label key={opt}>
                  <input
                    type="radio"
                    id={`gr-action-${opt}`}
                    name="gr-action"
                    checked={values.action === opt}
                    aria-disabled={locked || undefined}
                    aria-describedby={locked ? 'gr-norag-reason' : undefined}
                    onChange={() => {
                      if (locked) return;
                      update('action', opt);
                      setErrors((p) => ({ ...p, action: undefined, replacementText: undefined }));
                    }}
                  />{' '}
                  {GUARDRAIL_ACTION_LABELS[opt]}
                </label>
              );
            })}
            {noRagLocked && (
              <p id="gr-norag-reason" className="field-hint">
                {fm.noRagLocked}
              </p>
            )}
            <p id="gr-action-help" className="field-hint">
              {fm.actionHelp}
            </p>
            <InlineFieldError id="gr-action-error" message={errors.action} />
          </fieldset>

          <div className="form-field">
            <span className="field-label-static">
              {fm.expressions}
              <RequiredMark />
            </span>
            <p id="gr-expressions-help" className="field-hint">
              {fm.expressionsHelp}
            </p>
            <ChipListEditor
              id="gr-expressions"
              ref={expressionInputRef}
              values={values.expressions}
              placeholder={fm.expressionsInputLabel}
              maxItems={GUARDRAIL_LIMITS.expressionsPerRuleMax}
              limitMessage={fm.expressionsLimit}
              duplicateMessage={fm.expressionDuplicate}
              validate={validateExpressionOnAdd}
              splitPastedLines
              invalidValues={invalidExpressions}
              describedBy={errors.expressions ? 'gr-expressions-help gr-expressions-error' : 'gr-expressions-help'}
              onChange={(list) => {
                update('expressions', list);
                setErrors((p) => ({ ...p, expressions: undefined }));
                setInvalidExpressions([]);
              }}
            />
            <p className="char-counter" aria-live="off">
              {fm.expressionsCount(values.expressions.length, GUARDRAIL_LIMITS.expressionsPerRuleMax)}
            </p>
            <InlineFieldError id="gr-expressions-error" message={errors.expressions} />
          </div>

          <fieldset className="form-field">
            <legend>
              {fm.matchTypeLegend}
              <RequiredMark />
            </legend>
            <label>
              <input
                type="radio"
                name="gr-match"
                checked={values.matchType === 'CONTAINS'}
                onChange={() => {
                  update('matchType', 'CONTAINS');
                  setErrors((p) => ({ ...p, expressions: undefined }));
                  setInvalidExpressions([]);
                }}
              />{' '}
              {fm.matchTypeContains}
            </label>
            <label>
              <input
                type="radio"
                name="gr-match"
                checked={values.matchType === 'EXACT'}
                onChange={() => {
                  update('matchType', 'EXACT');
                  setErrors((p) => ({ ...p, expressions: undefined }));
                }}
              />{' '}
              {fm.matchTypeExact}
            </label>
          </fieldset>

          <div className="form-field">
            <label htmlFor="gr-replacement">
              {fm.replacement}
              {replacementEnabled && <RequiredMark />}
            </label>
            <textarea
              id="gr-replacement"
              value={values.replacementText}
              maxLength={GUARDRAIL_LIMITS.replacementMax}
              rows={4}
              disabled={!replacementEnabled}
              aria-required={replacementEnabled || undefined}
              aria-invalid={errors.replacementText ? true : undefined}
              aria-describedby={errors.replacementText ? 'gr-replacement-help gr-replacement-error' : 'gr-replacement-help'}
              onChange={(e) => {
                update('replacementText', e.target.value);
                setErrors((p) => ({ ...p, replacementText: undefined }));
              }}
            />
            <p className="char-counter">{fm.replacementCount(Array.from(values.replacementText).length, GUARDRAIL_LIMITS.replacementMax)}</p>
            <p id="gr-replacement-help" className="field-hint">
              {replacementEnabled ? fm.replacementHelp : fm.replacementDisabledHint}
            </p>
            {showWidgetNotice && <p className="field-hint">{fm.replacementWidgetNotice}</p>}
            {showInboundNotice && <p className="field-hint">{fm.replacementInboundNotice}</p>}
            <InlineFieldError id="gr-replacement-error" message={errors.replacementText} />
          </div>

          <label className="form-field--inline">
            <input type="checkbox" checked={values.enabled} onChange={(e) => update('enabled', e.target.checked)} /> {fm.enabledCheckbox}
          </label>

          <div className="form-actions">
            {isEdit && (
              <button type="button" className="btn btn-danger guardrail-delete-button" onClick={() => setDeleteOpen(true)}>
                {fm.delete}
              </button>
            )}
            <button type="button" className="btn btn-secondary" onClick={handleCancel}>
              {fm.cancel}
            </button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? fm.saving : fm.save}
            </button>
          </div>
        </form>

        <GuardrailTestPanel
          chatbotId={chatbot.id}
          mode="rules"
          showDraftChoice
          draftRule={draftRule}
          draftRuleId={ruleId}
          defaultStage={values.appliesTo === 'OUTBOUND' ? 'OUTBOUND' : 'INBOUND'}
          defaultOpen
        />
      </div>

      <ConfirmDialog
        isOpen={deleteOpen}
        title={MESSAGES.guardrails.rules.deleteTitle}
        description={MESSAGES.guardrails.rules.deleteDesc(values.name)}
        confirmLabel={deleting ? MESSAGES.guardrails.rules.deleting : MESSAGES.guardrails.rules.deleteConfirm}
        danger
        confirmDisabled={deleting}
        onConfirm={() => void handleDelete()}
        onCancel={() => {
          if (!deleting) setDeleteOpen(false);
        }}
      />
    </div>
  );
}
