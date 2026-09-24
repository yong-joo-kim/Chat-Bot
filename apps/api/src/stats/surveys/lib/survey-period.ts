import { kstDateOnlyToUtc, parseDayBucket } from '../../lib/kst-date';
import { ApiException } from '../../../common/api.exception';

const MAX_RANGE_DAYS = 366;

/** [No.27] 설문 통계·목록·CSV 공용 기간 검증(§9.2·§9.5·§10) — `[from, to]`(KST, 양끝 포함) 366일 이하. */
export function assertSurveyPeriod(from: string, to: string): void {
  if (from > to) {
    throw new ApiException('INVALID_PERIOD', 400, '시작일이 종료일보다 늦을 수 없습니다.');
  }
  const fromKst = parseDayBucket(from);
  const toKst = parseDayBucket(to);
  const days = Math.round((kstDateOnlyToUtc(toKst, 0, 0, 0, 0).getTime() - kstDateOnlyToUtc(fromKst, 0, 0, 0, 0).getTime()) / 86_400_000) + 1;
  if (days > MAX_RANGE_DAYS) {
    throw new ApiException('STATS_RANGE_TOO_WIDE', 400, `조회 기간은 최대 ${MAX_RANGE_DAYS}일까지 가능합니다.`);
  }
}
