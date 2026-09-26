import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { isIP } from 'node:net';
import type { ApiConnectionAuthType, WorkflowEventType, WorkflowOutcome } from '@chat-bot/shared-types';
import { checkEgress } from '../../common/egress/egress-guard';
import { classifyAddress, isAddressAllowlisted, isHostnameAllowlisted, parseAllowlist } from '../../legacy-api/lib/ip-policy';
import type { ParsedAllowlist } from '../../legacy-api/lib/ip-policy';
import type { LegacyDnsResolver, LegacyTransport } from '../../legacy-api/transport/legacy-transport.port';
import { WorkflowSecretResolver } from '../secrets/workflow-secret.resolver';
import { buildDispatchHeaders } from './lib/headers';

/**
 * [신규 No.41] No.26 전송·DNS 부품을 **이동 없이 두 번째 DI 토큰**으로 등록한다(ADR-0041 §6·C-2).
 * `workflow.module.ts`가 `NodeHttpTransport`·`NodeDnsResolver` 클래스를 이 토큰에 바인딩한다
 * (클래스 파일 import — `LegacyApiModule` import 0).
 */
export const WORKFLOW_TRANSPORT = 'WORKFLOW_TRANSPORT';
export const WORKFLOW_DNS_RESOLVER = 'WORKFLOW_DNS_RESOLVER';

export interface WorkflowSendTarget {
  baseUrl: string;
  authType: ApiConnectionAuthType;
  authHeaderName: string | null;
  secretRef: string | null;
  signingEnabled: boolean;
  signingSecretRef: string | null;
  urlSecretRef: string | null;
  timeoutMs: number;
}

export type WorkflowSendResult =
  | { kind: 'RESPONSE'; status: number; retryAfter?: string }
  | { kind: 'BLOCKED'; outcome: Extract<WorkflowOutcome, 'EGRESS_BLOCKED' | 'BLOCKED_ADDRESS' | 'SECRET_MISSING' | 'TARGET_HOST_MISMATCH' | 'INVALID_TARGET_URL'>; blockedAddress?: string }
  | { kind: 'TRANSPORT_ERROR'; outcome: Extract<WorkflowOutcome, 'TIMEOUT' | 'NETWORK_ERROR' | 'REDIRECT_NOT_ALLOWED'> };

/**
 * ★ 출구 파일(No.41, 레지스트리 등록 — ADR-0041 §6). `checkEgress('WORKFLOW_WEBHOOK', …)`가 DNS 조회
 * 전에 호출되고(G-2), No.26 전송·DNS·IP 정책 부품을 **이동 없이** 두 번째 DI 토큰으로 공유한다(C-2).
 * SSRF 방어(ADR-0034 §4 전부): DNS 1회 해석 → 모든 주소 판정(절대 차단 불가역 · 사설은 허용 목록만)
 * → 검증 주소로만 연결 → 리다이렉트 불추종(공유 전송이 3xx를 영구 실패로 끝낸다).
 */
@Injectable()
export class WorkflowHttpSender {
  constructor(
    @Inject(WORKFLOW_TRANSPORT) private readonly transport: LegacyTransport,
    @Inject(WORKFLOW_DNS_RESOLVER) private readonly dnsResolver: LegacyDnsResolver,
    private readonly secretResolver: WorkflowSecretResolver,
    private readonly config: ConfigService,
  ) {}

  private privateAllowlist(): ParsedAllowlist {
    const raw = this.config.get<string>('WORKFLOW_PRIVATE_ALLOWLIST') ?? '';
    return parseAllowlist(raw);
  }

  async send(target: WorkflowSendTarget, eventType: WorkflowEventType, deliveryId: string, attempt: number, rawBody: string, now: Date): Promise<WorkflowSendResult> {
    // ① 주소 결정(비밀 주소 포함) · URL 재파싱 동일성 · 스킴·사용자정보 검사.
    let addressUrl: URL;
    const allowHttp = this.config.get<boolean>('WORKFLOW_ALLOW_HTTP') ?? false;
    try {
      let urlString = target.baseUrl;
      if (target.urlSecretRef) {
        const secretUrl = this.secretResolver.get(target.urlSecretRef);
        if (!secretUrl) return { kind: 'BLOCKED', outcome: 'SECRET_MISSING' };
        const parsedBase = new URL(target.baseUrl);
        const parsedSecret = new URL(secretUrl);
        if (parsedSecret.hostname.toLowerCase() !== parsedBase.hostname.toLowerCase() || (parsedSecret.port || defaultPort(parsedSecret)) !== (parsedBase.port || defaultPort(parsedBase))) {
          return { kind: 'BLOCKED', outcome: 'TARGET_HOST_MISMATCH' };
        }
        urlString = secretUrl;
      }
      addressUrl = new URL(urlString);
      if (addressUrl.username || addressUrl.password) return { kind: 'BLOCKED', outcome: 'INVALID_TARGET_URL' };
      if (addressUrl.protocol !== 'https:' && !(addressUrl.protocol === 'http:' && allowHttp)) return { kind: 'BLOCKED', outcome: 'INVALID_TARGET_URL' };
    } catch {
      return { kind: 'BLOCKED', outcome: 'INVALID_TARGET_URL' };
    }

    // ② 방어 이중화 — 발송기 자체가 checkEgress를 호출한다(DNS 조회 전 — G-2).
    if (checkEgress('WORKFLOW_WEBHOOK', addressUrl.toString()) === 'BLOCKED') {
      return { kind: 'BLOCKED', outcome: 'EGRESS_BLOCKED' };
    }

    // ③ 비밀 확인(서명·인증) — 필요한데 없으면 송신 0.
    const signingSecret = target.signingEnabled && target.signingSecretRef ? this.secretResolver.get(target.signingSecretRef) : null;
    if (target.signingEnabled && !signingSecret) return { kind: 'BLOCKED', outcome: 'SECRET_MISSING' };
    const authSecret = target.authType !== 'NONE' && target.secretRef ? this.secretResolver.get(target.secretRef) : null;
    if (target.authType !== 'NONE' && !authSecret) return { kind: 'BLOCKED', outcome: 'SECRET_MISSING' };

    // ④ DNS 1회 해석 → 모든 주소 판정.
    const isLiteral = isIP(addressUrl.hostname) !== 0;
    const candidateAddresses = isLiteral ? [addressUrl.hostname] : await this.dnsResolver.lookupAll(addressUrl.hostname);
    if (candidateAddresses.length === 0) return { kind: 'TRANSPORT_ERROR', outcome: 'NETWORK_ERROR' };

    const allowlist = this.privateAllowlist();
    const hostnameAllowlisted = !isLiteral && isHostnameAllowlisted(addressUrl.hostname, allowlist);
    for (const addr of candidateAddresses) {
      const cls = classifyAddress(addr);
      if (cls === 'ABSOLUTE_BLOCKED') return { kind: 'BLOCKED', outcome: 'BLOCKED_ADDRESS', blockedAddress: addr };
      if (cls === 'PRIVATE' && !hostnameAllowlisted && !isAddressAllowlisted(addr, allowlist)) {
        return { kind: 'BLOCKED', outcome: 'BLOCKED_ADDRESS', blockedAddress: addr };
      }
    }

    // ⑤ 헤더 조립.
    const headers = buildDispatchHeaders({
      eventType,
      deliveryId,
      attempt,
      signingSecret,
      now,
      rawBody,
      authType: target.authType,
      authHeaderName: target.authHeaderName,
      authSecret,
    });

    const maxTimeoutMs = this.config.get<number>('WORKFLOW_MAX_TIMEOUT_MS') ?? 15000;
    const result = await this.transport.request({
      url: addressUrl.toString(),
      method: 'POST',
      headers,
      body: rawBody,
      pinnedAddresses: candidateAddresses,
      hostname: addressUrl.hostname,
      timeoutMs: Math.min(target.timeoutMs, maxTimeoutMs),
      maxBytes: 4096,
      exitId: 'WORKFLOW_WEBHOOK',
      responseMode: 'STATUS_ONLY',
    });

    if (result.kind === 'ERROR') {
      if (result.outcome === 'RESPONSE_TOO_LARGE') return { kind: 'RESPONSE', status: 200 }; // STATUS_ONLY에서는 도달하지 않는다(방어적 폴백)
      return { kind: 'TRANSPORT_ERROR', outcome: result.outcome };
    }
    return { kind: 'RESPONSE', status: result.status, ...(result.retryAfter ? { retryAfter: result.retryAfter } : {}) };
  }
}

function defaultPort(url: URL): string {
  return url.protocol === 'https:' ? '443' : '80';
}
