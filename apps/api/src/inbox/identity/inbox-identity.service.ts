import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import type { InboundIdentity } from '../../conversation/adapters/channel-adapter';
import { computeSessionRef } from '../../handoff/lib/session-ref';
import { BannedWordFilterService } from '../../banned-words/banned-word-filter.service';
import { InboxParticipationCache } from '../core/inbox-participation.cache';
import { InboxStore } from '../core/inbox.store';
import type { MaskedText } from '../core/lib/masked-text';
import { prepareDisplayName } from '../core/lib/display-name';
import { InboxIdentitySecretResolver } from './inbox-identity-secret.resolver';
import { IdentityFailureCounter } from './identity-failure-counter';
import { verifyIdentityToken } from './lib/verify-identity-token';
import { computeCustomerKeyHash, computeKeyFingerprint } from './lib/customer-key';
import { InboxLruCache } from './lib/session-identity-cache';

export interface ObserveIdentityInput {
  chatbotId: string;
  sessionId: string;
  channelType: string;
  identity: InboundIdentity;
  now: Date;
}

/**
 * [신규 No.42] 공개 경로 전용 — 검증 + 연결 적재 요청(ADR-0042 §2·§6.5). `observe()`는 `void`
 * 반환·동기(내부 비동기) — 응답을 막지 않는다. 실패는 익명 처리와 바이트 단위로 같다(§6.6).
 */
@Injectable()
export class InboxIdentityService {
  private readonly logger = new Logger('InboxIdentityService');
  private readonly sessionCache = new InboxLruCache<true>(20_000, 30 * 60_000);
  private readonly failureCache = new InboxLruCache<true>(20_000, 30 * 60_000);
  private pending: Promise<void> = Promise.resolve();

  constructor(
    private readonly config: ConfigService,
    private readonly participation: InboxParticipationCache,
    private readonly secretResolver: InboxIdentitySecretResolver,
    private readonly failureCounter: IdentityFailureCounter,
    private readonly store: InboxStore,
    private readonly bannedWordFilter: BannedWordFilterService,
  ) {}

  private enabled(): boolean {
    return this.config.get<boolean>('OMNI_INBOX_ENABLED') ?? true;
  }

  /** 동기 반환 · 예외 없음. 헤더가 없으면 이 메서드 자체가 호출되지 않는다(호출부 분기). */
  observe(input: ObserveIdentityInput): void {
    if (!this.enabled()) return;
    if (input.identity.scheme !== 'HOST_SIGNED_TOKEN') return;
    const cacheKey = `${input.chatbotId}:${input.sessionId}`;
    if (this.sessionCache.get(cacheKey)) return;

    const task = this.processAsync(input, cacheKey).catch((e) => {
      this.logger.warn(`식별 처리 실패: chatbotId=${input.chatbotId} error=${e instanceof Error ? e.constructor.name : 'unknown'}`);
    });
    this.pending = this.pending.then(() => task).catch(() => undefined);
  }

  async drainForTest(): Promise<void> {
    await this.pending;
  }

  private async processAsync(input: ObserveIdentityInput, cacheKey: string): Promise<void> {
    const participating = await this.participation.isParticipating(input.chatbotId);
    if (!participating) return;

    const token = input.identity.token;
    const tokenFingerprint = createHash('sha256').update(token).digest('hex').slice(0, 16);
    const failureKey = `${input.chatbotId}:${tokenFingerprint}`;
    if (this.failureCache.get(failureKey)) return;

    const setting = await this.participation.get(input.chatbotId);
    const ref = setting?.identitySecretRef ?? null;
    if (!ref) {
      this.failureCounter.recordFailure(input.chatbotId, 'SECRET_MISSING', input.now);
      this.failureCache.set(failureKey, true, input.now.getTime());
      return;
    }
    const secrets = this.secretResolver.getIdentitySecrets(ref);
    const maxTtlSec = (this.config.get<number>('OMNI_IDENTITY_MAX_TTL_HOURS') ?? 24) * 3600;
    const skewSec = this.config.get<number>('OMNI_IDENTITY_CLOCK_SKEW_SEC') ?? 300;

    const verified = verifyIdentityToken(token, { ...secrets, ref }, input.now, { maxTtlSec, skewSec });
    if (!verified.ok) {
      this.failureCounter.recordFailure(input.chatbotId, verified.reason, input.now);
      this.failureCache.set(failureKey, true, input.now.getTime());
      return;
    }

    const customerKeySecret = this.secretResolver.getCustomerKeySecret();
    if (!customerKeySecret) {
      this.failureCounter.recordFailure(input.chatbotId, 'SECRET_MISSING', input.now);
      this.failureCache.set(failureKey, true, input.now.getTime());
      return;
    }

    const customerKey = computeCustomerKeyHash(customerKeySecret, ref, verified.sub);
    const fingerprint = computeKeyFingerprint(customerKeySecret);

    let displayName: MaskedText | undefined;
    if (verified.name) {
      displayName = await prepareDisplayName(verified.name, this.bannedWordFilter);
    }

    const sessionRef = computeSessionRef(input.chatbotId, input.sessionId);
    const result = await this.store.linkIdentity({
      chatbotId: input.chatbotId,
      sessionId: input.sessionId,
      sessionRef,
      channelType: input.channelType,
      spaceRef: ref,
      customerKey,
      fingerprint,
      displayName,
      now: input.now,
    });

    if (result === 'CONFLICT') this.failureCounter.recordFailure(input.chatbotId, 'CONFLICT', input.now);
    else this.failureCounter.recordSuccess(input.chatbotId, input.now);

    this.sessionCache.set(cacheKey, true, input.now.getTime());
  }
}
