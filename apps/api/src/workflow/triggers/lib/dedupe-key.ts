/**
 * [신규 No.41] 발송함 유일 키 조립(§6.1·§6.2) — 순수. `NODE: N:<messageId>:<nodeId>:<outputIndex>` ·
 * `EVENT: E:<subscriptionId>:<sourceKey>` · `TEST: null`(호출부가 만들지 않는다).
 */
export function nodeDedupeKey(messageId: string, nodeId: string, outputIndex: number): string {
  return `N:${messageId}:${nodeId}:${outputIndex}`;
}

export function eventDedupeKey(subscriptionId: string, sourceKey: string): string {
  return `E:${subscriptionId}:${sourceKey}`;
}
