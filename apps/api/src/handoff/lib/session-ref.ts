import { createHash } from 'crypto';

/**
 * 관리자 경로 식별자의 원천(P-5, §10.2) — 챗봇마다 다른 값이라 교차 상관이 불가능하고,
 * `sessionId`(UUID v4)의 엔트로피로는 역산할 수 없다. 순수 함수(NFR-CSM1).
 */
export function computeSessionRef(chatbotId: string, sessionId: string): string {
  return createHash('sha256').update(`cb-handoff-ref:v1:${chatbotId}:${sessionId}`).digest('hex').slice(0, 16);
}

/**
 * 별칭 = 앞 6자, 같은 목록 안에서 충돌하면 해당 행만 8·10·…16자로 늘린다(§10.2).
 * 입력 순서를 보존해 반환한다(같은 `sessionRef`가 중복 입력되면 그대로 같은 별칭을 공유한다).
 */
export function assignAliases(sessionRefs: readonly string[]): Map<string, string> {
  const aliasOf = new Map<string, string>();
  const usedAliases = new Set<string>();

  for (const ref of sessionRefs) {
    if (aliasOf.has(ref)) continue;
    let len = 6;
    let alias = ref.slice(0, len);
    while (usedAliases.has(alias) && len < ref.length) {
      len += 2;
      alias = ref.slice(0, len);
    }
    usedAliases.add(alias);
    aliasOf.set(ref, alias);
  }

  return aliasOf;
}
