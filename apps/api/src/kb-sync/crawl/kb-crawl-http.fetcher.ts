import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { isIP } from 'node:net';
import { checkEgress } from '../../common/egress/egress-guard';
import { isAllowedOrigin } from '../lib/allowed-origins';
import { classifyAddress, isAddressAllowlisted, isHostnameAllowlisted, parseAllowlist } from '../../legacy-api/lib/ip-policy';
import type { ParsedAllowlist } from '../../legacy-api/lib/ip-policy';
import type { LegacyDnsResolver, LegacyTransport } from '../../legacy-api/transport/legacy-transport.port';

/**
 * [신규 No.43] 세 번째 DI 토큰 — No.26 전송·DNS 부품을 이동 없이 공유한다(ADR-0044 §6 · R-15).
 * `kb-sync.module.ts`가 `NodeHttpTransport`·`NodeDnsResolver` 클래스를 바인딩한다.
 */
export const KB_TRANSPORT = 'KB_TRANSPORT';
export const KB_DNS_RESOLVER = 'KB_DNS_RESOLVER';

export type KbFetchBlockedReason = 'EGRESS_BLOCKED' | 'HOST_NOT_ALLOWED' | 'ABSOLUTE_BLOCKED' | 'PRIVATE_NOT_ALLOWLISTED' | 'DNS_FAILED' | 'INVALID_URL';

export type KbFetchResult =
  | { kind: 'RESPONSE'; status: number; contentType?: string; body: Buffer; headers: Record<string, string> }
  | { kind: 'REDIRECT'; status: number; location: string | undefined; headers: Record<string, string> }
  | { kind: 'BLOCKED'; reason: KbFetchBlockedReason }
  | { kind: 'ERROR'; outcome: 'TIMEOUT' | 'NETWORK_ERROR' | 'RESPONSE_TOO_LARGE' };

export interface KbFetchRequest {
  url: string;
  /** 소스 등록 시 검증된 허용 호스트(정확 일치 — 하위 도메인 자동 포함 없음). */
  allowedHosts: readonly string[];
  /** [pass 12 · RG-26] 허용 출처(host:port, 기본 포트 정규화) — 호스트 이름이 허용 목록에 있어도 이 출처 집합에 없으면(다른 포트) `HOST_NOT_ALLOWED`. */
  allowedOrigins: readonly string[];
  headers?: Record<string, string>;
  maxBytes: number;
  timeoutMs: number;
}

/** [R1 리뷰 M-3 · §6.2] 호스트별 DNS 결과 캐시 TTL — 한 실행 안에서 같은 호스트를 반복 방문해도
 * 매번 DNS를 다시 묻지 않는다. 핀 연결은 캐시된 주소를 쓰되, **판정(classifyAddress 등)은 매번
 * 다시 한다** — 캐시는 "누구에게 물어봤는가"만 아끼고 "그 주소가 지금도 안전한가"는 아끼지 않는다. */
const DNS_CACHE_TTL_MS = 5 * 60_000;

interface DnsCacheEntry {
  addresses: string[];
  expiresAt: number;
}

/**
 * ★ 출구 파일(No.43, `KB_CRAWL`) — 요청마다 `checkEgress('KB_CRAWL', …)` → DNS(캐시 우선) → 모든 주소
 * 판정(절대 차단 불가역 · 사설은 `KB_CRAWL_PRIVATE_ALLOWLIST`만, 캐시 여부와 무관하게 매번 재실행) →
 * 검증 주소 고정 → `transport.request`. 리다이렉트는 **따라가지 않는다**(`redirectMode: 'REPORT'`로
 * 3xx를 그대로 돌려받고, 호출부 `kb-crawl.runner.ts`가 매 단계 범위·출구를 재검증하며 최대 3회
 * 따라간다 — C-8. 재검증 시의 DNS 조회도 이 캐시를 그대로 탄다).
 */
@Injectable()
export class KbCrawlHttpFetcher {
  private readonly dnsCache = new Map<string, DnsCacheEntry>();

  constructor(
    @Inject(KB_TRANSPORT) private readonly transport: LegacyTransport,
    @Inject(KB_DNS_RESOLVER) private readonly dnsResolver: LegacyDnsResolver,
    private readonly config: ConfigService,
  ) {}

  private privateAllowlist(): ParsedAllowlist {
    const raw = this.config.get<string>('KB_CRAWL_PRIVATE_ALLOWLIST') ?? '';
    return parseAllowlist(raw, 'KB_CRAWL_PRIVATE_ALLOWLIST');
  }

  /** [R1 리뷰 M-3] 캐시가 있고 안 만료됐으면 그대로 쓰고, 아니면 다시 물어서 캐시를 채운다(빈 결과는
   * 캐시하지 않는다 — 일시적 DNS 실패를 5분 동안 "실패로 확정"하지 않기 위해). */
  private async resolveHostCached(hostname: string): Promise<string[]> {
    const now = Date.now();
    const cached = this.dnsCache.get(hostname);
    if (cached && cached.expiresAt > now) return cached.addresses;
    const addresses = await this.dnsResolver.lookupAll(hostname);
    if (addresses.length > 0) this.dnsCache.set(hostname, { addresses, expiresAt: now + DNS_CACHE_TTL_MS });
    return addresses;
  }

  async fetchOnce(req: KbFetchRequest): Promise<KbFetchResult> {
    let url: URL;
    try {
      url = new URL(req.url);
    } catch {
      return { kind: 'BLOCKED', reason: 'INVALID_URL' };
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return { kind: 'BLOCKED', reason: 'INVALID_URL' };
    if (url.username || url.password) return { kind: 'BLOCKED', reason: 'INVALID_URL' };
    if (!req.allowedHosts.includes(url.hostname) || !isAllowedOrigin(req.allowedOrigins, url.toString())) return { kind: 'BLOCKED', reason: 'HOST_NOT_ALLOWED' };

    // ② 출구 게이트(모드 OFF면 통과 — 방어 이중화).
    if (checkEgress('KB_CRAWL', url.toString()) === 'BLOCKED') return { kind: 'BLOCKED', reason: 'EGRESS_BLOCKED' };

    // ③ DNS(리터럴이면 생략 · 아니면 5분 캐시 우선 — M-3) → 모든 주소 판정(캐시 여부와 무관하게 매번).
    const isLiteral = isIP(url.hostname) !== 0;
    const candidateAddresses = isLiteral ? [url.hostname] : await this.resolveHostCached(url.hostname);
    if (candidateAddresses.length === 0) return { kind: 'BLOCKED', reason: 'DNS_FAILED' };

    const allowlist = this.privateAllowlist();
    const hostnameAllowlisted = !isLiteral && isHostnameAllowlisted(url.hostname, allowlist);
    for (const addr of candidateAddresses) {
      const cls = classifyAddress(addr);
      if (cls === 'ABSOLUTE_BLOCKED') return { kind: 'BLOCKED', reason: 'ABSOLUTE_BLOCKED' };
      if (cls === 'PRIVATE' && !hostnameAllowlisted && !isAddressAllowlisted(addr, allowlist)) {
        return { kind: 'BLOCKED', reason: 'PRIVATE_NOT_ALLOWLISTED' };
      }
    }

    const result = await this.transport.request({
      url: url.toString(),
      method: 'GET',
      headers: req.headers ?? {},
      body: null,
      pinnedAddresses: candidateAddresses,
      hostname: url.hostname,
      timeoutMs: req.timeoutMs,
      maxBytes: req.maxBytes,
      exitId: 'KB_CRAWL',
      redirectMode: 'REPORT',
      captureHeaders: ['etag', 'last-modified', 'location', 'x-robots-tag', 'content-encoding', 'content-length', 'retry-after'],
    });

    if (result.kind === 'ERROR') {
      if (result.outcome === 'REDIRECT_NOT_ALLOWED') return { kind: 'ERROR', outcome: 'NETWORK_ERROR' }; // redirectMode:REPORT라 도달하지 않음(방어적 폴백)
      return { kind: 'ERROR', outcome: result.outcome };
    }
    const headers = result.headers ?? {};
    // 304(Not Modified)는 리다이렉트가 아니다 — 조건부 요청(`If-None-Match`)의 정상 응답이라 호출부가 "변경 없음"으로 읽는다. 3xx로 한데 묶으면
    // `Location`이 없어 오류로 끝나 조건부 요청이 영영 성공하지 못한다(시작 주소가 304여도 "접속 실패"로 보였다).
    if (result.status >= 300 && result.status < 400 && result.status !== 304) {
      return { kind: 'REDIRECT', status: result.status, location: headers.location, headers };
    }
    return { kind: 'RESPONSE', status: result.status, contentType: result.contentType, body: result.body, headers };
  }
}
