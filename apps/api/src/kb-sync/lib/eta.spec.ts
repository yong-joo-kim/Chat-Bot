import { ETA_DEFAULT_FILE_SECONDS, ETA_DEFAULT_HTML_SECONDS, averageSeconds, computeEtaSeconds } from './eta';

describe('computeEtaSeconds — 3차 보완 §9.6', () => {
  it('남은 작업이 0건이면 0을 낸다(대기 없음 — null이 아니다)', () => {
    expect(computeEtaSeconds({ remainingHtmlJobs: 0, remainingFileJobs: 0, slotCount: 1, sampleAverages: { htmlAvgSeconds: null, fileAvgSeconds: null } })).toBe(0);
  });

  it('표본이 없으면 가정치(HTML 45초·파일 150초)를 쓴다', () => {
    const result = computeEtaSeconds({ remainingHtmlJobs: 2, remainingFileJobs: 1, slotCount: 1, sampleAverages: { htmlAvgSeconds: null, fileAvgSeconds: null } });
    expect(result).toBe(Math.ceil(2 * ETA_DEFAULT_HTML_SECONDS + 1 * ETA_DEFAULT_FILE_SECONDS));
  });

  it('표본이 있으면 표본 평균을 우선한다', () => {
    const result = computeEtaSeconds({ remainingHtmlJobs: 4, remainingFileJobs: 0, slotCount: 2, sampleAverages: { htmlAvgSeconds: 10, fileAvgSeconds: null } });
    expect(result).toBe(Math.ceil((4 * 10) / 2));
  });

  it('슬롯 수로 나눈다(병렬 처리 반영)', () => {
    const result = computeEtaSeconds({ remainingHtmlJobs: 10, remainingFileJobs: 0, slotCount: 5, sampleAverages: { htmlAvgSeconds: 20, fileAvgSeconds: null } });
    expect(result).toBe(Math.ceil((10 * 20) / 5));
  });

  it('★ 추정 자체가 불가능하면(슬롯 0 이하) null을 낸다', () => {
    expect(computeEtaSeconds({ remainingHtmlJobs: 1, remainingFileJobs: 0, slotCount: 0, sampleAverages: { htmlAvgSeconds: null, fileAvgSeconds: null } })).toBeNull();
    expect(computeEtaSeconds({ remainingHtmlJobs: 1, remainingFileJobs: 0, slotCount: -1, sampleAverages: { htmlAvgSeconds: null, fileAvgSeconds: null } })).toBeNull();
  });

  it('음수 남은 건수는 방어적으로 null 처리한다', () => {
    expect(computeEtaSeconds({ remainingHtmlJobs: -1, remainingFileJobs: 0, slotCount: 1, sampleAverages: { htmlAvgSeconds: null, fileAvgSeconds: null } })).toBeNull();
  });
});

describe('averageSeconds', () => {
  it('표본이 없으면 null', () => {
    expect(averageSeconds([])).toBeNull();
  });
  it('표본 평균을 낸다', () => {
    expect(averageSeconds([10, 20, 30])).toBe(20);
  });
});
