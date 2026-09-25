import { useEffect, useRef, useState } from 'react';
import { normalizeText } from '@chat-bot/shared-types';
import type { DecomposedEntityAction, DecomposedResolveResult, DecompositionSpan, ResolveResult, UnansweredQuestionListItem } from '@chat-bot/shared-types';
import { Modal } from '../../components/Modal';
import { InlineFieldError } from '../../components/InlineFieldError';
import { MESSAGES } from '../../constants/messages';
import { learningApi } from '../../api/learning';
import { intentsApi } from '../../api/dialogue';
import { ApiError } from '../../api/client';
import { DecompositionSection, type KeywordOption } from './DecompositionSection';

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
  /** [신규 No.44] "현재 매칭" 후보로 열렸을 때 상단 비차단 경고(FR-FB7-4, feedback-loop-ui-spec.md §3.3). */
  currentMatchWarning?: boolean;
  onClose: () => void;
  /**
   * `resolveDecomposedKeywordNames`는 `resolve-decomposed` 경로에서만 채워진다(1건 이상 등록 시) —
   * API 응답(`DecomposedResolveResult`)이 키워드 이름을 담지 않아(건수만 포함) 클라이언트가
   * 제출 직전 로컬 대기열에서 이름을 뽑아 함께 전달한다(§5.5 배너 문구용, 임시 보완).
   */
  onResolved: (result: ResolveResult | DecomposedResolveResult, resolveDecomposedKeywordNames?: string[]) => void;
  /** 409(ALREADY_RESOLVED) — 동시 경합. 모달을 닫고 목록을 새로고침한다(AC-15B-11). */
  onAlreadyResolved: () => void;
  /** VIEWER는 요소 분해 섹션의 칩을 읽기 전용으로만 본다(역할 순환·경계 편집·키워드 등록 렌더 안 함, §6). */
  canWrite?: boolean;
  /**
   * [신규 2026-09-22 학습 고도화] 요소 분해 섹션(B2)의 "반영할 요소가 없습니다" 빈 상태에서
   * "[무시로 이동]" 클릭 시 호출된다(§5.4 EX-L2-2). 모달은 이 콜백 이후 스스로 닫는다.
   */
  onIgnoreRequested?: () => void;
}

const MAX_EXAMPLE_LENGTH = 200;

/** L1 반영 모달(FR-C-7, S-6~S-8, ui-spec §4.5). */
export function ResolveModal({
  isOpen,
  chatbotId,
  question,
  intentOptions,
  initialIntentName,
  currentMatchWarning,
  onClose,
  onResolved,
  onAlreadyResolved,
  onIgnoreRequested,
  canWrite = true,
}: ResolveModalProps): JSX.Element | null {
  const [intentName, setIntentName] = useState('');
  const [exampleText, setExampleText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [limitExceeded, setLimitExceeded] = useState(false);
  const [intentFieldError, setIntentFieldError] = useState<string | undefined>();
  /** [신규 2026-09-22 학습 고도화] 요소 분해 섹션(B2)이 보고하는 현재 스팬/등록 대기열. */
  const [decompSpans, setDecompSpans] = useState<DecompositionSpan[]>([]);
  const [decompEntities, setDecompEntities] = useState<DecomposedEntityAction[]>([]);
  const [decompKeywordOptions, setDecompKeywordOptions] = useState<KeywordOption[]>([]);
  const [decompError, setDecompError] = useState<string | undefined>();
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
      setDecompSpans([]);
      setDecompEntities([]);
      setDecompKeywordOptions([]);
      setDecompError(undefined);
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
    setDecompError(undefined);
    try {
      const intentPayload = { intentId: matched?.id, intentName: matched ? undefined : trimmedName, exampleText };
      // 엔티티 등록 대기열이 비어있으면 기존 `resolve`를 그대로 쓴다(무회귀, FR-L2-13). 1건 이상이면
      // `resolve-decomposed`로 분기해 의도+엔티티를 함께 반영한다(§5.4/§5.8).
      const result =
        decompEntities.length > 0
          ? await learningApi.resolveDecomposed(chatbotId, question.id, {
              ...intentPayload,
              spans: decompSpans,
              entities: decompEntities,
            })
          : await learningApi.resolve(chatbotId, question.id, intentPayload);
      const keywordNames =
        decompEntities.length > 0
          ? decompEntities.map((a) => (a.action === 'CREATE' ? (a.name ?? a.synonym) : decompKeywordOptions.find((k) => k.id === a.keywordId)?.name ?? a.synonym))
          : undefined;
      onResolved(result, keywordNames);
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.code === 'LIMIT_EXCEEDED') {
          setLimitExceeded(true);
        } else if (e.code === 'ALREADY_RESOLVED') {
          onAlreadyResolved();
        } else if (e.code === 'NOT_FOUND') {
          setIntentFieldError(MESSAGES.learning.intentNotFoundError);
        } else if (e.status === 400 && decompEntities.length > 0) {
          // 스팬 경계 재검증 실패(AC-L2-4) — 모달을 유지하고 경계 편집 상태는 초기화하지 않는다.
          setDecompError(e.message || MESSAGES.learning.decompositionSpanInvalid);
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

      {/* [신규 No.44] 비차단 경고 — 저장을 막지 않는다(AC-FB5-3, feedback-loop-ui-spec.md §3.3). */}
      {currentMatchWarning && (
        <p className="modal-banner modal-banner--warning" role="status" aria-live="polite">
          {MESSAGES.learning.currentMatchWarning}
        </p>
      )}

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

      <DecompositionSection
        key={question.id}
        chatbotId={chatbotId}
        questionId={question.id}
        questionText={question.questionText}
        canWrite={canWrite}
        onStateChange={({ spans, entities, keywordOptions }) => {
          setDecompSpans(spans);
          setDecompEntities(entities);
          setDecompKeywordOptions(keywordOptions);
        }}
        onRequestIgnore={
          onIgnoreRequested
            ? () => {
                onIgnoreRequested();
                onClose();
              }
            : undefined
        }
        serverError={decompError}
      />

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
