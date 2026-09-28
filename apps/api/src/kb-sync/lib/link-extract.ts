/**
 * [신규 No.43] 상대 링크 → 절대 URL 해석(순수 — §6.6 링크 탐색). 범위·정규화는 `scope-match`·
 * `url-normalize`가 별도로 담당한다(이 파일은 해석·중복 제거만).
 */
export function resolveLinks(baseUrl: string, hrefs: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const href of hrefs) {
    if (!href || href.startsWith('#') || href.startsWith('javascript:') || href.startsWith('mailto:') || href.startsWith('tel:')) continue;
    let resolved: string;
    try {
      resolved = new URL(href, baseUrl).toString();
    } catch {
      continue;
    }
    if (!seen.has(resolved)) {
      seen.add(resolved);
      out.push(resolved);
    }
  }
  return out;
}
