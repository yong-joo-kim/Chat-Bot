import { Parser } from 'htmlparser2';

/**
 * [신규 No.43] 사이트맵 파서(순수 — §6.6 · KB-17). `htmlparser2`(`xmlMode: true`)로 DTD·외부 엔티티를
 * 처리하지 않는다. 추가로 `<!DOCTYPE`·`<!ENTITY`가 문자열에 있으면 **해석 자체를 거부**한다
 * (XXE 원천 차단 — AC-KB6-5).
 */
export interface SitemapParseResult {
  kind: 'URLSET' | 'SITEMAPINDEX' | 'REJECTED' | 'EMPTY';
  locs: string[];
}

const MAX_LOCS = 100_000;

export function parseSitemap(xml: string): SitemapParseResult {
  if (/<!DOCTYPE/i.test(xml) || /<!ENTITY/i.test(xml)) {
    return { kind: 'REJECTED', locs: [] };
  }

  const locs: string[] = [];
  let inLoc = false;
  let currentText = '';
  let sawUrlset = false;
  let sawIndex = false;

  const parser = new Parser(
    {
      onopentag(name) {
        const tag = name.toLowerCase();
        if (tag === 'urlset') sawUrlset = true;
        if (tag === 'sitemapindex') sawIndex = true;
        if (tag === 'loc') {
          inLoc = true;
          currentText = '';
        }
      },
      ontext(text) {
        if (inLoc) currentText += text;
      },
      onclosetag(name) {
        if (name.toLowerCase() === 'loc') {
          inLoc = false;
          const trimmed = currentText.trim();
          if (trimmed && locs.length < MAX_LOCS) locs.push(trimmed);
        }
      },
    },
    { xmlMode: true, recognizeSelfClosing: true },
  );
  parser.write(xml);
  parser.end();

  if (sawIndex) return { kind: 'SITEMAPINDEX', locs };
  if (sawUrlset) return { kind: 'URLSET', locs };
  return { kind: 'EMPTY', locs };
}
