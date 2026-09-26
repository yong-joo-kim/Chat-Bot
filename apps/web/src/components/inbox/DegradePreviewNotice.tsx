import { useState } from 'react';
import type { DegradePreview } from '@chat-bot/shared-types';
import { OutputRenderer } from '../OutputRenderer';
import { AssumedPreviewBadge } from '../AssumedPreviewBadge';
import { DegradeChangesNotice } from '../DegradeChangesNotice';
import { MESSAGES } from '../../constants/messages';

/**
 * RM-7 — 통합 인박스(No.42) 시뮬레이션의 "이 채널에서는 이렇게 보입니다" 격하 미리보기
 * (channel-rich-messages-ui-spec.md §3.7). `changes.length === 0`(가상 채널 WEB 등)이면 아무것도
 * 렌더하지 않는다(노이즈 방지). `outputs`는 접었다 펼 때만 `OutputRenderer`에 전달한다.
 */
export function DegradePreviewNotice({ preview }: { preview: 'NOT_DEFINED' | DegradePreview }): JSX.Element | null {
  const [expanded, setExpanded] = useState(false);
  const msg = MESSAGES.inbox;

  if (preview === 'NOT_DEFINED') return null;
  if (preview.changes.length === 0) return null;

  return (
    <div className="degrade-preview-notice">
      {preview.source !== 'MEASURED' && <AssumedPreviewBadge />}
      <DegradeChangesNotice changes={preview.changes} />
      <button type="button" className="link-button" aria-expanded={expanded} onClick={() => setExpanded((v) => !v)}>
        {expanded ? msg.degradePreviewToggleHide : msg.degradePreviewToggleShow}
      </button>
      {expanded && (
        <div className="channel-preview-container">
          <OutputRenderer outputs={preview.outputs} onButtonClick={() => undefined} />
        </div>
      )}
    </div>
  );
}
