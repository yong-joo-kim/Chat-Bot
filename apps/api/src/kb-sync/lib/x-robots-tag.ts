/**
 * [신규 No.43 — pass 5 · RG-11] `X-Robots-Tag` 응답 헤더 해석(순수). 메타 `robots`와 같은 지시어(`noindex`·`nofollow`·`none`)를
 * 읽는다. 값 앞에 `<봇 이름>:`이 붙은 지시는 그 봇에게만 적용되므로 우리 제품 토큰(`ChatBotKBCrawler`)이거나 봇 이름이 없을
 * 때만 반영한다(`googlebot: noindex`는 우리에게 해당 없음). 쉼표로 여러 헤더 값이 합쳐진 경우도 처리한다.
 */
export interface XRobotsTagDirectives {
  noindex: boolean;
  nofollow: boolean;
}

const KNOWN_DIRECTIVES = new Set(['all', 'noindex', 'nofollow', 'none', 'noarchive', 'nosnippet', 'noimageindex', 'notranslate', 'indexifembedded', 'unavailable_after', 'max-snippet', 'max-image-preview', 'max-video-preview']);

export function parseXRobotsTag(value: string | undefined | null, productToken: string): XRobotsTagDirectives {
  const result: XRobotsTagDirectives = { noindex: false, nofollow: false };
  if (!value) return result;
  const me = productToken.toLowerCase();
  // [pass 6 · RG-20④] 쉼표 조각마다 따로 판정한다 — `봇 이름:`이 붙은 조각만 그 봇의 것이고, 접두 없는 조각은 "모든 봇"용이라 늘 우리에게
  // 적용한다. 같은 이름의 헤더 여러 줄이 `, `로 합쳐지면 줄 경계를 복원할 수 없어(`googlebot: noindex` 줄 뒤의 접두 없는 `noindex` 줄이 앞 봇의
  // 몫으로 읽혀 우리에게 준 noindex를 놓치던 문제) 모호한 경우는 noindex·nofollow를 놓치지 않는 안전한 쪽으로 읽는다(과적용은 문서를 덜 적재할 뿐이다).
  for (const rawPart of value.split(',')) {
    let part = rawPart.trim().toLowerCase();
    if (!part) continue;
    let appliesToMe = true;
    const colon = part.indexOf(':');
    if (colon > 0) {
      const head = part.slice(0, colon).trim();
      if (!KNOWN_DIRECTIVES.has(head)) {
        appliesToMe = head === me;
        part = part.slice(colon + 1).trim();
      }
    }
    if (!appliesToMe) continue;
    if (part === 'noindex' || part === 'none') result.noindex = true;
    if (part === 'nofollow' || part === 'none') result.nofollow = true;
  }
  return result;
}
