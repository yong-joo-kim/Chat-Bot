import { mountWidgetRoot } from './ui/shadow-root';
import { createWidgetApp } from './ui/app';

/**
 * 임베드 로더 진입점(`dist/widget.js`, FR-W-2). `EmbedCodeService`가 생성한 기존 스니펫 계약을
 * 그대로 읽는다: `data-chatbot`(slug) · `data-api-base` · `data-mode`(desktop/mobile) · `data-fullscreen`.
 * 전역 심볼은 `window.__ChatBotWidget` 1개뿐(EX-W-3) — 스니펫이 2회 삽입되면 두 번째는 무시한다(EX-W-4).
 */
declare global {
  interface Window {
    __ChatBotWidget?: { version: string };
  }
}

function findScriptEl(): HTMLScriptElement | null {
  if (document.currentScript instanceof HTMLScriptElement) return document.currentScript;
  const scripts = document.querySelectorAll<HTMLScriptElement>('script[data-chatbot]');
  return scripts.length > 0 ? scripts[scripts.length - 1] : null;
}

function boot(): void {
  if (window.__ChatBotWidget) {
    console.warn('[ChatBotWidget] 이미 초기화되었습니다 — 중복 삽입을 무시합니다.');
    return;
  }

  const scriptEl = findScriptEl();
  const slug = scriptEl?.dataset.chatbot;
  const apiBase = scriptEl?.dataset.apiBase;
  if (!slug || !apiBase) {
    console.warn('[ChatBotWidget] data-chatbot / data-api-base 속성이 필요합니다.');
    return;
  }
  const mode = scriptEl?.dataset.mode === 'mobile' ? 'mobile' : 'desktop';
  const fullscreen = scriptEl?.dataset.fullscreen === 'true';

  window.__ChatBotWidget = { version: '0.1.0' };
  console.info(`[ChatBotWidget] widget.js v${window.__ChatBotWidget.version} 로드됨`);

  const mount = mountWidgetRoot();
  createWidgetApp(mount, { slug, apiBase, mode, autoOpen: fullscreen });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
