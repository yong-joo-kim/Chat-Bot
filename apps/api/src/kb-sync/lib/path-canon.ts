import { globMatchUnits } from './glob-match';

/**
 * [pass 6 · M-4 · RFC 9309 §2.2.2] 경로 비교용 정준형(순수). `new URL().pathname`은 한글 같은 비ASCII를 UTF-8 퍼센트 인코딩(대문자 16진)으로
 * 돌려주지만 robots.txt 규칙·`pathPrefixes`·제외 글롭은 관리자·사이트가 적은 원문(한글) 그대로라 서로 다른 형태를 비교하면
 * `Disallow: /관리`가 무시되고 `pathPrefixes: ['/규정']`은 늘 범위 밖이 된다. 양쪽을 같은 형태로 맞춘다 — 비ASCII 문자는 UTF-8 퍼센트
 * 인코딩으로, 이미 적힌 `%xx`는 대문자로. ASCII(글롭 `*`·`?`, robots `*`·`$` 포함)는 그대로 둔다.
 */
export function canonicalizePathForMatch(value: string): string {
  let out = '';
  for (const ch of value) {
    if ((ch.codePointAt(0) ?? 0) < 0x80) {
      out += ch;
      continue;
    }
    try {
      out += encodeURIComponent(ch);
    } catch {
      out += ch; // 짝 없는 서로게이트 — 그대로 둔다(어차피 URL 경로로 들어오지 않는다).
    }
  }
  return out.replace(/%[0-9a-fA-F]{2}/g, (m) => m.toUpperCase());
}

/** 경로 접두 경계 검사(Low-5) — `/docs`는 `/docs`·`/docs/`·`/docs/a`만 통과시키고 `/docsecret/`은 막는다. 슬래시로 끝나는 접두는 그 아래를 통과시킨다. */
export function pathMatchesPrefix(pathname: string, prefix: string): boolean {
  if (pathname === prefix) return true;
  if (!pathname.startsWith(prefix)) return false;
  return prefix.endsWith('/') || pathname[prefix.length] === '/';
}

const HEX2 = /^[0-9A-F]{2}$/;

function percentByteAt(s: string, i: number): number | null {
  if (s[i] !== '%') return null;
  const hex = s.slice(i + 1, i + 3);
  return HEX2.test(hex) ? parseInt(hex, 16) : null;
}

/**
 * [pass 7 · N-13] 정준형 경로를 글롭 매칭용 "문자 1개" 단위로 나눈다(순수). 정준형에서 한글 1자는 `%EA%B0%80`(9글자)로 바뀌므로 글자 단위로 세면 글롭 `?`가 한글 1자에
 * 매칭하지 못한다(`/docs/??`가 한글 2자에 안 맞음). 단위 = ASCII 1자 · `%HH`(ASCII 범위 — `%2F` 포함) 1개 · 올바른 UTF-8 다바이트 열(`%HH` 2~4개) 1개.
 * 깨진 열(연속 바이트 부족·단독 연속 바이트)은 `%HH` 1개씩, `%` 뒤가 16진 두 자리가 아니면 `%` 1글자.
 */
export function splitPathUnits(canon: string): string[] {
  const units: string[] = [];
  let i = 0;
  while (i < canon.length) {
    const lead = percentByteAt(canon, i);
    if (lead === null) {
      const cp = canon.codePointAt(i) ?? 0;
      const len = cp > 0xffff ? 2 : 1; // 짝 있는 서로게이트는 1단위(정준형에는 나오지 않지만 방어).
      units.push(canon.slice(i, i + len));
      i += len;
      continue;
    }
    const need = lead >= 0xf0 && lead <= 0xf4 ? 4 : lead >= 0xe0 && lead <= 0xef ? 3 : lead >= 0xc2 && lead <= 0xdf ? 2 : 1;
    let ok = need > 1;
    for (let k = 1; ok && k < need; k += 1) {
      const cont = percentByteAt(canon, i + k * 3);
      if (cont === null || cont < 0x80 || cont > 0xbf) ok = false;
    }
    const take = ok ? need : 1;
    units.push(canon.slice(i, i + take * 3));
    i += take * 3;
  }
  return units;
}

/**
 * [pass 7 · N-13] 경로 글롭 매칭 — 패턴과 경로를 같은 정준형으로 맞춘 뒤 "문자 1개" 단위로 비교한다(`?` = 문자 1개(한글 1자 포함) · `*` = 0개 이상).
 */
export function globMatchPath(pattern: string, path: string): boolean {
  return globMatchUnits(splitPathUnits(canonicalizePathForMatch(pattern)), splitPathUnits(canonicalizePathForMatch(path)));
}
