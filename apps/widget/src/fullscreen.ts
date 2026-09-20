import { mountWidgetRoot } from './ui/shadow-root';
import { createWidgetApp } from './ui/app';

/** `/c/:slug` 전체화면 진입점(FR-W-3, §5.7). 런처 없이 바로 `OPEN` 상태로 시작한다. */
function extractSlug(): string | null {
  const match = /\/c\/([^/?#]+)/.exec(window.location.pathname);
  return match ? decodeURIComponent(match[1]) : null;
}

function boot(): void {
  const slug = extractSlug();
  const apiBase = import.meta.env.VITE_PUBLIC_API_BASE_URL as string | undefined;
  if (!slug || !apiBase) {
    document.body.textContent = '잘못된 접근입니다.';
    return;
  }
  const mount = mountWidgetRoot();
  createWidgetApp(mount, { slug, apiBase, mode: 'mobile', autoOpen: true });
}

boot();
