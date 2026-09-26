import { createHmac } from 'node:crypto';

/**
 * [신규 No.42] 고객 키 해시(§6.4 — 순수). 솔트 = 식별 공간(테넌트) + 도메인 구분 태그 + 서버 비밀.
 * 챗봇 id는 넣지 않는다(넣으면 챗봇 간 통합이 불가능해진다). `\n` 구분자는 REF·`sub` 문자
 * 집합에 나올 수 없어 입력이 모호하지 않다.
 */
export function computeCustomerKeyHash(secret: Buffer, identitySpaceRef: string, sub: string): string {
  return createHmac('sha256', secret).update(`cb-omni-customer:v1\n${identitySpaceRef}\n${sub}`, 'utf8').digest('hex');
}

/** 고객 키 비밀 지문(교체 탐지용, 앞 8 hex) — 비밀 자체를 저장하지 않는다. */
export function computeKeyFingerprint(secret: Buffer): string {
  return createHmac('sha256', secret).update('cb-omni-fp:v1', 'utf8').digest('hex').slice(0, 8);
}
