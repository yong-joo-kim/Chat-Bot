import type { EgressExitId } from '@chat-bot/shared-types';

/**
 * [No.26] 전송 포트(§7.3, §7.6) — 테스트 대체 지점(NFR-LM2). DB·Nest·네트워크 무의존 인터페이스만.
 * 구현은 `node-http.transport.ts`(★ `node:http`/`node:https` import 유일 파일) ·
 * `node-dns.resolver.ts`(★ `node:dns` import 유일 파일)뿐이다.
 * [신규 No.41] `exitId`·`responseMode` 선택 필드 추가 — 업무 자동화 웹훅 발송기가 같은 전송 파일을
 * 이동 없이 두 번째 출구로 공유한다(ADR-0041 §6). 기본값 = 현행 동작(레거시 호출부·spec 무수정).
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
  /** [신규 No.41] 방어 이중화 가드(`checkEgress`)의 출구 id — 미지정 시 `LEGACY_API`(현행 동작). */
  exitId?: EgressExitId;
  /** [신규 No.41] `STATUS_ONLY`면 헤더 수신 시 상태 확정 → 본문은 `maxBytes`까지만 소비 후 폐기
   * (큰 본문이 상태 코드를 삼키는 것을 막는다, §9.4 제약①). 미지정 시 `BODY`(현행 동작). */
  responseMode?: 'BODY' | 'STATUS_ONLY';
}

export type LegacyTransportOutcome = 'TIMEOUT' | 'NETWORK_ERROR' | 'REDIRECT_NOT_ALLOWED' | 'RESPONSE_TOO_LARGE';

export type LegacyTransportResult =
  | { kind: 'RESPONSE'; status: number; contentType?: string; bytes: number; body: Buffer; retryAfter?: string }
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
