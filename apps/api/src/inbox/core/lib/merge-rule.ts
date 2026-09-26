import type { CustomerKind, CustomerStatus } from '@chat-bot/shared-types';

export interface MergeCandidate {
  kind: CustomerKind;
  status: CustomerStatus;
  identityPurgedAt: Date | null;
}

/**
 * [신규 No.42] 병합 허용 규칙(§7.4 — 순수). 원본은 익명 고객만(익명→식별·익명↔익명) 허용한다.
 * 식별↔식별·시험 고객 관련·이미 병합됨·대상 식별 소거·자기 자신은 전부 거부한다.
 */
export function assertMergeAllowed(sourceId: string, source: MergeCandidate, targetId: string, target: MergeCandidate): { ok: true } | { ok: false; message: string } {
  if (sourceId === targetId) return { ok: false, message: '같은 고객을 병합할 수 없습니다.' };
  if (source.kind === 'TEST' || target.kind === 'TEST') return { ok: false, message: '시험 고객은 병합할 수 없습니다.' };
  if (source.status !== 'ACTIVE' || target.status !== 'ACTIVE') return { ok: false, message: '이미 병합된 고객입니다.' };
  if (target.identityPurgedAt) return { ok: false, message: '식별 정보가 소거된 고객은 병합 대상이 될 수 없습니다.' };
  if (source.kind === 'IDENTIFIED') {
    return { ok: false, message: '식별된 고객은 병합 원본이 될 수 없습니다 — 방향을 바꿔 병합해 주세요.' };
  }
  return { ok: true };
}
