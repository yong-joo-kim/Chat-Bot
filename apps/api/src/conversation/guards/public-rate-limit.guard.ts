import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { ApiException } from '../../common/api.exception';
import type { RateLimitStore } from '../../common/rate-limit/rate-limit.store';
import { resolveClientIp } from '../../common/rate-limit/lib/client-ip';
import { PUBLIC_RATE_BUCKET_KEY } from '../../common/rate-limit/public-rate-bucket.decorator';
import type { PublicRateBucketSpec } from '../../common/rate-limit/public-rate-bucket.decorator';

const WINDOW_MS = 60_000;

/** kind별 전용 버킷 접두·IP 한도 표(No.44 §8) — `POLL`은 기존 값 그대로(바이트 단위 불변). */
const BUCKET_SPEC_BY_KIND: Record<PublicRateBucketSpec['kind'], { ipPrefix: string; keyPrefix: string; ipLimitEnv: string; ipLimitFallback: number }> = {
  POLL: { ipPrefix: 'poll-ip', keyPrefix: 'poll-key', ipLimitEnv: 'PUBLIC_POLL_RATE_LIMIT_IP_PER_MIN', ipLimitFallback: 600 },
  FEEDBACK: { ipPrefix: 'fb-ip', keyPrefix: 'fb-key', ipLimitEnv: 'PUBLIC_FEEDBACK_RATE_LIMIT_IP_PER_MIN', ipLimitFallback: 120 },
};

/**
 * 공개 API 전용 자체 토큰버킷 레이트리밋(NFR-S2, DD-23). `session:{sessionId}` 30/분,
 * `ip:{clientIp}` 120/분 두 축을 동시에 적용한다 — 하나라도 초과하면 429 + `Retry-After`.
 * `PublicOriginGuard`보다 먼저 실행한다 — Origin 판정은 DB 조회를 수반하므로 폭주 트래픽이
 * DB에 닿기 전에 여기서 자른다(§8.3).
 *
 * [K-1, §2.6·§7.3] `@PublicRateBucket()`이 붙은 핸들러(폴링·평가 전용)는 위 두 버킷을 **소비하지 않고**
 * kind별 전용 IP축(공용, `POLL`=600/분·`FEEDBACK`=120/분) + 경로·헤더별 키 버킷만 소비한다 — 같은
 * NAT 뒤 폴링/평가가 일반 전송을 429로 만들던 결함을 해소한다(No.44 §8 — `FEEDBACK`은 `poll-ip`와
 * 공유하지 않는 별도 축이라 평가 폭주가 보류 답변·상담 폴링을 막지 않는다).
 */
@Injectable()
export class PublicRateLimitGuard implements CanActivate {
  constructor(
    private readonly config: ConfigService,
    private readonly reflector: Reflector,
    @Inject('RateLimitStore') private readonly store: RateLimitStore,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();
    const now = Date.now();

    const bucketSpec = this.reflector.getAllAndOverride<PublicRateBucketSpec | undefined>(PUBLIC_RATE_BUCKET_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (bucketSpec) {
      this.consumeDedicatedBuckets(req, res, now, bucketSpec);
      return true;
    }

    const ipLimit = this.config.get<number>('PUBLIC_RATE_LIMIT_IP_PER_MIN') ?? 120;
    const sessionLimit = this.config.get<number>('PUBLIC_RATE_LIMIT_SESSION_PER_MIN') ?? 30;
    const trustProxy = this.config.get<boolean>('TRUST_PROXY') ?? false;

    const ip = resolveClientIp(req, trustProxy);
    const ipResult = this.store.consume(`ip:${ip}`, now, ipLimit, WINDOW_MS);
    if (!ipResult.allowed) {
      res.setHeader('Retry-After', String(ipResult.retryAfterSec));
      throw new ApiException('RATE_LIMITED', 429, '요청이 많습니다. 잠시 후 다시 시도해 주세요.');
    }

    const body = req.body as { sessionId?: unknown } | undefined;
    const sessionId = typeof body?.sessionId === 'string' ? body.sessionId : undefined;
    if (sessionId) {
      const sessionResult = this.store.consume(`session:${sessionId}`, now, sessionLimit, WINDOW_MS);
      if (!sessionResult.allowed) {
        res.setHeader('Retry-After', String(sessionResult.retryAfterSec));
        throw new ApiException('RATE_LIMITED', 429, '요청이 많습니다. 잠시 후 다시 시도해 주세요.');
      }
    }

    return true;
  }

  /** kind별 전용 IP축(1축, 공용) + 경로·헤더 키(2축) — 기존 `ip`/`session` 버킷은 전혀 건드리지 않는다. */
  private consumeDedicatedBuckets(req: Request, res: Response, now: number, spec: PublicRateBucketSpec): void {
    const trustProxy = this.config.get<boolean>('TRUST_PROXY') ?? false;
    const bucketSpec = BUCKET_SPEC_BY_KIND[spec.kind];
    const ipLimit = this.config.get<number>(bucketSpec.ipLimitEnv) ?? bucketSpec.ipLimitFallback;

    const ip = resolveClientIp(req, trustProxy);
    const ipResult = this.store.consume(`${bucketSpec.ipPrefix}:${ip}`, now, ipLimit, WINDOW_MS);
    if (!ipResult.allowed) {
      res.setHeader('Retry-After', String(ipResult.retryAfterSec));
      throw new ApiException('RATE_LIMITED', 429, '요청이 많습니다. 잠시 후 다시 시도해 주세요.');
    }

    const keyValue = spec.key.from === 'param' ? req.params?.[spec.key.name] : req.headers[spec.key.name.toLowerCase()];
    const resolvedKey = typeof keyValue === 'string' && keyValue.length > 0 ? keyValue : undefined;
    if (!resolvedKey) return; // 형식 오류는 핸들러가 400으로 판정한다(가드는 여기서 막지 않는다).

    const perKeyLimit = typeof spec.perKeyLimit === 'number' ? spec.perKeyLimit : (this.config.get<number>(spec.perKeyLimit.env) ?? spec.perKeyLimit.fallback);
    const keyResult = this.store.consume(`${bucketSpec.keyPrefix}:${spec.key.ns}:${resolvedKey}`, now, perKeyLimit, WINDOW_MS);
    if (!keyResult.allowed) {
      res.setHeader('Retry-After', String(keyResult.retryAfterSec));
      throw new ApiException('RATE_LIMITED', 429, '요청이 많습니다. 잠시 후 다시 시도해 주세요.');
    }
  }
}
