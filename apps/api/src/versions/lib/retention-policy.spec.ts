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

  // 새 테스트 — 구현·리뷰 단계 공백 보강(2026-09-24, No.28 시험 회차). §9.3 — 운영 예약 배포가
  // 참조하는 버전을 보호 집합에 추가하는 4번째 인자(`externallyProtectedIds`, 선택·기본 빈 집합)는
  // 이전까지 전용 케이스가 없었다(AC-D5-1의 순수 함수 절반).
  describe('externallyProtectedIds(§9.3, AC-D5-1) — 운영 예약 배포가 참조하는 버전 보호', () => {
    it('자동 30건 한도를 넘어도 예약이 참조하는 버전은 정리 대상에서 제외된다', () => {
      const metas: VersionMeta[] = [];
      for (let i = 1; i <= 35; i += 1) metas.push(meta(`auto-${i}`, 'BEFORE_IMPORT', i));

      // 보호 없이는 auto-1(가장 오래된 것)이 정리 대상에 포함된다.
      const withoutProtection = selectVersionsToPrune(metas, { retentionAuto: 30, retentionManual: 30, totalMaxBytes: 1_000_000_000 }, 'auto-35');
      expect(withoutProtection.pruneIds).toContain('auto-1');

      // 같은 입력에 auto-1을 외부 보호 집합으로 지정하면 정리 대상에서 빠진다.
      const withProtection = selectVersionsToPrune(
        metas,
        { retentionAuto: 30, retentionManual: 30, totalMaxBytes: 1_000_000_000 },
        'auto-35',
        new Set(['auto-1']),
      );
      expect(withProtection.pruneIds).not.toContain('auto-1');
    });

    it('보호로 인해 총량 상한을 넘으면 기존 stillOverLimit 규약을 그대로 따른다(정리 중단)', () => {
      const metas: VersionMeta[] = [
        meta('protected-1', 'BEFORE_IMPORT', 1, false, 900_000),
        meta('auto-2', 'BEFORE_IMPORT', 2, false, 500_000),
      ];
      const result = selectVersionsToPrune(
        metas,
        { retentionAuto: 30, retentionManual: 30, totalMaxBytes: 800_000 },
        'auto-2',
        new Set(['protected-1']),
      );
      expect(result.pruneIds).not.toContain('protected-1');
      expect(result.stillOverLimit).toBe(true);
    });

    it('기본값(4번째 인자 생략)은 빈 집합과 동일하게 동작한다(기존 호출 무회귀)', () => {
      const metas: VersionMeta[] = [];
      for (let i = 1; i <= 35; i += 1) metas.push(meta(`auto-${i}`, 'BEFORE_IMPORT', i));
      const withEmptySet = selectVersionsToPrune(metas, { retentionAuto: 30, retentionManual: 30, totalMaxBytes: 1_000_000_000 }, 'auto-35', new Set());
      const withoutArg = selectVersionsToPrune(metas, { retentionAuto: 30, retentionManual: 30, totalMaxBytes: 1_000_000_000 }, 'auto-35');
      expect(withEmptySet).toEqual(withoutArg);
    });
  });
});
