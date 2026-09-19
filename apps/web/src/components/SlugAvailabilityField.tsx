import { useEffect, useRef, useState } from 'react';
import { chatbotsApi } from '../api/chatbots';
import { useDebouncedValue } from '../lib/useDebouncedValue';
import { InlineFieldError } from './InlineFieldError';
import { MESSAGES } from '../constants/messages';

export type SlugCheckStatus = 'idle' | 'checking' | 'available' | 'unavailable';

export interface SlugAvailabilityFieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** 자기 자신의 slug 재확인 시 "이미 사용 중" 오탐을 막기 위한 현재 챗봇 id(FR-3-7). */
  excludeChatbotId?: string;
  /** 제출(400/409) 결과로 받은 서버 오류 문구. 있으면 실시간 확인 상태 대신 우선 표시한다. */
  externalError?: string;
  onStatusChange?: (status: SlugCheckStatus, message?: string) => void;
  required?: boolean;
}

/**
 * slug 입력 + 400ms 디바운스 실시간 중복확인(FR-3-7, NFR-P4). 아이콘 + 텍스트로 상태를 표시하고
 * "사용 불가" 상태에서는 호출부가 저장 버튼을 비활성화할 수 있도록 `onStatusChange`로 알린다(AC-3-6).
 */
export function SlugAvailabilityField({
  id,
  label,
  value,
  onChange,
  excludeChatbotId,
  externalError,
  onStatusChange,
  required = true,
}: SlugAvailabilityFieldProps): JSX.Element {
  const [status, setStatus] = useState<SlugCheckStatus>('idle');
  const [message, setMessage] = useState<string>('');
  const debouncedValue = useDebouncedValue(value, 400);
  const requestIdRef = useRef(0);

  useEffect(() => {
    if (!debouncedValue) {
      setStatus('idle');
      setMessage('');
      onStatusChange?.('idle');
      return;
    }
    const currentRequestId = ++requestIdRef.current;
    setStatus('checking');
    onStatusChange?.('checking');
    chatbotsApi
      .slugAvailable(debouncedValue, excludeChatbotId)
      .then((res) => {
        if (requestIdRef.current !== currentRequestId) return;
        const nextStatus: SlugCheckStatus = res.available ? 'available' : 'unavailable';
        setStatus(nextStatus);
        setMessage(res.message);
        onStatusChange?.(nextStatus, res.message);
      })
      .catch(() => {
        if (requestIdRef.current !== currentRequestId) return;
        setStatus('idle');
        setMessage('');
        onStatusChange?.('idle');
      });
    // excludeChatbotId는 세션 중 바뀌지 않으므로 debouncedValue만 트리거로 둔다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedValue]);

  const statusId = `${id}-status`;
  const errorId = `${id}-error`;

  return (
    <div className="form-field">
      <label htmlFor={id}>
        {label}{' '}
        {required && (
          <span className="required-mark" aria-hidden="true">
            *
          </span>
        )}
      </label>
      <input
        id={id}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        minLength={3}
        maxLength={50}
        required={required}
        aria-describedby={[statusId, externalError ? errorId : ''].filter(Boolean).join(' ') || undefined}
        aria-invalid={status === 'unavailable' || Boolean(externalError)}
      />
      {!externalError && status !== 'idle' && (
        <p id={statusId} className={`slug-status slug-status--${status}`}>
          {status === 'checking' && (
            <>
              <span aria-hidden="true">…</span> {MESSAGES.settings.slugCheckingLabel}
            </>
          )}
          {status === 'available' && MESSAGES.settings.slugAvailableLabel}
          {status === 'unavailable' && (
            <>
              {MESSAGES.settings.slugUnavailablePrefix} {message}
            </>
          )}
        </p>
      )}
      <InlineFieldError id={errorId} message={externalError} />
    </div>
  );
}
