import { useState } from 'react';
import { MESSAGES } from '../../constants/messages';

export interface PreviewSkin {
  primaryColor: string;
  headerTitle: string;
  logoUrl?: string;
}

/**
 * 위젯 외형을 흉내 낸 목업(ui-spec §8 — 실제 위젯 컴포넌트가 아니다).
 * `headerTitle`은 JSX 텍스트 노드로만 렌더링되어 HTML/스크립트가 실행되지 않는다(NFR-S2, AC-4-11).
 */
export function SkinPreviewPanel({ skin }: { skin: PreviewSkin }): JSX.Element {
  const [logoFailed, setLogoFailed] = useState(false);
  const validColor = /^#[0-9a-fA-F]{6}$/.test(skin.primaryColor) ? skin.primaryColor : '#4F46E5';

  return (
    <div className="skin-preview-panel">
      <p className="skin-preview-title">{MESSAGES.skin.previewTitle}</p>
      <div className="skin-preview-mock">
        <div className="skin-preview-header" style={{ backgroundColor: validColor }}>
          {skin.logoUrl && !logoFailed && (
            <img src={skin.logoUrl} alt="" className="skin-preview-logo" onError={() => setLogoFailed(true)} />
          )}
          <span className="skin-preview-header-title">{skin.headerTitle || '챗봇 상담'}</span>
        </div>
        <div className="skin-preview-body">
          <p className="skin-preview-bubble">{MESSAGES.skin.previewGreeting}</p>
        </div>
        <div className="skin-preview-input-row">
          <input type="text" placeholder={MESSAGES.skin.previewPlaceholder} disabled aria-label={MESSAGES.skin.previewPlaceholder} />
          <button type="button" disabled>
            {MESSAGES.skin.previewSend}
          </button>
        </div>
      </div>
    </div>
  );
}
