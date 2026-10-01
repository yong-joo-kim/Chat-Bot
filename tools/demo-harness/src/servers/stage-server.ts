// 모형·무대 서버(설계 §6.1) — `assets/` 템플릿(stage · site · system · roadmap)에 실행 값을 채워 서빙한다.
// 1단계는 골격만: 라우트·치환·슬러그 검증. 화면 내용(ui-spec §3~§7)은 다음 단계에서 assets만 교체하면 된다.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { startStaticServer, type RunningServer } from './static-server';

export const STAGE_ROUTES: Record<string, string> = {
  '/stage': 'stage.html',
  '/site': 'site.html',
  '/system': 'system.html',
  '/roadmap': 'roadmap.html',
};

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
export function isSafeSlug(s: string | null): s is string {
  return s !== null && SLUG_RE.test(s);
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * `{{NAME}}`은 HTML 이스케이프한 값으로, `{{{NAME}}}`은 하네스가 직접 만든 신뢰 HTML(스니펫 블록 등)을 그대로 치환한다.
 * 값이 없는 이름은 빈 문자열(템플릿 오류가 화면에 새지 않게).
 */
export function fillTemplate(template: string, values: Record<string, string>): string {
  return template
    .replace(/\{\{\{([A-Z0-9_]+)\}\}\}/g, (_m, name: string) => values[name] ?? '')
    .replace(/\{\{([A-Z0-9_]+)\}\}/g, (_m, name: string) => escapeHtml(values[name] ?? ''));
}

export interface StageBotInfo {
  name: string;
  /** `GET /chatbots/:id/embed-code`의 `pc` 스니펫 — 화면 표시와 실제 삽입에 같은 값을 쓴다(ui-spec §5.2 단일 출처). */
  snippet: string;
}

/** 서버가 만든 스니펫만 신뢰 HTML로 쓴다 — `<script ...></script>` 한 덩어리이고 그 안에 다른 태그가 없을 때만. */
export function isSafeSnippet(snippet: string): boolean {
  return /^<script(\s[^<>]*)?><\/script>$/.test(snippet.trim());
}

export function buildSiteValues(bot: StageBotInfo | undefined, snippetOff: boolean): Record<string, string> {
  if (!bot || !isSafeSnippet(bot.snippet)) return { BOT_NAME: bot ? bot.name : '', SNIPPET_BLOCK: '', SNIPPET_SCRIPT: '' };
  const block =
    '<section class="snippet" aria-labelledby="snip-h"><h2 id="snip-h" style="margin:0;font-size:18px"><span class="chip">시연 안내</span>이 홈페이지에는 챗봇 설치 코드가 한 줄 들어 있습니다</h2>' +
    `<pre aria-label="챗봇 설치 코드 예시">${escapeHtml(bot.snippet)}</pre></section>`;
  return { BOT_NAME: bot.name, SNIPPET_BLOCK: snippetOff ? '' : block, SNIPPET_SCRIPT: bot.snippet.trim() };
}

export interface StageServerOptions {
  port: number;
  assetsDir: string;
  /** 템플릿 값(콘솔·위젯·API 주소 등) — 요청 때마다 호출해 실행 중 값 변화를 반영한다. */
  values: () => Record<string, string>;
  /** slug -> 챗봇 표시 이름·스니펫(데이터 생성 뒤 채워진다). */
  bots?: () => Record<string, StageBotInfo>;
  /** `/__facts` JSON(시작/마무리 카드용). */
  facts?: () => unknown;
}

export function startStageServer(opts: StageServerOptions): Promise<RunningServer> {
  return startStaticServer({
    name: 'stage',
    port: opts.port,
    root: opts.assetsDir,
    route: (req: IncomingMessage, res: ServerResponse, url: URL) => {
      if (url.pathname === '/__facts' && req.method === 'GET') {
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
        res.end(JSON.stringify(opts.facts?.() ?? {}));
        return true;
      }
      const file = STAGE_ROUTES[url.pathname];
      if (!file || (req.method !== 'GET' && req.method !== 'HEAD')) return false;
      const path = join(opts.assetsDir, file);
      if (!existsSync(path)) {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
        res.end(`템플릿이 없습니다: ${file}`);
        return true;
      }
      const bot = url.searchParams.get('bot');
      const slug = isSafeSlug(bot) ? bot : '';
      const info = slug ? opts.bots?.()[slug] : undefined;
      if (url.pathname === '/site' && slug && !info && opts.bots) {
        res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
        res.end('<!doctype html><html lang="ko"><meta charset="utf-8"><title>가온마켓</title><p>연결할 챗봇을 찾지 못했습니다</p></html>');
        return true;
      }
      const values = { ...opts.values(), BOT_SLUG: slug, ...buildSiteValues(info, url.searchParams.get('snippet') === 'off') };
      const html = fillTemplate(readFileSync(path, 'utf8'), values);
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end(req.method === 'HEAD' ? undefined : html);
      return true;
    },
  });
}
