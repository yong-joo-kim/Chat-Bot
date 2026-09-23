import { selectVersionsToPrune } from './retention-policy';
import type { VersionMeta } from './retention-policy';

function meta(id: string, trigger: VersionMeta['trigger'], versionNo: number, pinned = false, sizeBytes = 1000): VersionMeta {
  return { id, trigger, versionNo, pinned, sizeBytes };
}

describe('retention-policy — §6.6 selectVersionsToPrune', () => {
  it('AC-H1-8: 자동 30건이 소진돼도 수동 버전은 밀려나지 않는다(한도 분리)', () => {
    const metas: VersionMeta[] = [];
    for (let i = 1; i <= 35; i += 1) metas.push(meta(`auto-${i}`, 'BEFORE_IMPORT', i));
    for (let i = 36; i <= 40; i += 1) metas.push(meta(`manual-${i}`, 'MANUAL', i));

    const result = selectVersionsToPrune(metas, { retentionAuto: 30, retentionManual: 30, totalMaxBytes: 1_000_000_000 }, 'auto-35');
    const prunedManual = result.pruneIds.filter((id) => id.startsWith('manual-'));
    expect(prunedManual).toEqual([]);
    // 자동 35건 중 최신 30건만 보호 — 5건 정리 대상(단, justCreatedId는 보호)
    const prunedAuto = result.pruneIds.filter((id) => id.startsWith('auto-'));
    expect(prunedAuto.length).toBeGreaterThan(0);
  });

  it('최신 BEFORE_RESTORE 1건은 항상 보호된다', () => {
    const metas: VersionMeta[] = [];
    for (let i = 1; i <= 40; i += 1) metas.push(meta(`auto-${i}`, i === 40 ? 'BEFORE_RESTORE' : 'BEFORE_IMPORT', i));

    const result = selectVersionsToPrune(metas, { retentionAuto: 30, retentionManual: 30, totalMaxBytes: 1_000_000_000 }, 'auto-1');
    expect(result.pruneIds).not.toContain('auto-40');
  });

  it('pinned 버전은 정리 대상에서 제외된다', () => {
    const metas: VersionMeta[] = [];
    for (let i = 1; i <= 35; i += 1) metas.push(meta(`m-${i}`, 'MANUAL', i, i === 1));

    const result = selectVersionsToPrune(metas, { retentionAuto: 30, retentionManual: 30, totalMaxBytes: 1_000_000_000 }, 'm-35');
    expect(result.pruneIds).not.toContain('m-1');
  });

  it('총량 초과 시 비보호 자동 → 오래된 순으로 정리하고, 그래도 초과면 비보호 수동도 정리한다', () => {
    const metas: VersionMeta[] = [
      meta('auto-1', 'BEFORE_IMPORT', 1, false, 500_000),
      meta('auto-2', 'BEFORE_IMPORT', 2, false, 500_000),
      meta('manual-1', 'MANUAL', 3, false, 500_000),
    ];
    const result = selectVersionsToPrune(metas, { retentionAuto: 30, retentionManual: 30, totalMaxBytes: 800_000 }, 'manual-1');
    // 총합 1.5MB > 800KB → 오래된 자동(auto-1)부터 정리
    expect(result.pruneIds).toContain('auto-1');
  });

  it('고정만 남아도 초과면 stillOverLimit:true를 보고한다(삭제는 중단)', () => {
    const metas: VersionMeta[] = [meta('p-1', 'MANUAL', 1, true, 900_000)];
    const result = selectVersionsToPrune(metas, { retentionAuto: 30, retentionManual: 30, totalMaxBytes: 100_000 }, 'p-1');
    expect(result.pruneIds).toEqual([]);
    expect(result.stillOverLimit).toBe(true);
  });

  it('빈 목록이면 아무것도 정리하지 않는다', () => {
    const result = selectVersionsToPrune([], { retentionAuto: 30, retentionManual: 30, totalMaxBytes: 1000 }, 'x');
    expect(result).toEqual({ pruneIds: [], stillOverLimit: false });
  });
});
