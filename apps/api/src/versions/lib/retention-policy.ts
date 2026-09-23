import type { ChatbotVersionTrigger } from '@chat-bot/shared-types';

/**
 * 순수 함수 `selectVersionsToPrune`(§6.6, FR-H1-16/18/19) — DB·Nest 무의존. 정리 대상 선정만 하고
 * 삭제는 호출자(`version-retention.service.ts`)가 트랜잭션으로 수행한다.
 */

export interface VersionMeta {
  id: string;
  trigger: ChatbotVersionTrigger;
  versionNo: number;
  pinned: boolean;
  sizeBytes: number;
}

export interface RetentionPolicy {
  retentionAuto: number;
  retentionManual: number;
  totalMaxBytes: number;
}

export interface RetentionResult {
  /** 정리(삭제) 대상 버전 id 목록. */
  pruneIds: string[];
  /** 정리 후에도 총량 상한을 초과하는가(고정·보호만 남아 더 지울 수 없는 경우, §6.6 3) 마지막 줄). */
  stillOverLimit: boolean;
}

function byVersionNoDesc(a: VersionMeta, b: VersionMeta): number {
  return b.versionNo - a.versionNo;
}

function byVersionNoAsc(a: VersionMeta, b: VersionMeta): number {
  return a.versionNo - b.versionNo;
}

/**
 * [신규 2026-09-23 No.28] `externallyProtectedIds`(선택 4번째 인자, §9.3) — 운영 예약 배포가 참조하는
 * 버전(활성 `RESTORE_VERSION` 예약의 대상)을 보존 정리 대상에서 제외한다(FR-D4-1(상태 변경), AC-D5-1).
 * 기존 호출부(3-인자)는 무변경 — 기본값이 빈 집합이라 동작이 바뀌지 않는다.
 */
export function selectVersionsToPrune(
  metas: readonly VersionMeta[],
  policy: RetentionPolicy,
  justCreatedId: string,
  externallyProtectedIds: ReadonlySet<string> = new Set(),
): RetentionResult {
  const mostRecentBeforeRestore = [...metas].filter((m) => m.trigger === 'BEFORE_RESTORE').sort(byVersionNoDesc)[0];

  const protectedIds = new Set<string>([justCreatedId, ...externallyProtectedIds]);
  if (mostRecentBeforeRestore) protectedIds.add(mostRecentBeforeRestore.id);
  for (const m of metas) if (m.pinned) protectedIds.add(m.id);

  const toPrune = new Set<string>();

  // 1) MANUAL(비고정) — versionNo desc, 앞 RETENTION_MANUAL건 초과분 삭제
  const manualNonPinned = metas.filter((m) => m.trigger === 'MANUAL' && !m.pinned).sort(byVersionNoDesc);
  for (const m of manualNonPinned.slice(policy.retentionManual)) {
    if (!protectedIds.has(m.id)) toPrune.add(m.id);
  }

  // 2) 자동(BEFORE_*, 비고정) — versionNo desc, 앞 RETENTION_AUTO건 초과분 삭제(보호 대상은 건너뜀)
  const autoNonPinned = metas.filter((m) => m.trigger !== 'MANUAL' && !m.pinned).sort(byVersionNoDesc);
  for (const m of autoNonPinned.slice(policy.retentionAuto)) {
    if (!protectedIds.has(m.id)) toPrune.add(m.id);
  }

  // 3) 남은 전체(고정 포함) 총량이 상한 초과면 비보호 자동 → 오래된 순, 그래도 초과면 비보호 수동 → 오래된 순
  const remaining = metas.filter((m) => !toPrune.has(m.id));
  let totalBytes = remaining.reduce((sum, m) => sum + m.sizeBytes, 0);

  if (totalBytes > policy.totalMaxBytes) {
    const unprotectedAutoOldestFirst = remaining.filter((m) => m.trigger !== 'MANUAL' && !protectedIds.has(m.id)).sort(byVersionNoAsc);
    for (const m of unprotectedAutoOldestFirst) {
      if (totalBytes <= policy.totalMaxBytes) break;
      toPrune.add(m.id);
      totalBytes -= m.sizeBytes;
    }
  }

  if (totalBytes > policy.totalMaxBytes) {
    const unprotectedManualOldestFirst = remaining
      .filter((m) => m.trigger === 'MANUAL' && !protectedIds.has(m.id) && !toPrune.has(m.id))
      .sort(byVersionNoAsc);
    for (const m of unprotectedManualOldestFirst) {
      if (totalBytes <= policy.totalMaxBytes) break;
      toPrune.add(m.id);
      totalBytes -= m.sizeBytes;
    }
  }

  return { pruneIds: [...toPrune], stillOverLimit: totalBytes > policy.totalMaxBytes };
}
