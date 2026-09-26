import type { RetentionTargetKind } from '@chat-bot/shared-types';
import { InlineFieldError } from '../../../components/InlineFieldError';
import { MESSAGES } from '../../../constants/messages';

export type ChatbotRetentionMode = 'GLOBAL' | 'CUSTOM' | 'UNLIMITED';

export interface ChatbotRetentionKindEditorProps {
  kind: RetentionTargetKind;
  /** 전역 정책을 따를 때 지금 적용되는 값(유예 반영) — null = 무기한. */
  currentGlobalDays: number | null;
  mode: ChatbotRetentionMode;
  value: number;
  minDays: number;
  maxDays: number;
  onChange: (mode: ChatbotRetentionMode, value: number) => void;
  errorMessage?: string;
}

/**
 * G2 — 챗봇 보존기간 재정의 1행(`data-governance-ui-spec.md` §3.4.1). "전역 따름/직접 지정/무기한"
 * 라디오 3지 — G1-b의 `RetentionKindEditor`(숫자+무기한 체크박스)와는 UI가 달라 별도 컴포넌트로 둔다.
 */
export function ChatbotRetentionKindEditor({
  kind,
  currentGlobalDays,
  mode,
  value,
  minDays,
  maxDays,
  onChange,
  errorMessage,
}: ChatbotRetentionKindEditorProps): JSX.Element {
  const msg = MESSAGES.dataGovernance.retention;
  const label = msg.kindLabels[kind];
  const globalDaysText = currentGlobalDays === null ? msg.unlimitedDaysLabel : `${currentGlobalDays}${msg.daysUnit}`;
  const groupName = `chatbot-retention-${kind}`;
  const valueInputId = `chatbot-retention-${kind}-value`;

  return (
    <fieldset className="chatbot-retention-kind-editor form-field">
      <legend>{label}</legend>
      <div className="form-field--inline">
        <label>
          <input
            type="radio"
            name={groupName}
            checked={mode === 'GLOBAL'}
            onChange={() => onChange('GLOBAL', value)}
          />{' '}
          {msg.chatbotFollowGlobalOption(globalDaysText)}
        </label>
        <label>
          <input
            type="radio"
            name={groupName}
            checked={mode === 'CUSTOM'}
            onChange={() => onChange('CUSTOM', value)}
          />{' '}
          {msg.chatbotCustomOption}
        </label>
        <input
          id={valueInputId}
          type="number"
          aria-label={`${label} ${msg.chatbotCustomOption}`}
          min={minDays}
          max={maxDays}
          disabled={mode !== 'CUSTOM'}
          value={value}
          onChange={(e) => onChange('CUSTOM', Number(e.target.value))}
          aria-describedby={`${valueInputId}-hint`}
          aria-invalid={Boolean(errorMessage)}
        />
        <span>{msg.daysUnit}</span>
        <label>
          <input
            type="radio"
            name={groupName}
            checked={mode === 'UNLIMITED'}
            onChange={() => onChange('UNLIMITED', value)}
          />{' '}
          {msg.chatbotUnlimitedOption}
        </label>
        <span id={`${valueInputId}-hint`} className="field-hint">
          {msg.minDaysHint(minDays)}
        </span>
      </div>
      <InlineFieldError id={`${valueInputId}-error`} message={errorMessage} />
    </fieldset>
  );
}
