import { randomBytes } from 'node:crypto';

/** [신규 No.42] 고객 `ref` 생성 — 16 hex 난수(§3.1). 별칭(목록 표시)의 원천이며 고객 id·세션과 무관하다. */
export function generateCustomerRef(): string {
  return randomBytes(8).toString('hex');
}

/** 목록 안에서의 별칭 — 앞 6자, 충돌 시 8·10·…16자로 늘린다(`assignAliases()`의 단일 값 판) . */
export function shortAlias(ref: string, len = 6): string {
  return ref.slice(0, len);
}
