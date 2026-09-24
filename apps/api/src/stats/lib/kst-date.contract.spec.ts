import { toKstDayBucket } from '@chat-bot/shared-types';
import { formatDayBucket, toKstDateOnly } from './kst-date';

/**
 * No.29 KST 헬퍼 동치 계약 테스트(FR-I5-2, AC-I6-5, `integrated-stats-설계.md` §7 ②). `kst-date.ts`
 * (통계 내부 달력 산술)와 `shared-types`의 `toKstDayBucket`(적재 시점 확정)은 역할이 달라 합치지
 * 않지만, 같은 입력에서 항상 같은 문자열을 내야 한다 — 두 구현이 갈라지면 통계와 원천 적재의
 * 날짜 경계가 어긋난다. 고정 시드 LCG(재현성 — `Math.random` 금지) 1,000개 + 경계값을 검사한다.
 */

/** 결정론적 의사난수(선형 합동 생성기) — 테스트 재현성을 위해 `Math.random`을 쓰지 않는다. */
function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}

describe('kst-date.ts ↔ shared-types.toKstDayBucket 동치 계약(FR-I5-2)', () => {
  it('경계값에서 두 구현이 같은 dayBucket 문자열을 낸다', () => {
    const boundaries = [
      new Date('2026-09-21T15:00:00.000Z'), // KST 00:00:00.000
      new Date('2026-09-22T14:59:59.999Z'), // KST 23:59:59.999
      new Date('2026-09-21T14:59:59.999Z'), // UTC 14:59:59.999(KST 자정 직전)
      new Date('2026-09-21T15:00:00.000Z'), // UTC 15:00:00.000(KST 자정)
      new Date('2026-12-31T14:59:59.999Z'), // 12/31→1/1 KST 경계
      new Date('2026-12-31T15:00:00.000Z'),
      new Date('2028-02-28T15:00:00.000Z'), // 2/28→2/29 윤년
      new Date('2028-02-29T15:00:00.000Z'), // 2/29→3/1
      new Date('1970-01-01T00:00:00.000Z'), // 유닉스 epoch
    ];
    for (const d of boundaries) {
      expect(formatDayBucket(toKstDateOnly(d))).toBe(toKstDayBucket(d));
    }
  });

  it('고정 시드 LCG 1,000개 무작위 시각에서 두 구현이 같은 dayBucket 문자열을 낸다', () => {
    const rand = lcg(20260924);
    // 1970-01-01 ~ 2050-01-01 사이 임의 시각(ms).
    const rangeStart = 0;
    const rangeEnd = new Date('2050-01-01T00:00:00.000Z').getTime();
    for (let i = 0; i < 1000; i += 1) {
      const ms = Math.floor(rangeStart + rand() * (rangeEnd - rangeStart));
      const d = new Date(ms);
      expect(formatDayBucket(toKstDateOnly(d))).toBe(toKstDayBucket(d));
    }
  });
});
