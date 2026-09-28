import { useState } from 'react';
import type { ButtonItem } from '@chat-bot/shared-types';
import { MESSAGES } from '../../../constants/messages';

export interface ProactiveBubblePreviewProps {
  text: string;
  buttons: ButtonItem[];
  primaryColor: string;
}

/**
 * [신규 No.35] PA-C5 — 말풍선 미리보기(화면 설계서 §3.5). 위젯 DOM을 재사용하지 않는다(K-7) —
 * 실제 접근성 보장은 `apps/widget/src/ui/proactive-bubble.ts`가 담당한다. 이 컴포넌트는 저장 전
 * 데스크톱·휴대폰에서 챗봇 스킨 색으로 어떻게 보이는지 근사하는 순수 표시용이며 사건을 보내지 않는다
 * (AC-PA8-4 — `sendProactiveEvent` 호출 0).
 */
export function ProactiveBubblePreview({ text, buttons, primaryColor }: ProactiveBubblePreviewProps): JSX.Element {
  const msg = MESSAGES.proactive.preview;
  const [tab, setTab] = useState<'desktop' | 'mobile'>('desktop');

  return (
    <div className="proactive-preview">
      <div className="proactive-preview-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'desktop'} className={`btn btn-secondary${tab === 'desktop' ? ' active' : ''}`} onClick={() => setTab('desktop')}>
          {msg.tabDesktop}
        </button>
        <button type="button" role="tab" aria-selected={tab === 'mobile'} className={`btn btn-secondary${tab === 'mobile' ? ' active' : ''}`} onClick={() => setTab('mobile')}>
          {msg.tabMobile}
        </button>
      </div>
      {!text.trim() ? (
        <p className="field-hint">{msg.emptyText}</p>
      ) : (
        <div className={`proactive-preview-bubble proactive-preview-bubble--${tab}`} style={{ borderColor: primaryColor }}>
          <span className="proactive-preview-label" style={{ color: primaryColor }}>
            {msg.bubbleLabel}
          </span>
          <p className="proactive-preview-text">{text}</p>
          {buttons.length === 0 ? (
            <button type="button" className="btn btn-secondary" disabled>
              {text}
            </button>
          ) : (
            <div className="proactive-preview-actions">
              {buttons.map((b, i) => (
                <button key={i} type="button" className="btn btn-secondary" disabled style={{ borderColor: primaryColor, color: primaryColor }}>
                  {b.label || '(라벨 없음)'}
                </button>
              ))}
            </div>
          )}
          <div className="proactive-preview-footer">
            <button type="button" className="btn btn-secondary" disabled>
              {msg.dismissLabel}
            </button>
            <button type="button" className="btn btn-secondary" disabled>
              {msg.optOutLabel}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
