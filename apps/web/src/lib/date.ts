/** FR-0-6: 날짜/시각은 ISO-8601 UTC로 송수신하고, 화면 표시 시 Asia/Seoul 기준으로 변환한다. */
const KST_TIME_ZONE = 'Asia/Seoul';

function toDate(value: string | Date): Date {
  return typeof value === 'string' ? new Date(value) : value;
}

export function formatDateTime(value: string | Date): string {
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: KST_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(toDate(value));
}

export function formatDate(value: string | Date): string {
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: KST_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(toDate(value));
}

/** YYYY-MM-DD(Asia/Seoul 기준) 문자열로 변환한다. 대시보드 기간 쿼리에 사용한다. */
export function toKstDateInputValue(value: string | Date): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: KST_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(toDate(value));
}

export function kstTodayDateInputValue(): string {
  return toKstDateInputValue(new Date());
}

/** `dateStr`(YYYY-MM-DD)에 `days`일을 더한 YYYY-MM-DD 문자열을 반환한다(음수 허용). */
export function addDaysToDateInputValue(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

export function formatPercent(ratio: number): string {
  return `${(ratio * 100).toFixed(1)}%`;
}

/**
 * 상대 시각 표기("3시간 전" 등, `UnansweredRow`의 최근 발생 열). 절대 시각은 항상 `title` 속성으로
 * 함께 제공해 상대 표기만으로 정보가 유실되지 않게 한다(stats-learning-ui-spec.md §4.4).
 */
export function formatRelativeTime(value: string | Date): string {
  const date = toDate(value);
  const diffMs = Date.now() - date.getTime();
  const diffMinutes = Math.round(diffMs / (60 * 1000));
  if (diffMinutes < 1) return '방금 전';
  if (diffMinutes < 60) return `${diffMinutes}분 전`;
  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}시간 전`;
  const diffDays = Math.round(diffHours / 24);
  if (diffDays < 30) return `${diffDays}일 전`;
  return formatDate(date);
}
