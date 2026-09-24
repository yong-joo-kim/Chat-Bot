/**
 * [No.26] 전송 포트(§7.3, §7.6) — 테스트 대체 지점(NFR-LM2). DB·Nest·네트워크 무의존 인터페이스만.
 * 구현은 `node-http.transport.ts`(★ `node:http`/`node:https` import 유일 파일) ·
 * `node-dns.resolver.ts`(★ `node:dns` import 유일 파일)뿐이다.
 */

export interface LegacyTransportRequest {
  /** `build-request.ts`가 조립·재검증한 최종 URL(문자열). */
  url: string;
  method: 'GET' | 'POST';
  headers: Record<string, string>;
  body: string | null;
  /** 검증된 주소로만 연결한다(재바인딩 방지) — 커스텀 `lookup`이 이 배열만 반환한다. */
  pinnedAddresses: string[];
  hostname: string;
  timeoutMs: number;
  maxBytes: number;
}

export type LegacyTransportOutcome = 'TIMEOUT' | 'NETWORK_ERROR' | 'REDIRECT_NOT_ALLOWED' | 'RESPONSE_TOO_LARGE';

export type LegacyTransportResult =
  | { kind: 'RESPONSE'; status: number; contentType?: string; bytes: number; body: Buffer }
  | { kind: 'ERROR'; outcome: LegacyTransportOutcome; errorCode?: string };

export interface LegacyTransport {
  request(req: LegacyTransportRequest): Promise<LegacyTransportResult>;
}

export interface LegacyDnsResolver {
  /** `dns.lookup({ all:true, verbatim:true })` — 1회만 호출한다. 해석 실패는 빈 배열. */
  lookupAll(hostname: string): Promise<string[]>;
}

/** DI 토큰(NFR-LM2) — 시험에서 가짜 리졸버·가짜 전송으로 교체하는 지점. */
export const LEGACY_DNS_RESOLVER = 'LEGACY_DNS_RESOLVER';
export const LEGACY_TRANSPORT = 'LEGACY_TRANSPORT';
