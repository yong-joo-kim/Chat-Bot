import { MESSAGES } from '../../constants/messages';

/**
 * 차트 요약 문장 조립(§2.5) — "서버가 내려준 배열의 첫/마지막 유효 버킷값을 비교"한다.
 * 표시 문구 생성일 뿐 새 집계값을 만들지 않으므로 NFR-M2("서버 값을 표시만 한다")를 위반하지 않는다.
 */
export function buildTrendSummary(values: number[], metricLabel: string, formatValue: (n: number) => string): string {
  if (values.length === 0) return MESSAGES.stats.trendSummarySingle(metricLabel, formatValue(0));
  if (values.length === 1) return MESSAGES.stats.trendSummarySingle(metricLabel, formatValue(values[0]));
  const first = values[0];
  const last = values[values.length - 1];
  const trendWord = last > first ? MESSAGES.stats.trendUp : last < first ? MESSAGES.stats.trendDown : MESSAGES.stats.trendFlat;
  return MESSAGES.stats.trendSummaryRange(values.length, metricLabel, formatValue(first), formatValue(last), trendWord);
}
