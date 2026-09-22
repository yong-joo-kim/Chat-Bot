import { useState } from 'react';
import type { ThresholdPreviewResponse } from '@chat-bot/shared-types';
import { ApiError } from '../../../api/client';
import { InlineFieldError } from '../../../components/InlineFieldError';
import { ErrorState } from '../../../components/ErrorState';
import { SkeletonBlock } from '../../../components/Skeleton';
import { SeverityBadge } from '../../../components/SeverityBadge';
import { MESSAGES } from '../../../constants/messages';

/**
 * 저장 전 임계값 미리보기(FR-N3-5, AC-N3-9). 저장 버튼과 독립적으로 동작한다(자체 로딩 상태,
 * 폼 제출과 분리). ⚠ 백엔드 계약상 `POST .../answer-settings/preview`는 `{ message }`만 받고
 * **현재 저장되어 있는 설정**을 기준으로 판정한다 — 화면에 편집 중인(아직 저장하지 않은) 임계값이
 * 아니라는 점을 캡션으로 명시해 오해를 막는다(`nlu-rag-answering-설계.md` §10.1, `ThresholdPreviewRequestSchema`
 * 실제 필드는 `message` 1개뿐이라 폼의 미저장 값을 함께 보낼 방법이 없다 — 인계 메모 §9-3 참고).
 *
 * `formDiffersFromSaved`가 `true`면(호출부가 저장된 설정과 현재 폼 값을 비교해 전달, `AnswerSettingsPage`의
 * `dirty`) 조용한 캡션만으로는 사용자가 놓칠 수 있다는 code-reviewer 지적(Medium)에 따라, 색상+아이콘+
 * 텍스트를 함께 쓰는 `SeverityBadge(WARNING)`로 눈에 띄게 상시 고지한다(UIUX_준수기준.md §1 "색상 단독
 * 전달 금지"). 미리보기 자체는 막지 않는다 — 저장된 설정 기준 확인도 유효한 용도이고, 4.1.1의 임계값
 * 실시간 검증도 "저장 버튼을 비활성화하지 않고 고지만 한다"는 동일한 원칙을 쓴다(오탐 방지).
 */
export function AnswerSettingsPreviewPanel({
  onPreview,
  formDiffersFromSaved = false,
}: {
  onPreview: (message: string) => Promise<ThresholdPreviewResponse>;
  /** 현재 폼(편집 중인 값)이 서버에 저장된 설정과 다른지 — 호출부가 비교해 전달한다. */
  formDiffersFromSaved?: boolean;
}): JSX.Element {
  const msg = MESSAGES.answerSettings.preview;
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [inputError, setInputError] = useState<string | undefined>(undefined);
  const [result, setResult] = useState<ThresholdPreviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(): Promise<void> {
    if (message.trim().length === 0) {
      setInputError(msg.inputRequiredError);
      return;
    }
    setInputError(undefined);
    setError(null);
    setLoading(true);
    try {
      const res = await onPreview(message);
      setResult(res);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'EMBEDDING_UNAVAILABLE') {
        setError(msg.embeddingUnavailableError);
      } else {
        setError(e instanceof ApiError ? e.message : msg.embeddingUnavailableError);
      }
      setResult(null);
    } finally {
      setLoading(false);
    }
  }

  const candidateText = result
    ? result.top3.map((c) => `${c.label}(${c.score.toFixed(2)})`).join(' · ') || msg.noCandidates
    : '';

  return (
    <section className="answer-settings-preview-panel">
      <h3>{msg.title}</h3>
      <p className="field-hint">{msg.savedSettingsNotice}</p>
      {formDiffersFromSaved && <SeverityBadge severity="WARNING" label={msg.unsavedFormWarning} />}
      <div className="form-field">
        <label htmlFor="answer-settings-preview-input">{msg.inputLabel}</label>
        <div className="preview-input-row">
          <input
            id="answer-settings-preview-input"
            type="text"
            value={message}
            maxLength={1000}
            aria-describedby={inputError ? 'answer-settings-preview-input-error' : undefined}
            aria-invalid={Boolean(inputError)}
            onChange={(e) => setMessage(e.target.value)}
          />
          <button type="button" className="btn btn-secondary" disabled={loading} aria-disabled={loading} onClick={() => void handleSubmit()}>
            {msg.submitButton}
          </button>
        </div>
        <InlineFieldError id="answer-settings-preview-input-error" message={inputError} />
      </div>

      {loading && <SkeletonBlock height={60} />}
      {!loading && error && <ErrorState title={error} />}
      {!loading && !error && result && (
        <div className="preview-result" role="status">
          <p className="preview-result-band">
            <strong>{result.band === 'FAILED' && !result.wouldUseRag ? msg.bandLabelNoRag : msg.bandLabel[result.band]}</strong>
          </p>
          {result.band === 'AMBIGUOUS' && <p>{msg.candidatesLabel(candidateText)}</p>}
          <p>{result.wouldUseRag ? msg.ragExpected : msg.ragNotExpected}</p>
          <p className="field-hint">{msg.calcCaption}</p>
        </div>
      )}
    </section>
  );
}
