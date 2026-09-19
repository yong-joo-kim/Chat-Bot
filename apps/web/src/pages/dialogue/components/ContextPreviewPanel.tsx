import type { ContextSlot } from '@chat-bot/shared-types';
import { MESSAGES } from '../../../constants/messages';

export interface ContextPreviewPanelProps {
  slots: ContextSlot[];
  completionMessage?: string;
}

/** D4a/D4b — 대화 미리보기(ui-spec §4.6, FR-8-7). 서버 왕복 없이 클라이언트에서만 렌더링한다. */
export function ContextPreviewPanel({ slots, completionMessage }: ContextPreviewPanelProps): JSX.Element {
  return (
    <div className="context-preview-panel">
      <p className="skin-preview-title">{MESSAGES.dialogue.contexts.previewTitle}</p>
      {slots.length === 0 && <p className="field-hint">슬롯을 추가하면 미리보기가 표시됩니다.</p>}
      {slots.map((slot, i) => (
        <div key={`${slot.name || i}`}>
          <p className="context-preview-bubble">
            <span aria-hidden="true">🤖</span> {slot.prompt || `(${i + 1}번째 슬롯 질문 미입력)`}
          </p>
          {slot.type === 'CHOICE' && (slot.choices?.length ?? 0) > 0 && (
            <div className="context-preview-choices">
              {slot.choices?.map((c) => (
                <span key={c} className="context-preview-choice">
                  {c}
                </span>
              ))}
            </div>
          )}
        </div>
      ))}
      {completionMessage && <p className="context-preview-bubble">🤖 {completionMessage}</p>}
    </div>
  );
}
