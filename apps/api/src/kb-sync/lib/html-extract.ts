import { Parser } from 'htmlparser2';

/**
 * [신규 No.43] HTML 본문·링크·메타 추출(순수 — §7.4 · FR-KB2-8). `htmlparser2` 스트리밍 SAX 1패스 —
 * DOM 트리를 만들지 않는다. 스크립트 실행 0 · 외부 리소스 요청 0.
 */
export interface HtmlExtractResult {
  text: string;
  title: string | null;
  links: string[];
  noindex: boolean;
  nofollow: boolean;
  canonical: string | null;
}

const REMOVE_TAGS = new Set(['script', 'style', 'noscript', 'template', 'svg', 'iframe', 'object', 'embed', 'canvas', 'nav', 'header', 'footer', 'aside', 'form', 'button', 'select']);
const SUPPRESSED_ROLES = new Set(['navigation', 'banner', 'contentinfo', 'search']);
const BLOCK_BREAK_TAGS = new Set(['p', 'div', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'tr', 'table', 'ul', 'ol']);
const HEADING_PREFIX: Record<string, string> = { h1: '# ', h2: '## ', h3: '### ' };

export function extractHtml(html: string, uaMetaName = 'ChatBotKBCrawler'): HtmlExtractResult {
  const hasMainRegion = /<main[\s>]|role=["']main["']|<article[\s>]/i.test(html);

  interface Frame {
    tag: string;
    suppressed: boolean;
  }
  const stack: Frame[] = [];
  let insideTargetDepth: number | null = null;
  let buffer = '';
  let titleBuffer = '';
  let inTitle = false;
  const links: string[] = [];
  let noindex = false;
  let nofollow = false;
  let canonical: string | null = null;
  let pendingHeadingPrefix = false;
  let firstCellInRow = true;

  function emit(text: string): void {
    const top = stack[stack.length - 1];
    const suppressed = top?.suppressed ?? false;
    if (suppressed) return;
    if (hasMainRegion && insideTargetDepth === null) return;
    if (pendingHeadingPrefix) {
      buffer += text;
      pendingHeadingPrefix = false;
    } else {
      buffer += text;
    }
  }

  const parser = new Parser(
    {
      onopentag(name, attribs) {
        const tag = name.toLowerCase();
        if (tag === 'title') {
          inTitle = true;
        }
        if (tag === 'meta') {
          const metaName = (attribs.name ?? '').toLowerCase();
          const content = (attribs.content ?? '').toLowerCase();
          if (metaName === 'robots' || metaName === uaMetaName.toLowerCase()) {
            if (content.includes('noindex')) noindex = true;
            if (content.includes('nofollow')) nofollow = true;
          }
        }
        if (tag === 'link' && (attribs.rel ?? '').toLowerCase() === 'canonical' && attribs.href) {
          canonical = attribs.href;
        }
        if (tag === 'a' && attribs.href) {
          links.push(attribs.href);
        }

        const parentSuppressed = stack.length > 0 ? stack[stack.length - 1].suppressed : false;
        const role = (attribs.role ?? '').toLowerCase();
        const suppressedHere =
          parentSuppressed ||
          REMOVE_TAGS.has(tag) ||
          attribs.hidden !== undefined ||
          (attribs['aria-hidden'] ?? '').toLowerCase() === 'true' ||
          SUPPRESSED_ROLES.has(role);

        stack.push({ tag, suppressed: suppressedHere });

        if (hasMainRegion && insideTargetDepth === null && (tag === 'main' || tag === 'article' || role === 'main')) {
          insideTargetDepth = stack.length;
        }

        if (tag === 'br') emit('\n');
        if (tag === 'li') emit('\n• ');
        if (tag === 'tr') firstCellInRow = true;
        if ((tag === 'td' || tag === 'th') && !firstCellInRow) emit(' | ');
        if (tag === 'td' || tag === 'th') firstCellInRow = false;
        if (HEADING_PREFIX[tag]) {
          emit(`\n${HEADING_PREFIX[tag]}`);
          pendingHeadingPrefix = false;
        }
      },
      ontext(text) {
        if (inTitle) titleBuffer += text;
        emit(text);
      },
      onclosetag(name) {
        const tag = name.toLowerCase();
        if (tag === 'title') inTitle = false;
        if (BLOCK_BREAK_TAGS.has(tag)) emit('\n');
        if (insideTargetDepth !== null && stack.length === insideTargetDepth) insideTargetDepth = null;
        stack.pop();
      },
    },
    { decodeEntities: true },
  );
  parser.write(html);
  parser.end();

  const text = buffer.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  const title = titleBuffer.trim() || null;

  return { text, title, links, noindex, nofollow, canonical };
}
