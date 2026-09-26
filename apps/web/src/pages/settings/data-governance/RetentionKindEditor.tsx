import type { RetentionTargetKind } from '@chat-bot/shared-types';
import { InlineFieldError } from '../../../components/InlineFieldError';
import { MESSAGES } from '../../../constants/messages';

export interface RetentionKindEditorProps {
  kind: RetentionTargetKind;
  /** 지금 유효한 값(유예 반영) — null = 무기한. */
  currentDays: number | null;
  /** 폼의 새 값(무기한 체크 시 무시됨). */
  value: number;
  unlimited: boolean;
  minDays: number;
  maxDays: number;
  onChange: (value: number, unlimited: boolean) => void;
  errorMessage?: string;
}

/**
 * G1-b(전역) 보존 대상 1행(`data-governance-ui-spec.md` §2.3 `RetentionKindEditor`). 초기값은
 * 현재 유효값으로 채워 두고 사용자가 명시적으로 바꾼 값만 반영한다(UIUX §6 "기본값 임의 선택 금지").
 */
export function RetentionKindEditor({ kind, currentDays, value, unlimited, minDays, maxDays, onChange, errorMessage }: RetentionKindEditorProps): JSX.Element {
  const msg = MESSAGES.dataGovernance.retention;
  const label = msg.kindLabels[kind];
  const currentText = currentDays === null ? msg.unlimitedDaysLabel : `${currentDays}${msg.daysUnit}`;
  const inputId = `retention-kind-${kind}`;
  const unlimitedId = `${inputId}-unlimited`;

  return (
    <div className="retention-kind-editor form-field">
      <span className="field-label-static">{label}</span>
      <p className="field-hint">{msg.followGlobalLabel(currentText)}</p>
      <div className="form-field--inline">
        <label htmlFor={inputId}>{msg.columnNew}</label>
        <input
          id={inputId}
          type="number"
          min={minDays}
          max={maxDays}
          disabled={unlimited}
          value={value}
          onChange={(e) => onChange(Number(e.target.value), unlimited)}
          aria-describedby={`${inputId}-hint${errorMessage ? ` ${inputId}-error` : ''}`}
          aria-invalid={Boolean(errorMessage)}
        />
        <label htmlFor={unlimitedId}>
          <input id={unlimitedId} type="checkbox" checked={unlimited} onChange={(e) => onChange(value, e.target.checked)} /> {msg.unlimitedLabel}
        </label>
        <span id={`${inputId}-hint`} className="field-hint">
          {msg.minDaysHint(minDays)}
        </span>
      </div>
      <InlineFieldError id={`${inputId}-error`} message={errorMessage} />
    </div>
  );
}
