import { SetMetadata } from '@nestjs/common';

export const PUBLIC_RATE_BUCKET_KEY = 'publicRateBucket';

/**
 * 폴링 전용 레이트리밋 버킷 지정(K-1, §2.6 · §7.3). 이 데코레이터가 붙은 핸들러는
 * `PublicRateLimitGuard`가 기존 `ip`·`session` 버킷을 **소비하지 않고**, 대신
 * `poll-ip:{ip}`(1축) + `poll-key:{ns}:{keyValue}`(2축) 두 버킷만 소비한다.
 *
 * K-1 커밋에서는 보류 답변 폴링(`GET …/messages/:messageId`)에 `key.from='param'`으로 적용한다.
 * No.24 본체가 상담 폴링(`GET …/handoff`)에 `key.from='header'`로 재사용한다(같은 장치, 새 데코레이터 0).
 */
export interface PublicRateBucketSpec {
  kind: 'POLL';
  /** 두 번째 축의 키 출처 — 경로 파라미터 또는 요청 헤더. `ns`는 버킷 키 접두사(충돌 방지). */
  key: { from: 'param'; name: string; ns: string } | { from: 'header'; name: string; ns: string };
  /** 2축 한도(분당). 상수 또는 환경변수(`env`) + 기본값(`fallback`) 중 하나. */
  perKeyLimit: number | { env: string; fallback: number };
}

export const PublicRateBucket = (spec: PublicRateBucketSpec): MethodDecorator => SetMetadata(PUBLIC_RATE_BUCKET_KEY, spec);
