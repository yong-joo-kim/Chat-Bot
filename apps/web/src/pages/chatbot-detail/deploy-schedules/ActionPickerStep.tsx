import { useRef } from 'react';
import type { DeployScheduleAction } from '@chat-bot/shared-types';
import { MESSAGES } from '../../../constants/messages';

export interface ActionPickerOption {
  action: DeployScheduleAction;
  disabled: boolean;
  disabledHint?: string;
}

/**
 * S1 "+ 예약 만들기"에서만 렌더되는 1단계(동작 3종 카드 선택, `scheduled-deploy-ui-spec.md` §4.3).
 * 방향키로 탐색 가능한 라디오 그룹(UIUX §6).
 */
export function ActionPickerStep({ options, onSelect }: { options: ActionPickerOption[]; onSelect: (action: DeployScheduleAction) => void }): JSX.Element {
  const msg = MESSAGES.deploySchedules.actionPicker;
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const labels: Record<DeployScheduleAction, { title: string; desc: string }> = {
    RESTORE_VERSION: { title: msg.RESTORE_VERSION, desc: msg.RESTORE_VERSION_DESC },
    PUBLISH: { title: msg.PUBLISH, desc: msg.PUBLISH_DESC },
    SET_WEB_CHANNEL: { title: msg.SET_WEB_CHANNEL, desc: msg.SET_WEB_CHANNEL_DESC },
  };
  const disabledHints: Record<DeployScheduleAction, string> = {
    RESTORE_VERSION: msg.RESTORE_VERSION_DISABLED_HINT,
    PUBLISH: msg.PUBLISH_DISABLED_HINT,
    SET_WEB_CHANNEL: '',
  };

  function handleKeyDown(e: React.KeyboardEvent, index: number): void {
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
      e.preventDefault();
      refs.current[Math.min(index + 1, options.length - 1)]?.focus();
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
      e.preventDefault();
      refs.current[Math.max(index - 1, 0)]?.focus();
    }
  }

  return (
    <div className="action-picker-step" role="radiogroup" aria-label={MESSAGES.deploySchedules.createButton}>
      {options.map((opt, index) => (
        <button
          key={opt.action}
          type="button"
          ref={(el) => {
            refs.current[index] = el;
          }}
          className="action-picker-card"
          role="radio"
          aria-checked={false}
          aria-disabled={opt.disabled}
          title={opt.disabled ? opt.disabledHint ?? disabledHints[opt.action] : undefined}
          onKeyDown={(e) => handleKeyDown(e, index)}
          onClick={() => !opt.disabled && onSelect(opt.action)}
        >
          <strong>{labels[opt.action].title}</strong>
          <span>{labels[opt.action].desc}</span>
          {opt.disabled && <span className="field-hint">{opt.disabledHint ?? disabledHints[opt.action]}</span>}
        </button>
      ))}
    </div>
  );
}
