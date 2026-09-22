import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';

/** 감사 기록용 인증 주체(actor). `AuditLogService`가 스냅샷을 만드는 데 필요한 최소 필드만 담는다. */
export interface AuthenticatedActor {
  id: string;
  email: string;
  role: string;
}

export interface RequestContext {
  actor: AuthenticatedActor | null;
  ip?: string;
  userAgent?: string;
  requestPath: string;
}

/**
 * `actor` 전달을 위한 `AsyncLocalStorage` 래퍼(DD-40, FR-0-26, NFR-M7, ADR-0016 §3).
 * Nest 요청 스코프 provider가 아니다 — 요청 스코프는 싱글턴 캐시(번들/레이트리밋)를 파괴한다.
 *
 * 규약(코드리뷰 점검 항목):
 * ① `get()`을 호출해도 되는 곳은 `AuditLogService` 1곳뿐이다.
 * ② 컨텍스트가 비어 있어도(배치·seed·테스트) 예외를 던지지 않는다 — `undefined`를 반환한다.
 * ③ `@CurrentUser()`는 컨트롤러 전용이며, actor가 비즈니스 인자인 경우에만 서비스 시그니처에 명시적으로 넘긴다.
 */
@Injectable()
export class RequestContextService {
  private readonly als = new AsyncLocalStorage<RequestContext>();

  run<T>(ctx: RequestContext, fn: () => T): T {
    return this.als.run(ctx, fn);
  }

  setActor(actor: AuthenticatedActor): void {
    const store = this.als.getStore();
    if (store) store.actor = actor;
  }

  get(): RequestContext | undefined {
    return this.als.getStore();
  }
}
