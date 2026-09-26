/** [신규 No.41] 재시도 백오프(§7.5) — 순수. `random()`은 0~1 사이 값을 주입받는다(결정적 시험용). */

export function parseBackoffSchedule(spec: string): number[] {
  return spec.split(',').map((token) => {
    const m = /^(\d+)(s|m|h)$/.exec(token.trim());
    if (!m) return 30_000;
    const n = Number(m[1]);
    const unit = m[2];
    const ms = unit === 's' ? 1000 : unit === 'm' ? 60_000 : 3_600_000;
    return n * ms;
  });
}

/** 지연 = `schedule[min(n-1, len-1)] * (0.8 + 0.4 * random())`(n = 방금 실패한 시도 번호). */
export function computeBackoffMs(scheduleMs: readonly number[], attemptNumber: number, random: () => number): number {
  if (scheduleMs.length === 0) return 30_000;
  const idx = Math.min(Math.max(attemptNumber - 1, 0), scheduleMs.length - 1);
  const base = scheduleMs[idx];
  return Math.round(base * (0.8 + 0.4 * random()));
}
