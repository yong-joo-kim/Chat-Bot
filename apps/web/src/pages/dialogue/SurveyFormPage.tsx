import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { SurveyDetail, SurveyStatus } from '@chat-bot/shared-types';
import { useChatbotDetailContext } from '../ChatbotDetailLayout';
import { surveysApi } from '../../api/surveys';
import { ApiError } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../components/Toast';
import { InlineFieldError } from '../../components/InlineFieldError';
import { ChipListEditor } from '../../components/ChipListEditor';
import { ErrorState } from '../../components/ErrorState';
import { MESSAGES } from '../../constants/messages';
import { fieldErrorsFromApiError } from '../../lib/apiErrorHelpers';
import {
  activeFromIsoToDisplayDateInput,
  activeToIsoToDisplayDateInput,
  displayDateInputToActiveFromIso,
  displayDateInputToActiveToIso,
} from '../../lib/surveyDisplay';
import { SurveyTabs } from './components/survey/SurveyTabs';
import { SurveyStructureLockBanner, SurveyTimeoutRetroactiveHint } from './components/survey/SurveyFormBanners';
import { SurveyQuestionListEditor } from './components/survey/SurveyQuestionEditors';
import { SurveyPreviewPanel } from './components/survey/SurveyPreviewPanel';
import { questionToDraft, draftToQuestionInput, type SurveyQuestionDraft } from './components/survey/types';

/** SV2 — 설문 편집기(생성/수정, ui-spec §3.2). */
export function SurveyFormPage(): JSX.Element {
  const { chatbot, setUnsavedGuard } = useChatbotDetailContext();
  const { surveyId } = useParams<{ surveyId: string }>();
  const navigate = useNavigate();
  const { can } = useAuth();
  const { showToast } = useToast();
  const isArchived = chatbot.status === 'ARCHIVED';
  const canWrite = can('dialogue:write') && !isArchived;
  const msg = MESSAGES.surveys;
  const isNew = !surveyId;

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState<SurveyStatus>('DRAFT');
  const [activeFrom, setActiveFrom] = useState('');
  const [activeTo, setActiveTo] = useState('');
  const [introMessage, setIntroMessage] = useState('');
  const [completionMessage, setCompletionMessage] = useState('설문에 참여해 주셔서 감사합니다.');
  const [cancelKeywords, setCancelKeywords] = useState<string[]>(['그만', '취소', '설문 종료']);
  const [sessionTimeoutMinutes, setSessionTimeoutMinutes] = useState(30);
  const [questions, setQuestions] = useState<SurveyQuestionDraft[]>([]);
  const [responseCount, setResponseCount] = useState(0);

  const [loading, setLoading] = useState(!isNew);
  const [notFound, setNotFound] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formBanner, setFormBanner] = useState<string | undefined>(undefined);

  const locked = responseCount > 0;

  const load = useCallback(async () => {
    if (isNew || !surveyId) return;
    setLoading(true);
    setNotFound(false);
    try {
      const detail: SurveyDetail = await surveysApi.findOne(chatbot.id, surveyId);
      setName(detail.name);
      setDescription(detail.description ?? '');
      setStatus(detail.status);
      // [No.27 코드 리뷰 1회차 H1] activeTo는 서버·엔진에서 배타적 경계(now < activeTo)로 다룬다.
      // 화면에는 사용자가 고른 "종료일 당일"이 그대로 보이도록 -1일 보정해 표시한다.
      setActiveFrom(detail.activeFrom ? activeFromIsoToDisplayDateInput(detail.activeFrom) : '');
      setActiveTo(detail.activeTo ? activeToIsoToDisplayDateInput(detail.activeTo) : '');
      setIntroMessage(detail.introMessage ?? '');
      setCompletionMessage(detail.completionMessage);
      setCancelKeywords(detail.cancelKeywords);
      setSessionTimeoutMinutes(detail.sessionTimeoutMinutes);
      setQuestions(detail.questions.map((q) => questionToDraft(q)));
      setResponseCount(detail.responseCount);
      setDirty(false);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) setNotFound(true);
      else showToast(MESSAGES.errors.generic);
    } finally {
      setLoading(false);
    }
  }, [chatbot.id, surveyId, isNew, showToast]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    setUnsavedGuard(dirty ? () => window.confirm(msg.unsavedConfirm) : null);
    return () => setUnsavedGuard(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty]);

  function markDirty<T>(setter: (v: T) => void) {
    return (v: T) => {
      setDirty(true);
      setter(v);
    };
  }

  // ⚠ `OffsetDateTimeSchema`는 문자열 입력을 `Date`로 변환하는 스키마라 `z.infer`(출력 타입) 기준
  // DTO는 `Date`를 요구한다. 요청 시점에는 아직 문자열이므로 `ScheduleDeployDialog.tsx`와 같은 관례대로
  // `as never`로 우회한다(실제 런타임 검증은 서버 zod 파이프가 전담).
  // [No.27 코드 리뷰 1회차 H1] activeTo는 사용자가 고른 종료일 당일 다음날 00:00+09:00(배타적 경계)로
  // 변환해 보낸다 — 그래야 화면에 보이는 종료일 하루가 온전히 참여 가능 기간에 포함된다.
  function buildPayload() {
    return {
      name,
      description: description || undefined,
      activeFrom: (activeFrom ? displayDateInputToActiveFromIso(activeFrom) : undefined) as never,
      activeTo: (activeTo ? displayDateInputToActiveToIso(activeTo) : undefined) as never,
      introMessage: introMessage || undefined,
      completionMessage,
      cancelKeywords,
      sessionTimeoutMinutes,
      questions: questions.map((q) => draftToQuestionInput(q)),
    };
  }

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!canWrite) return;
    setFormBanner(undefined);
    setFieldErrors({});
    setSaving(true);
    try {
      if (isNew) {
        const created = await surveysApi.create(chatbot.id, buildPayload());
        showToast(msg.saveSuccess);
        setDirty(false);
        navigate(`/chatbots/${chatbot.id}/dialogue/surveys/${created.id}`);
      } else if (surveyId) {
        await surveysApi.update(chatbot.id, surveyId, buildPayload());
        showToast(msg.saveSuccess);
        setDirty(false);
        if (locked) showToast(msg.textChangeSavedNotice);
        void load();
      }
    } catch (e2) {
      if (e2 instanceof ApiError) {
        const details = fieldErrorsFromApiError(e2);
        if (Object.keys(details).length > 0) setFieldErrors(details);
        else if (e2.code === 'DUPLICATE_NAME') setFieldErrors({ name: e2.message });
        else if (e2.code === 'SURVEY_STRUCTURE_LOCKED') setFormBanner(msg.saveBlockedStructureLocked);
        else setFormBanner(e2.message || MESSAGES.errors.generic);
      } else {
        setFormBanner(MESSAGES.errors.generic);
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleStatusAction(next: SurveyStatus): Promise<void> {
    if (!surveyId) return;
    setFormBanner(undefined);
    try {
      const updated = await surveysApi.update(chatbot.id, surveyId, { status: next });
      setStatus(updated.status);
      showToast(msg.statusChangeSuccess);
    } catch (e) {
      if (e instanceof ApiError && e.details && e.details.length > 0) {
        setFormBanner(e.details.map((d) => d.message).join(' / '));
      } else {
        setFormBanner(e instanceof ApiError ? e.message : MESSAGES.errors.generic);
      }
    }
  }

  async function handleDuplicate(): Promise<void> {
    if (!surveyId) return;
    try {
      const copied = await surveysApi.copy(chatbot.id, surveyId);
      showToast(msg.copySuccess);
      navigate(`/chatbots/${chatbot.id}/dialogue/surveys/${copied.id}`);
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : MESSAGES.errors.generic);
    }
  }

  if (loading) return <p role="status">{MESSAGES.common.loading}</p>;
  if (notFound) return <ErrorState title={msg.notFound} />;

  return (
    <div className="survey-form-layout">
      <div>
        <Link to={`/chatbots/${chatbot.id}/dialogue/surveys`} className="detail-back-link">
          {MESSAGES.common.backToList}
        </Link>
        <div className="node-form-header">
          <h2>{isNew ? msg.titleNew : msg.titleEdit(name)}</h2>
        </div>
        <SurveyTabs chatbotId={chatbot.id} surveyId={surveyId} active="basic" />

        {locked && <SurveyStructureLockBanner responseCount={responseCount} onDuplicate={() => void handleDuplicate()} />}
        {formBanner && (
          <div className="form-banner form-banner--error" role="alert">
            {formBanner}
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate>
          <fieldset disabled={!canWrite} style={{ border: 'none', padding: 0, margin: 0 }}>
            <div className="form-field">
              <label htmlFor="survey-name">
                {msg.nameLabel} <span className="required-mark" aria-hidden="true">*</span>
              </label>
              <input id="survey-name" type="text" maxLength={50} value={name} onChange={(e) => markDirty(setName)(e.target.value)} aria-invalid={Boolean(fieldErrors.name)} />
              <InlineFieldError id="survey-name-error" message={fieldErrors.name} />
            </div>

            <div className="form-field">
              <label htmlFor="survey-description">{msg.descriptionLabel}</label>
              <textarea id="survey-description" rows={2} maxLength={300} value={description} onChange={(e) => markDirty(setDescription)(e.target.value)} />
              <p className="char-counter">{description.length}/300자</p>
            </div>

            {!isNew && (
              <div className="form-field form-field--inline">
                <span className="field-label-static">{msg.statusStaticLabel}</span>
                <span>{MESSAGES.surveys.filterStatus[status]}</span>
                {canWrite && status === 'DRAFT' && (
                  <button type="button" className="btn btn-secondary" onClick={() => void handleStatusAction('OPEN')}>
                    {msg.openAction}
                  </button>
                )}
                {canWrite && status === 'OPEN' && (
                  <button type="button" className="btn btn-secondary" onClick={() => void handleStatusAction('CLOSED')}>
                    {msg.closeAction}
                  </button>
                )}
                {canWrite && status === 'CLOSED' && (
                  <button type="button" className="btn btn-secondary" onClick={() => void handleStatusAction('OPEN')}>
                    {msg.openAction}
                  </button>
                )}
              </div>
            )}

            <div className="form-field form-field--inline">
              <span className="field-label-static">
                {msg.periodLabel} {msg.periodOptional}
              </span>
              <label htmlFor="survey-active-from" className="sr-only">
                시작일
              </label>
              <input id="survey-active-from" type="date" value={activeFrom} onChange={(e) => markDirty(setActiveFrom)(e.target.value)} />
              <span aria-hidden="true">~</span>
              <label htmlFor="survey-active-to" className="sr-only">
                종료일
              </label>
              <input id="survey-active-to" type="date" value={activeTo} onChange={(e) => markDirty(setActiveTo)(e.target.value)} />
              <InlineFieldError id="survey-period-error" message={fieldErrors.activeFrom ?? fieldErrors.activeTo} />
            </div>

            <div className="form-field">
              <label htmlFor="survey-intro">{msg.introMessageLabel}</label>
              <textarea id="survey-intro" rows={2} maxLength={500} value={introMessage} onChange={(e) => markDirty(setIntroMessage)(e.target.value)} />
              <p className="char-counter">{introMessage.length}/500자</p>
            </div>

            <div className="form-field">
              <label htmlFor="survey-completion">
                {msg.completionMessageLabel} <span className="required-mark" aria-hidden="true">*</span>
              </label>
              <textarea id="survey-completion" rows={2} maxLength={500} value={completionMessage} onChange={(e) => markDirty(setCompletionMessage)(e.target.value)} />
              <p className="char-counter">{completionMessage.length}/500자</p>
            </div>

            <ChipListEditor
              id="survey-cancel-keywords"
              label={msg.cancelKeywordsLabel}
              values={cancelKeywords}
              onChange={markDirty(setCancelKeywords)}
              placeholder={msg.cancelKeywordPlaceholder}
              maxItems={10}
            />

            <div className="form-field">
              <label htmlFor="survey-timeout">{msg.timeoutLabel}</label>
              <input
                id="survey-timeout"
                type="number"
                min={1}
                max={1440}
                value={sessionTimeoutMinutes}
                onChange={(e) => markDirty(setSessionTimeoutMinutes)(Number(e.target.value))}
              />
              <p className="field-hint">{msg.timeoutHelp}</p>
              <SurveyTimeoutRetroactiveHint hasResponses={locked} />
            </div>

            <SurveyQuestionListEditor
              items={questions}
              onChange={markDirty(setQuestions)}
              locked={locked}
              fieldErrors={fieldErrors}
              errPrefix="questions"
            />
          </fieldset>

          <SurveyPreviewPanel introMessage={introMessage} questions={questions} />

          {canWrite && (
            <div className="form-actions">
              <button type="button" className="btn btn-secondary" onClick={() => navigate(`/chatbots/${chatbot.id}/dialogue/surveys`)} disabled={saving}>
                {MESSAGES.common.cancel}
              </button>
              <button type="submit" className="btn btn-primary" disabled={!dirty || saving}>
                {saving ? MESSAGES.common.saving : MESSAGES.common.save}
              </button>
            </div>
          )}
        </form>
      </div>
    </div>
  );
}
