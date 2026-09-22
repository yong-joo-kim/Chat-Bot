import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { ApiException } from '../common/api.exception';
import type { RateLimitStore } from '../common/rate-limit/rate-limit.store';
import { resolveClientIp } from '../common/rate-limit/lib/client-ip';

const WINDOW_MS = 60_000;

/** 로그인 폭주(무차별 대입) IP 기준 방어(FR-12-6). 계정 잠금(DB 영속)과는 별개 장치다(§11). */
@Injectable()
export class LoginRateLimitGuard implements CanActivate {
  constructor(
    private readonly config: ConfigService,
    @Inject('RateLimitStore') private readonly store: RateLimitStore,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();

    const limit = this.config.get<number>('LOGIN_RATE_LIMIT_IP_PER_MIN') ?? 20;
    const trustProxy = this.config.get<boolean>('TRUST_PROXY') ?? false;
    const ip = resolveClientIp(req, trustProxy);

    const result = this.store.consume(`login:ip:${ip}`, Date.now(), limit, WINDOW_MS);
    if (!result.allowed) {
      res.setHeader('Retry-After', String(result.retryAfterSec));
      throw new ApiException('RATE_LIMITED', 429, '로그인 시도가 많습니다. 잠시 후 다시 시도해 주세요.');
    }
    return true;
  }
}
