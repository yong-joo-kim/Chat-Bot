import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { ApiException } from '../../common/api.exception';
import type { RateLimitStore } from '../rate-limit.store';
import { resolveClientIp } from '../lib/client-ip';

const WINDOW_MS = 60_000;

/**
 * 공개 API 전용 자체 토큰버킷 레이트리밋(NFR-S2, DD-23). `session:{sessionId}` 30/분,
 * `ip:{clientIp}` 120/분 두 축을 동시에 적용한다 — 하나라도 초과하면 429 + `Retry-After`.
 * `PublicOriginGuard`보다 먼저 실행한다 — Origin 판정은 DB 조회를 수반하므로 폭주 트래픽이
 * DB에 닿기 전에 여기서 자른다(§8.3).
 */
@Injectable()
export class PublicRateLimitGuard implements CanActivate {
  constructor(
    private readonly config: ConfigService,
    @Inject('RateLimitStore') private readonly store: RateLimitStore,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();
    const now = Date.now();

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
}
