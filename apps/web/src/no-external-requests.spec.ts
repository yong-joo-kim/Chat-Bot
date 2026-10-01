import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * DHX-1 회귀 방지 — 관리 콘솔은 폐쇄망/구축형 시연에서 외부 호스트(Google Fonts 등)로
 * 요청을 보내지 않아야 한다. index.html과 src 소스(CSS/TS/TSX)를 정적으로 스캔한다.
 */
const webRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const FORBIDDEN_HOSTS = /fonts\.googleapis\.com|fonts\.gstatic\.com|cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com|unpkg\.com|use\.typekit\.net|use\.fontawesome\.com/i;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(css|ts|tsx)$/.test(name) && !/\.spec\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

describe('외부 호스트 요청 금지 (DHX-1)', () => {
  const html = readFileSync(join(webRoot, 'index.html'), 'utf8');

  it('index.html에 외부 글꼴/CDN 호스트 참조가 없다', () => {
    expect(html).not.toMatch(FORBIDDEN_HOSTS);
  });

  it('index.html의 link/script는 외부(http/https/프로토콜 상대) 리소스를 가리키지 않는다', () => {
    expect(html).not.toMatch(/<(link|script)\b[^>]*\b(href|src)=["'](https?:)?\/\//i);
  });

  it('src의 CSS/TS/TSX 소스에 외부 글꼴/CDN 호스트와 원격 @import가 없다', () => {
    const offenders = walk(join(webRoot, 'src')).filter((f) => {
      const text = readFileSync(f, 'utf8');
      return FORBIDDEN_HOSTS.test(text) || /@import\s+(url\()?["']?(https?:)?\/\//i.test(text);
    });
    expect(offenders).toEqual([]);
  });
});
