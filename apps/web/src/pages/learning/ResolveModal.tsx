import { useEffect, useRef, useState } from 'react';
import { normalizeText } from '@chat-bot/shared-types';
import type { ResolveResult, UnansweredQuestionListItem } from '@chat-bot/shared-types';
import { Modal } from '../../components/Modal';
import { InlineFieldError } from '../../components/InlineFieldError';
import { MESSAGES } from '../../constants/messages';
import { learningApi } from '../../api/learning';
import { intentsApi } from '../../api/dialogue';
import { ApiError } from '../../api/client';

export interface IntentOption {
  id: string;
  name: string;
}

export interface ResolveModalProps {
  isOpen: boolean;
  chatbotId: string;
  question: UnansweredQuestionListItem | null;
  intentOptions: IntentOption[];
  /** 추천 후보에서 진입한 경우 의도명이 사전 채워진다(S-6). */
  initialIntentName?: string;
  onClose: () => void;
  onResolved: (result: ResolveResult) => void;
  /** 409(ALREADY_RESOLVED) — 동시 경합. 모달을 닫고 목록을 새로고침한다(AC-15B-11). */
  onAlreadyResolved: () => void;
}

const MAX_EXAMPLE_LENGTH = 200;

/** L1 반영 모달(FR-C-7, S-6~S-8, ui-spec §4.5). */
export function ResolveModal({
  isOpen,
  chatbotId,
  question,
  intentOptions,
  initialIntentName,
  onClose,
  onResolved,
  onAlreadyResolved,
}: ResolveModalProps): JSX.Element | null {
  const [intentName, setIntentName] = useState('');
  const [exampleText, setExampleText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [limitExceeded, setLimitExceeded] = useState(false);
  const [intentFieldError, setIntentFieldError] = useState<string | undefined>();
  /**
   * 초기 의도 목록(최대 100건, 상위에서 1회 로드)만으로 매칭하면 101번째 이후 의도는
   * "새 의도를 만듭니다" 오탐이 발생한다(코드리뷰 M-2). 입력값이 있을 때 디바운스 서버
   * 검색으로 보정하고, 빈 입력이면 초기 목록(`intentOptions`)으로 되돌아간다.
   */
  const [searchedOptions, setSearchedOptions] = useState<IntentOption[] | null>(null);
  const latestSearchTermRef = useRef('');

  useEffect(() => {
    if (isOpen && question) {
      setIntentName(initialIntentName ?? '');
      setExampleText(question.questionText);
      setLimitExceeded(false);
      setIntentFieldError(undefined);
      setSearchedOptions(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, question?.id, initialIntentName]);

  const trimmedNameForSearch = intentName.trim();
  useEffect(() => {
    if (!isOpen) return;
    if (trimmedNameForSearch === '') {
      setSearchedOptions(null);
      return;
    }
    const timer = setTimeout(() => {
      const term = trimmedNameForSearch;
      latestSearchTermRef.current = term;
      intentsApi
        .list(chatbotId, { q: term, pageSize: 50 })
        .then((res) => {
          if (latestSearchTermRef.current !== term) return; // 더 최신 검색이 진행 중이면 버린다.
          setSearchedOptions(res.items.map((i) => ({ id: i.id, name: i.name })));
        })
        .catch(() => {
          // 검색 실패는 자동완성만 막을 뿐 — 초기 목록(intentOptions)으로 계속 매칭을 시도한다.
        });
    }, 300);
    return () => clearTimeout(timer);
  }, [isOpen, chatbotId, trimmedNameForSearch]);

  if (!question) return null;

  const trimmedName = intentName.trim();
  const effectiveOptions = searchedOptions ?? intentOptions;
  const matched = effectiveOptions.find((opt) => normalizeText(opt.name) === normalizeText(trimmedName));
  const remaining = MAX_EXAMPLE_LENGTH - exampleText.length;

  async function handleSubmit(): Promise<void> {
    if (!question || !trimmedName || submitting) return;
    setSubmitting(true);
    setLimitExceeded(false);
    setIntentFieldError(undefined);
    try {
      const result = await learningApi.resolve(chatbotId, question.id, {
        intentId: matched?.id,
        intentName: matched ? undefined : trimmedName,
        exampleText,
      });
      onResolved(result);
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.code === 'LIMIT_EXCEEDED') {
          setLimitExceeded(true);
        } else if (e.code === 'ALREADY_RESOLVED') {
          onAlreadyResolved();
        } else if (e.code === 'NOT_FOUND') {
          setIntentFieldError(MESSAGES.learning.intentNotFoundError);
        } else {
          setIntentFieldError(e.message);
        }
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal isOpen={isOpen} title={MESSAGES.learning.resolveModalTitle} onClose={onClose} closeOnEsc={!submitting}>
      <p>
        <strong>{MESSAGES.learning.targetQuestionLabel}</strong>: {question.questionText}
      </p>

      {limitExceeded && (
        <p className="modal-banner modal-banner--error" role="alert">
          {MESSAGES.learning.limitExceededBanner}
        </p>
      )}

      <div className="form-field">
        <label htmlFor="resolve-intent-name">{MESSAGES.learning.intentFieldLabel}</label>
        <input
          id="resolve-intent-name"
          type="text"
          list="resolve-intent-options"
          value={intentName}
          onChange={(e) => setIntentName(e.target.value)}
          aria-describedby="resolve-intent-hint resolve-intent-error"
        />
        <datalist id="resolve-intent-options">
          {effectiveOptions.map((opt) => (
            <option key={opt.id} value={opt.name} />
          ))}
        </datalist>
        <p id="resolve-intent-hint" className="field-hint">
          {trimmedName === ''
            ? MESSAGES.learning.intentFieldPlaceholderHint
            : matched
              ? MESSAGES.learning.existingIntentNotice(matched.name)
              : MESSAGES.learning.newIntentNotice}
        </p>
        <InlineFieldError id="resolve-intent-error" message={intentFieldError} />
      </div>

      <div className="form-field">
        <label htmlFor="resolve-example-text">{MESSAGES.learning.exampleTextLabel}</label>
        <textarea
          id="resolve-example-text"
          value={exampleText}
          maxLength={MAX_EXAMPLE_LENGTH}
          onChange={(e) => setExampleText(e.target.value)}
          aria-describedby="resolve-example-remaining"
        />
        <p id="resolve-example-remaining" className="field-hint">
          {MESSAGES.learning.exampleTextRemaining(remaining)}
        </p>
      </div>

      <p className="field-hint">{MESSAGES.learning.appliedImmediatelyHint}</p>

      <div className="modal-actions">
        <button type="button" className="btn btn-secondary" onClick={onClose} disabled={submitting}>
          {MESSAGES.common.cancel}
        </button>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => void handleSubmit()}
          disabled={submitting || trimmedName === '' || exampleText.trim() === ''}
        >
          {submitting ? MESSAGES.learning.submitting : MESSAGES.learning.submitButton}
        </button>
      </div>
    </Modal>
  );
}
