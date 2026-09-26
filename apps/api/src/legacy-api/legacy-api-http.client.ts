import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { isIP } from 'node:net';
import type { ApiConnectionAuthType } from '@chat-bot/shared-types';
import { checkEgress } from '../common/egress/egress-guard';
import type { ValidatedLegacyRequest } from './lib/build-request';
import { classifyAddress, isAddressAllowlisted, isHostnameAllowlisted, parseAllowlist } from './lib/ip-policy';
import { LEGACY_DNS_RESOLVER, LEGACY_TRANSPORT } from './transport/legacy-transport.port';
import type { LegacyDnsResolver, LegacyTransport } from './transport/legacy-transport.port';
import { LegacyApiSecretResolver } from './legacy-api-secret.resolver';

export type LegacyHttpErrorOutcome =
  | 'TIMEOUT'
  | 'NETWORK_ERROR'
  | 'BLOCKED_ADDRESS'
  | 'REDIRECT_NOT_ALLOWED'
  | 'RESPONSE_TOO_LARGE'
  | 'SECRET_MISSING'
  // [신규 No.45] 출구 허용 목록 밖 호스트 — DNS 조회 전에 차단(데이터 거버넌스 모드).
  | 'EGRESS_BLOCKED';

export type LegacyHttpResult =
  | { kind: 'RESPONSE'; status: number; contentType?: string; bytes: number; body: Buffer }
  | { kind: 'ERROR'; outcome: LegacyHttpErrorOutcome; blockedAddress?: string; errorCode?: string };

export interface LegacyAuthSpec {
  authType: ApiConnectionAuthType;
  authHeaderName?: string | null;
  secretRef?: string | null;
}

/**
 * ★ 레거시 호출 유일 출구(§7.3, FR-0-99). `ValidatedLegacyRequest`(브랜드 타입)만 받는다 — 임의 URL
 * 문자열을 받는 메서드가 없다. `LegacyApiModule`은 이 클래스를 export하지 않는다(생성자 주입만 허용
 * — `LegacyApiService` 1곳, §13 L-4).
 */
@Injectable()
export class LegacyApiHttpClient {
  constructor(
    @Inject(LEGACY_DNS_RESOLVER) private readonly dnsResolver: LegacyDnsResolver,
    @Inject(LEGACY_TRANSPORT) private readonly transport: LegacyTransport,
    private readonly secretResolver: LegacyApiSecretResolver,
    private readonly config: ConfigService,
  ) {}

  async send(req: ValidatedLegacyRequest, auth: LegacyAuthSpec, limits: { timeoutMs: number; maxBytes: number }): Promise<LegacyHttpResult> {
    // [신규 No.45] DNS 조회 전 — 출구 허용 목록 밖이면 송신 0(전송 자체를 시도하지 않는다, AC-DG2-3).
    if (checkEgress('LEGACY_API', req.url) === 'BLOCKED') {
      return { kind: 'ERROR', outcome: 'EGRESS_BLOCKED' };
    }

    const allowlist = parseAllowlist(this.config.get<string>('LEGACY_API_PRIVATE_ALLOWLIST') ?? '');

    let addresses: string[];
    if (isIP(req.hostname) !== 0) {
      addresses = [req.hostname];
    } else {
      addresses = await this.dnsResolver.lookupAll(req.hostname);
      if (addresses.length === 0) return { kind: 'ERROR', outcome: 'NETWORK_ERROR', errorCode: 'ENOTFOUND' };
    }

    for (const address of addresses) {
      const cls = classifyAddress(address);
      if (cls === 'ABSOLUTE_BLOCKED') return { kind: 'ERROR', outcome: 'BLOCKED_ADDRESS', blockedAddress: address };
      if (cls === 'PRIVATE') {
        const allowed = isAddressAllowlisted(address, allowlist) || isHostnameAllowlisted(req.hostname, allowlist);
        if (!allowed) return { kind: 'ERROR', outcome: 'BLOCKED_ADDRESS', blockedAddress: address };
      }
    }

    const headers: Record<string, string> = {
      Accept: 'application/json',
      'User-Agent': 'ChatBot-LegacyConnector/1',
      Connection: 'close',
    };
    if (req.method === 'POST') {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = String(Buffer.byteLength(req.bodyJson ?? '{}'));
    }

    if (auth.authType !== 'NONE') {
      const secret = auth.secretRef ? this.secretResolver.get(auth.secretRef) : null;
      if (!secret) return { kind: 'ERROR', outcome: 'SECRET_MISSING' };
      if (auth.authType === 'BEARER') headers.Authorization = `Bearer ${secret}`;
      else if (auth.authType === 'BASIC') headers.Authorization = `Basic ${Buffer.from(secret).toString('base64')}`;
      else if (auth.authType === 'API_KEY_HEADER' && auth.authHeaderName) headers[auth.authHeaderName] = secret;
    }

    const result = await this.transport.request({
      url: req.url,
      method: req.method,
      headers,
      body: req.bodyJson,
      pinnedAddresses: addresses,
      hostname: req.hostname,
      timeoutMs: limits.timeoutMs,
      maxBytes: limits.maxBytes,
    });

    return result;
  }
}
