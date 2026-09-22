import { useEffect, useRef, useState } from 'react';
import { normalizeText } from '@chat-bot/shared-types';
import type { BulkResult, UnansweredQuestionListItem } from '@chat-bot/shared-types';
import { Modal } from '../../components/Modal';
import { MESSAGES } from '../../constants/messages';
import { learningApi } from '../../api/learning';
import { intentsApi } from '../../api/dialogue';
import { ApiError } from '../../api/client';
import type { IntentOption } from './ResolveModal';

export interface BulkResolveModalProps {
  isOpen: boolean;
  chatbotId: string;
  questions: UnansweredQuestionListItem[];
  intentOptions: IntentOption[];
  onClose: () => void;
  onResult: (result: BulkResult) => void;
}

const PREVIEW_MAX = 5;

/**
 * L1 일괄 반영(FR-C-9, S-11, ui-spec §4.6). 선택된 모든 항목에 **동일한 의도**를 적용한다 —
 * 다른 의도로 보내고 싶은 항목은 선택에서 제외하고 개별 반영한다(항목별 의도 지정은 이번 phase 범위 밖).
 */
export function BulkResolveModal({ isOpen, chatbotId, questions, intentOptions, onClose, onResult }: BulkResolveModalProps): JSX.Element {
  const [intentName, setIntentName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | undefined>();
  /**
   * 초기 의도 목록(최대 100건, 상위에서 1회 로드)만으로 매칭하면 101번째 이후 의도는
   * "새 의도를 만듭니다" 오탐이 발생한다(ResolveModal M-2와 동일 패턴). 입력값이 있을 때
   * 디바운스 서버 검색으로 보정하고, 빈 입력이면 초기 목록(`intentOptions`)으로 되돌아간다.
   */
  const [searchedOptions, setSearchedOptions] = useState<IntentOption[] | null>(null);
  const latestSearchTermRef = useRef('');

  useEffect(() => {
    if (isOpen) {
      setIntentName('');
      setError(undefined);
      setSearchedOptions(null);
    }
  }, [isOpen]);

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

  const trimmedName = intentName.trim();
  const effectiveOptions = searchedOptions ?? intentOptions;
  const matched = effectiveOptions.find((opt) => normalizeText(opt.name) === normalizeText(trimmedName));
  const preview = questions.slice(0, PREVIEW_MAX);
  const remainder = questions.length - preview.length;

  async function handleSubmit(): Promise<void> {
    if (!trimmedName || submitting) return;
    setSubmitting(true);
    setError(undefined);
    try {
      const result = await learningApi.bulkResolve(chatbotId, {
        items: questions.map((q) => (matched ? { id: q.id, intentId: matched.id } : { id: q.id, intentName: trimmedName })),
      });
      onResult(result);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : MESSAGES.errors.generic);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal isOpen={isOpen} title={MESSAGES.learning.bulkResolveModalTitle} onClose={onClose} closeOnEsc={!submitting}>
      <ul>
        {preview.map((q) => (
          <li key={q.id}>{q.questionText}</li>
        ))}
        {remainder > 0 && <li>{MESSAGES.learning.bulkPreviewMore(remainder)}</li>}
      </ul>

      {error && (
        <p className="modal-banner modal-banner--error" role="alert">
          {error}
        </p>
      )}

      <div className="form-field">
        <label htmlFor="bulk-resolve-intent-name">{MESSAGES.learning.intentFieldLabel}</label>
        <input
          id="bulk-resolve-intent-name"
          type="text"
          list="bulk-resolve-intent-options"
          value={intentName}
          onChange={(e) => setIntentName(e.target.value)}
        />
        <datalist id="bulk-resolve-intent-options">
          {effectiveOptions.map((opt) => (
            <option key={opt.id} value={opt.name} />
          ))}
        </datalist>
        <p className="field-hint">
          {trimmedName === ''
            ? MESSAGES.learning.intentFieldPlaceholderHint
            : matched
              ? MESSAGES.learning.existingIntentNotice(matched.name)
              : MESSAGES.learning.newIntentNotice}
        </p>
      </div>

      <div className="modal-actions">
        <button type="button" className="btn btn-secondary" onClick={onClose} disabled={submitting}>
          {MESSAGES.common.cancel}
        </button>
        <button type="button" className="btn btn-primary" onClick={() => void handleSubmit()} disabled={submitting || trimmedName === ''}>
          {submitting ? MESSAGES.learning.submitting : MESSAGES.learning.submitButton}
        </button>
      </div>
    </Modal>
  );
}
