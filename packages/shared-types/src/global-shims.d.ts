/**
 * `tsconfig.base.json`의 `lib`가 `ES2021`뿐이라(DOM 미포함) `URL`·`TextEncoder` 전역 타입이 없다.
 * 두 API는 Node·브라우저 모두에 실제로 존재하는 런타임 전역이므로(Node 10+/11+), 이 패키지가
 * `lib: dom`(window·document 등 불필요한 전역까지 들여옴)이나 `@types/node`(서버 전용 타입 유입 —
 * `apps/web`이 이 패키지만 의존하는 경계와 충돌) 없이도 타입 검사를 통과하도록 최소 형태만 선언한다.
 * `redactLegacyApiOutputs`(`dialogue.ts`) · `ApiSampleResponseSchema`(`legacy-api.ts`)가 사용한다.
 */
declare global {
  class URL {
    constructor(input: string, base?: string | URL);
    protocol: string;
    hostname: string;
    host: string;
    port: string;
    pathname: string;
    search: string;
    hash: string;
    username: string;
    password: string;
    origin: string;
    href: string;
    toString(): string;
  }
  class TextEncoder {
    encode(input?: string): Uint8Array;
  }
}

export {};
