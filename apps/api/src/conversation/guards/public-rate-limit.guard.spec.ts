import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { PublicRateLimitGuard } from './public-rate-limit.guard';
import { InMemoryRateLimitStore } from '../../common/rate-limit/rate-limit.store';
import type { PublicRateBucketSpec } from '../../common/rate-limit/public-rate-bucket.decorator';

/**
 * 가드는 `reflector.getAllAndOverride(handler, class)`로만 메타데이터를 읽으므로, 실제
 * `@SetMetadata` 배선 없이도 `Reflector`를 모킹해 `bucketSpec`을 직접 주입한다(핸들러/클래스
 * 객체 자체는 의미가 없다 — 모킹된 reflector가 무엇을 반환하는지만 중요하다).
 */
function makeContext(opts: { ip?: string; body?: unknown; params?: Record<string, string>; headers?: Record<string, string> }): ExecutionContext {
  const req = {
    ip: opts.ip ?? '1.1.1.1',
    socket: { remoteAddress: opts.ip ?? '1.1.1.1' },
    headers: opts.headers ?? {},
    body: opts.body,
    params: opts.params ?? {},
  };
  const res = { setHeader: jest.fn() };
  return {
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
    getHandler: () => ({}) as unknown,
    getClass: () => ({}) as unknown,
  } as unknown as ExecutionContext;
}

function makeReflector(bucketSpec?: PublicRateBucketSpec): Reflector {
  return { getAllAndOverride: jest.fn(() => bucketSpec) } as unknown as Reflector;
}

function makeConfig(overrides: Record<string, unknown> = {}): ConfigService {
  return { get: (key: string) => overrides[key] } as unknown as ConfigService;
}

/**
 * K-1(하이브리드 CS 설계서 §2.6·§7.3) — 폴링 전용 버킷이 기존 ip/session 버킷을 소비하지 않는지,
 * 그리고 일반 전송이 폴링 때문에 429가 되지 않는지를 단언한다.
 */
describe('PublicRateLimitGuard — K-1 폴링 전용 버킷', () => {
  it('버킷 데코레이터가 없으면 기존 ip/session 버킷을 그대로 소비한다', () => {
    const store = new InMemoryRateLimitStore();
    const config = makeConfig({ PUBLIC_RATE_LIMIT_IP_PER_MIN: 1, PUBLIC_RATE_LIMIT_SESSION_PER_MIN: 30 });
    const guard = new PublicRateLimitGuard(config, makeReflector(undefined), store);
    const context = makeContext({ ip: '9.9.9.9', body: { sessionId: 's1' } });

    expect(guard.canActivate(context)).toBe(true);
    expect(() => guard.canActivate(context)).toThrow();
  });

  it('폴링 데코레이터가 있으면 poll-ip/poll-key만 소비하고 기존 ip 버킷은 건드리지 않는다', () => {
    const store = new InMemoryRateLimitStore();
    const bucketSpec: PublicRateBucketSpec = { kind: 'POLL', key: { from: 'param', name: 'messageId', ns: 'msg' }, perKeyLimit: 60 };
    const pollGuard = new PublicRateLimitGuard(makeConfig({ PUBLIC_POLL_RATE_LIMIT_IP_PER_MIN: 600 }), makeReflector(bucketSpec), store);
    expect(pollGuard.canActivate(makeContext({ ip: '5.5.5.5', params: { messageId: 'm-1' } }))).toBe(true);

    // 같은 IP의 일반 요청(ip 버킷 소비, 한도 1)은 폴링 때문에 소진되지 않고 여전히 통과한다.
    const generalGuard = new PublicRateLimitGuard(makeConfig({ PUBLIC_RATE_LIMIT_IP_PER_MIN: 1, PUBLIC_RATE_LIMIT_SESSION_PER_MIN: 30 }), makeReflector(undefined), store);
    expect(generalGuard.canActivate(makeContext({ ip: '5.5.5.5' }))).toBe(true);
  });

  it('같은 IP에서 서로 다른 messageId로 폴링해도 poll-ip 축이 상한을 걸어 잠근다', () => {
    const store = new InMemoryRateLimitStore();
    const bucketSpec: PublicRateBucketSpec = { kind: 'POLL', key: { from: 'param', name: 'messageId', ns: 'msg' }, perKeyLimit: 60 };
    const guard = new PublicRateLimitGuard(makeConfig({ PUBLIC_POLL_RATE_LIMIT_IP_PER_MIN: 1 }), makeReflector(bucketSpec), store);

    expect(guard.canActivate(makeContext({ ip: '7.7.7.7', params: { messageId: 'a' } }))).toBe(true);
    expect(() => guard.canActivate(makeContext({ ip: '7.7.7.7', params: { messageId: 'b' } }))).toThrow();
  });

  it('같은 messageId를 다른 IP로 반복 폴링하면 poll-key 축이 상한을 걸어 잠근다', () => {
    const store = new InMemoryRateLimitStore();
    const bucketSpec: PublicRateBucketSpec = { kind: 'POLL', key: { from: 'param', name: 'messageId', ns: 'msg' }, perKeyLimit: 1 };
    const guard = new PublicRateLimitGuard(makeConfig({ PUBLIC_POLL_RATE_LIMIT_IP_PER_MIN: 600 }), makeReflector(bucketSpec), store);

    expect(guard.canActivate(makeContext({ ip: '1.2.3.4', params: { messageId: 'shared' } }))).toBe(true);
    expect(() => guard.canActivate(makeContext({ ip: '4.3.2.1', params: { messageId: 'shared' } }))).toThrow();
  });

  it('헤더 기반 키(상담 폴링 재사용 형태)도 env+fallback perKeyLimit를 해석한다', () => {
    const store = new InMemoryRateLimitStore();
    const bucketSpec: PublicRateBucketSpec = {
      kind: 'POLL',
      key: { from: 'header', name: 'x-cb-session-id', ns: 'handoff' },
      perKeyLimit: { env: 'PUBLIC_HANDOFF_POLL_RATE_LIMIT_SESSION_PER_MIN', fallback: 40 },
    };
    const config = makeConfig({ PUBLIC_POLL_RATE_LIMIT_IP_PER_MIN: 600, PUBLIC_HANDOFF_POLL_RATE_LIMIT_SESSION_PER_MIN: 1 });
    const guard = new PublicRateLimitGuard(config, makeReflector(bucketSpec), store);

    expect(guard.canActivate(makeContext({ ip: '8.8.8.8', headers: { 'x-cb-session-id': 'sess-1' } }))).toBe(true);
    expect(() => guard.canActivate(makeContext({ ip: '8.8.8.8', headers: { 'x-cb-session-id': 'sess-1' } }))).toThrow();
  });

  it('env가 설정되지 않으면 fallback perKeyLimit를 쓴다', () => {
    const store = new InMemoryRateLimitStore();
    const bucketSpec: PublicRateBucketSpec = {
      kind: 'POLL',
      key: { from: 'header', name: 'x-cb-session-id', ns: 'handoff' },
      perKeyLimit: { env: 'PUBLIC_HANDOFF_POLL_RATE_LIMIT_SESSION_PER_MIN', fallback: 1 },
    };
    const guard = new PublicRateLimitGuard(makeConfig({ PUBLIC_POLL_RATE_LIMIT_IP_PER_MIN: 600 }), makeReflector(bucketSpec), store);

    expect(guard.canActivate(makeContext({ ip: '8.8.8.9', headers: { 'x-cb-session-id': 'sess-2' } }))).toBe(true);
    expect(() => guard.canActivate(makeContext({ ip: '8.8.8.9', headers: { 'x-cb-session-id': 'sess-2' } }))).toThrow();
  });

  it('키 값이 없으면(형식 오류) 2축을 건너뛰고 poll-ip만으로 통과시킨다', () => {
    const store = new InMemoryRateLimitStore();
    const bucketSpec: PublicRateBucketSpec = { kind: 'POLL', key: { from: 'param', name: 'messageId', ns: 'msg' }, perKeyLimit: 60 };
    const guard = new PublicRateLimitGuard(makeConfig({ PUBLIC_POLL_RATE_LIMIT_IP_PER_MIN: 600 }), makeReflector(bucketSpec), store);

    expect(guard.canActivate(makeContext({ ip: '3.3.3.3', params: {} }))).toBe(true);
  });
});
