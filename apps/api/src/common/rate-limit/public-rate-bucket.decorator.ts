import { SetMetadata } from '@nestjs/common';

export const PUBLIC_RATE_BUCKET_KEY = 'publicRateBucket';

/**
 * 폴링·평가·선제 안내 전용 레이트리밋 버킷 지정(K-1, §2.6 · §7.3 · No.44 §8 · No.35 §5.4). 이
 * 데코레이터가 붙은 핸들러는 `PublicRateLimitGuard`가 기존 `ip`·`session` 버킷을 **소비하지 않고**,
 * 대신 kind별 전용 IP축(1축) + (선택) 키축(2축)만 소비한다.
 *
 * K-1 커밋에서는 보류 답변 폴링(`GET …/messages/:messageId`)에 `key.from='param'`으로 적용한다.
 * No.24 본체가 상담 폴링(`GET …/handoff`)에 `key.from='header'`로 재사용한다(같은 장치, 새 데코레이터 0).
 * No.44 본체가 답변 평가(`PUT …/messages/:messageId/feedback`)에 `kind:'FEEDBACK'`으로 재사용한다 —
 * `POLL`과 IP축을 공유하지 않는 별도 접두(`fb-ip`/`fb-key`)를 쓴다(ADR-0038 §6, 폴링·평가 상호 간섭 방지).
 *
 * [신규 No.35] `key`를 **선택**으로 넓힌다(없으면 IP축만 소비) · 키 출처에 `'body'`를 추가한다(본문은
 * 가드보다 먼저 파싱돼 있다 — 기존 `session` 버킷이 같은 방식으로 `req.body.sessionId`를 읽는 선례) ·
 * 선택 필드 `when`을 추가한다 — 조건이 맞지 않으면 **이 데코레이터가 없는 것과 동일**하게 기존
 * `ip`·`session` 버킷을 소비한다(`getConfig`의 선제 조회만 전용 버킷을 쓰고, 나머지 호출은 현행
 * 그대로인 이유 — ADR-0045 §3).
 */
export interface PublicRateBucketSpec {
  kind: 'POLL' | 'FEEDBACK' | 'PROACTIVE_RULES' | 'PROACTIVE_EVENT';
  /** 두 번째 축의 키 출처 — 경로 파라미터·요청 헤더·요청 본문. `ns`는 버킷 키 접두사(충돌 방지).
   * 생략하면 IP축만 소비한다(`PROACTIVE_RULES`가 그렇다 — 선제 조회는 세션별 축이 없다). */
  key?: { from: 'param' | 'header' | 'body'; name: string; ns: string };
  /** 2축 한도(분당). 상수 또는 환경변수(`env`) + 기본값(`fallback`) 중 하나. `key`가 있으면 필수 —
   * 가드는 `key`가 없으면 이 필드를 읽지 않는다. */
  perKeyLimit?: number | { env: string; fallback: number };
  /** [신규 No.35] 이 쿼리 파라미터가 정확히 `equals` 값일 때만 전용 버킷을 적용한다. 없으면 항상
   * 적용(기존 폴링·평가와 동일한 동작). */
  when?: { query: string; equals: string };
}

export const PublicRateBucket = (spec: PublicRateBucketSpec): MethodDecorator => SetMetadata(PUBLIC_RATE_BUCKET_KEY, spec);
