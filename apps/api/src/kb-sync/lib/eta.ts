/**
 * [신규 No.43 — 3차 보완 · §9.6 · FR-KB5-5 · NFR-KBA1] 예상 남은 시간(순수). 남은 적재 작업 수 ×
 * 최근 성공 작업(HTML·파일 분리, 최대 20건)의 평균 소요(제출→완료) ÷ 슬롯 수. 표본이 없으면
 * 가정치(HTML 45초 · 파일 150초 — §4.10 추정)를 쓴다. 추정 자체가 불가능할 때만(슬롯 0 이하 등)
 * `null`을 낸다 — 남은 작업이 0건이면 0을 낸다(대기 없음).
 *
 * `now`를 인자로 받지 않는다 — 이 함수는 "이미 계산된 남은 건수·평균값"만 다루는 순수 산술이라
 * 시각 의존이 없다(호출부가 최근 작업 조회 시점의 `now`를 따로 관리한다).
 */
export const ETA_DEFAULT_HTML_SECONDS = 45;
export const ETA_DEFAULT_FILE_SECONDS = 150;

export interface EtaSampleAverages {
  htmlAvgSeconds: number | null;
  fileAvgSeconds: number | null;
}

export interface EtaInput {
  remainingHtmlJobs: number;
  remainingFileJobs: number;
  slotCount: number;
  sampleAverages: EtaSampleAverages;
}

export function computeEtaSeconds(input: EtaInput): number | null {
  if (!Number.isFinite(input.slotCount) || input.slotCount <= 0) return null;
  if (input.remainingHtmlJobs < 0 || input.remainingFileJobs < 0) return null;
  const remaining = input.remainingHtmlJobs + input.remainingFileJobs;
  if (remaining <= 0) return 0;

  const htmlAvg = input.sampleAverages.htmlAvgSeconds ?? ETA_DEFAULT_HTML_SECONDS;
  const fileAvg = input.sampleAverages.fileAvgSeconds ?? ETA_DEFAULT_FILE_SECONDS;
  const totalSeconds = input.remainingHtmlJobs * htmlAvg + input.remainingFileJobs * fileAvg;
  return Math.ceil(totalSeconds / input.slotCount);
}

/** 소요(초) 표본 배열의 평균 — 표본 0건이면 `null`(호출부가 가정치로 대체). */
export function averageSeconds(samples: readonly number[]): number | null {
  if (samples.length === 0) return null;
  const sum = samples.reduce((a, b) => a + b, 0);
  return sum / samples.length;
}
