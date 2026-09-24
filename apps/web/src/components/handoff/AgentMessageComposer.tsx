import { useEffect, useState } from 'react';
import type { SendAgentMessageResponse } from '@chat-bot/shared-types';
import { HANDOFF_LIMITS } from '@chat-bot/shared-types';
import { handoffApi } from '../../api/handoff';
import { ApiError } from '../../api/client';
import { useDebouncedValue } from '../../lib/useDebouncedValue';
import { InlineFieldError } from '../InlineFieldError';
import { MESSAGES } from '../../constants/messages';

/**
 * 상담원 메시지 입력창(hybrid-cs-ui-spec.md §2.2 `AgentMessageComposer`). 전송 전 마스킹 미리보기를
 * 디바운스(300ms)로 갱신하고, 전송 실패(`503`)에는 입력값을 보존한 채 재시도 버튼을 보여준다(AC-CS3-5).
 */
export function AgentMessageComposer({
  chatbotId,
  handoffId,
  value,
  onChange,
  disabled,
  disabledReason,
  onSent,
  onNotActive,
  onNotAssignee,
}: {
  chatbotId: string;
  handoffId: string;
  value: string;
  onChange: (text: string) => void;
  disabled: boolean;
  disabledReason?: string;
  onSent: (res: SendAgentMessageResponse) => void;
  /** M1(코드 리뷰 1회차): 전송 도중 상담이 이미 종료됐다(`409 HANDOFF_NOT_ACTIVE`) — 상위가 화면 전체를
   * 종료 후 상태로 전환한다. */
  onNotActive?: () => void;
  /** M1: 전송 도중 담당이 바뀌었다(`403 HANDOFF_NOT_ASSIGNEE`) — 상위가 상태를 재조회한다. */
  onNotAssignee?: () => void;
}): JSX.Element {
  const msg = MESSAGES.handoffConsole;
  const debouncedValue = useDebouncedValue(value, 300);
  const [preview, setPreview] = useState<{ maskedText: string; changed: boolean } | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!debouncedValue.trim()) {
      setPreview(null);
      return;
    }
    let cancelled = false;
    handoffApi
      .maskPreview(chatbotId, { text: debouncedValue })
      .then((res) => {
        if (!cancelled) setPreview(res);
      })
      .catch(() => {
        if (!cancelled) setPreview(null);
      });
    return () => {
      cancelled = true;
    };
  }, [chatbotId, debouncedValue]);

  async function handleSend(): Promise<void> {
    if (!value.trim() || disabled) return;
    if (value.length > HANDOFF_LIMITS.messageMax) {
      setFieldError(`${HANDOFF_LIMITS.messageMax.toLocaleString('ko-KR')}자 이내로 입력해 주세요.`);
      return;
    }
    setFieldError(undefined);
    setError(null);
    setSending(true);
    try {
      const res = await handoffApi.sendMessage(chatbotId, handoffId, { text: value });
      onChange('');
      setPreview(null);
      onSent(res);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'HANDOFF_UNAVAILABLE') {
        setError(msg.sendUnavailableError);
      } else if (e instanceof ApiError && e.code === 'HANDOFF_NOT_ACTIVE') {
        // M1: 상담이 이미 종료됐다 — 화면 전체가 종료 후 상태로 전환되어야 한다(§3.3 필드-오류 매핑).
        setError(msg.composerDisabledNotActive);
        onNotActive?.();
      } else if (e instanceof ApiError && e.code === 'HANDOFF_NOT_ASSIGNEE') {
        // M1: 전송 도중 담당자가 바뀌었다(강제 인수 등) — 안내하고 상위가 최신 상태를 재조회한다.
        setError(msg.composerDisabledNotAssignee);
        onNotAssignee?.();
      } else if (e instanceof ApiError) {
        setError(e.message || MESSAGES.errors.generic);
      } else {
        setError(MESSAGES.errors.generic);
      }
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="agent-message-composer">
      {preview && (
        <p className="field-hint">
          {msg.maskPreviewLabel}: {preview.maskedText} {preview.changed ? `(${msg.maskPreviewChangedHint})` : `${msg.maskPreviewNoChangeHint}`}
        </p>
      )}
      <label className="form-field--inline" htmlFor="agent-message-input">
        {msg.composerLabel}
      </label>
      <div className="agent-message-composer-row">
        <textarea
          id="agent-message-input"
          value={value}
          disabled={disabled || sending}
          maxLength={HANDOFF_LIMITS.messageMax}
          aria-describedby={fieldError ? 'agent-message-error' : undefined}
          aria-invalid={Boolean(fieldError)}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void handleSend();
            }
          }}
        />
        <button
          type="button"
          className="btn btn-primary"
          disabled={disabled || sending || !value.trim()}
          aria-disabled={disabled || sending || !value.trim()}
          onClick={() => void handleSend()}
        >
          {msg.composerSendButton}
        </button>
      </div>
      <InlineFieldError id="agent-message-error" message={fieldError} />
      {disabled && disabledReason && <p className="field-hint">{disabledReason}</p>}
      {error && (
        <p className="error-state-title" role="alert">
          <span aria-hidden="true">⚠</span> {error}{' '}
          <button type="button" className="btn btn-secondary" onClick={() => void handleSend()}>
            {msg.sendUnavailableRetry}
          </button>
        </p>
      )}
    </div>
  );
}
