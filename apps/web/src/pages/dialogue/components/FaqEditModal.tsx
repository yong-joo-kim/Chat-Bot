import { useEffect, useState } from 'react';
import type { DialogueOverlay, FaqCategory, FaqSuggestion } from '@chat-bot/shared-types';
import { Modal } from '../../../components/Modal';
import { InlineFieldError } from '../../../components/InlineFieldError';
import { ChipListEditor } from '../../../components/ChipListEditor';
import { useToast } from '../../../components/Toast';
import { useDebouncedValue } from '../../../lib/useDebouncedValue';
import { MESSAGES } from '../../../constants/messages';
import { faqsApi } from '../../../api/dialogue';
import { ApiError } from '../../../api/client';
import { SimulatorDrawer } from '../../chatbot-detail/simulator/SimulatorDrawer';

export interface FaqEditModalProps {
  isOpen: boolean;
  chatbotId: string;
  faqId: string | null;
  onClose: () => void;
  onSaved: () => void;
  readOnly?: boolean;
  /** 시뮬레이터 드로어(SIM1-D)의 "보관된 챗봇입니다" 배너 노출 여부(FR-10-2). */
  isArchived?: boolean;
  prefillQuestion?: string;
  onJumpToFaq?: (faqId: string, prefillAltQuestion: string) => void;
}

const CATEGORIES: FaqCategory[] = ['FAQ', 'SMALL_TALK', 'SELF_SERVICE', 'ERROR_RESPONSE'];

/** D5a — FAQ 편집 모달(ui-spec §4.7.1). */
export function FaqEditModal({
  isOpen,
  chatbotId,
  faqId,
  onClose,
  onSaved,
  readOnly = false,
  isArchived = false,
  prefillQuestion,
  onJumpToFaq,
}: FaqEditModalProps): JSX.Element {
  const msg = MESSAGES.dialogue.faqs;
  const { showToast } = useToast();
  const [category, setCategory] = useState<FaqCategory>('FAQ');
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [altQuestions, setAltQuestions] = useState<string[]>([]);
  const [enabled, setEnabled] = useState(true);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<FaqSuggestion[]>([]);
  const [simulatorOpen, setSimulatorOpen] = useState(false);
  const debouncedQuestion = useDebouncedValue(question, 400);

  useEffect(() => {
    if (!isOpen) {
      setSimulatorOpen(false);
      return;
    }
    setFieldErrors({});
    if (faqId) {
      setLoading(true);
      faqsApi
        .findOne(chatbotId, faqId)
        .then((detail) => {
          setCategory(detail.category);
          setQuestion(detail.question);
          setAnswer(detail.answer);
          setAltQuestions(prefillQuestion ? [...detail.altQuestions, prefillQuestion] : detail.altQuestions);
          setEnabled(detail.enabled);
        })
        .catch(() => showToast(MESSAGES.errors.generic))
        .finally(() => setLoading(false));
    } else {
      setCategory('FAQ');
      setQuestion('');
      setAnswer('');
      setAltQuestions([]);
      setEnabled(true);
    }
  }, [isOpen, faqId, chatbotId, prefillQuestion, showToast]);

  useEffect(() => {
    if (!isOpen || !debouncedQuestion.trim() || faqId) {
      setSuggestions([]);
      return;
    }
    let cancelled = false;
    faqsApi
      .suggest(chatbotId, { q: debouncedQuestion, mode: 'admin', limit: 5 })
      .then((res) => {
        if (!cancelled) setSuggestions(res as FaqSuggestion[]);
      })
      .catch(() => !cancelled && setSuggestions([]));
    return () => {
      cancelled = true;
    };
  }, [debouncedQuestion, chatbotId, isOpen, faqId]);

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (readOnly) return;
    const errors: Record<string, string> = {};
    if (!question.trim()) errors.question = '질문을 입력해 주세요.';
    if (!answer.trim()) errors.answer = '답변을 입력해 주세요.';
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }
    setSaving(true);
    try {
      if (faqId) {
        await faqsApi.update(chatbotId, faqId, { category, question, answer, altQuestions, enabled });
      } else {
        await faqsApi.create(chatbotId, { category, question, answer, altQuestions, enabled });
      }
      showToast(msg.saveSuccess);
      onSaved();
      onClose();
    } catch (e2) {
      if (e2 instanceof ApiError) {
        if (e2.code === 'DUPLICATE_FAQ') {
          setFieldErrors({ question: msg.duplicateQuestionError });
        } else {
          showToast(e2.message || MESSAGES.errors.generic);
        }
      } else {
        showToast(MESSAGES.errors.generic);
      }
    } finally {
      setSaving(false);
    }
  }

  const topSuggestion = suggestions[0];

  /**
   * SIM1-D(FR-10-23) — 현재 편집 중인 질문/답변/카테고리 초안을 오버레이로 직렬화한다.
   * 신규 FAQ는 `draft-1` 임시 id를 쓴다(FR-10-19 ②).
   */
  function buildOverlay(): DialogueOverlay {
    return {
      faqs: [
        {
          id: faqId ?? 'draft-1',
          category,
          question,
          answer,
          altQuestions,
          enabled,
        },
      ],
    };
  }

  return (
    <>
      <Modal isOpen={isOpen} title={faqId ? msg.editTitle : msg.newTitle} onClose={onClose}>
        <div className="modal-actions-secondary">
          <button type="button" className="btn btn-secondary" onClick={() => setSimulatorOpen(true)}>
            {MESSAGES.simulator.openInDrawer}
          </button>
        </div>
        {loading ? (
          <p role="status">{MESSAGES.common.loading}</p>
        ) : (
          <form onSubmit={handleSubmit} noValidate>
            <fieldset disabled={readOnly} style={{ border: 'none', padding: 0, margin: 0 }}>
              <div className="form-field">
                <label htmlFor="faq-category">
                  {msg.categoryLabel} <span className="required-mark" aria-hidden="true">*</span>
                </label>
                <select id="faq-category" value={category} onChange={(e) => setCategory(e.target.value as FaqCategory)}>
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {MESSAGES.dialogue.faqs.categories[c]}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-field">
                <label htmlFor="faq-question">
                  {msg.questionLabel} <span className="required-mark" aria-hidden="true">*</span>
                </label>
                <textarea
                  id="faq-question"
                  value={question}
                  maxLength={300}
                  rows={2}
                  onChange={(e) => setQuestion(e.target.value)}
                  aria-describedby={fieldErrors.question ? 'faq-question-error' : undefined}
                  aria-invalid={Boolean(fieldErrors.question)}
                />
                <p className="char-counter">{question.length}/300자</p>
                <InlineFieldError id="faq-question-error" message={fieldErrors.question} />
                {topSuggestion && (
                  <div className="form-banner form-banner--info" role="status">
                    <p>{msg.similarFaqHint(topSuggestion.question, MESSAGES.dialogue.faqs.categories[topSuggestion.category])}</p>
                    <div className="dialogue-toolbar-actions">
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() => onJumpToFaq?.(topSuggestion.id, question)}
                        disabled={!onJumpToFaq}
                      >
                        {msg.addAsAltQuestion}
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <div className="form-field">
                <label htmlFor="faq-answer">
                  {msg.answerLabel} <span className="required-mark" aria-hidden="true">*</span>
                </label>
                <textarea
                  id="faq-answer"
                  value={answer}
                  maxLength={2000}
                  rows={5}
                  onChange={(e) => setAnswer(e.target.value)}
                  aria-describedby={`faq-answer-notice${fieldErrors.answer ? ' faq-answer-error' : ''}`}
                  aria-invalid={Boolean(fieldErrors.answer)}
                />
                <p className="char-counter">{answer.length}/2000자</p>
                <p id="faq-answer-notice" className="field-hint">
                  {msg.answerPlainTextNotice}
                </p>
                <InlineFieldError id="faq-answer-error" message={fieldErrors.answer} />
              </div>

              <ChipListEditor
                id="faq-alt-questions"
                label={msg.altQuestionsTitle(altQuestions.length, 30)}
                values={altQuestions}
                onChange={setAltQuestions}
                placeholder={msg.altQuestionPlaceholder}
                maxItems={30}
                disabled={readOnly}
              />

              <div className="form-field form-field--inline">
                <input id="faq-enabled" type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
                <label htmlFor="faq-enabled">{msg.enabledLabel}</label>
              </div>
            </fieldset>

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
      <SimulatorDrawer
        isOpen={simulatorOpen}
        onClose={() => setSimulatorOpen(false)}
        chatbotId={chatbotId}
        isArchived={isArchived}
        overlay={buildOverlay()}
      />
    </>
  );
}
