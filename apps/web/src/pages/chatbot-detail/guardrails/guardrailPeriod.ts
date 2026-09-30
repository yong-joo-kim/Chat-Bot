import { GUARDRAIL_LIMITS } from '@chat-bot/shared-types';
import { addDaysToDateInputValue, kstTodayDateInputValue } from '../../../lib/date';
import type { PeriodPreset } from '../PeriodSelector';

/** 프리셋 → (from, to) — 대시보드와 같은 계산(KST 기준). */
export function computeRange(preset: PeriodPreset, customFrom: string, customTo: string): { from: string; to: string } {
  const today = kstTodayDateInputValue();
  switch (preset) {
    case 'TODAY':
      return { from: today, to: today };
    case '7D':
      return { from: addDaysToDateInputValue(today, -6), to: today };
    case '30D':
      return { from: addDaysToDateInputValue(today, -29), to: today };
    case 'CUSTOM':
    default:
      return { from: customFrom || today, to: customTo || today };
  }
}

function dayNumber(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86_400_000);
}

export type PeriodProblem = 'INVALID' | 'TOO_WIDE' | 'REQUIRED';

/** 기간 사전 검사 — 시작일이 종료일보다 늦거나 90일을 넘으면 조회하지 않는다(ui-spec §7.1). */
export function checkPeriod(from: string, to: string): PeriodProblem | null {
  if (!from || !to) return 'REQUIRED';
  const diff = dayNumber(to) - dayNumber(from);
  if (diff < 0) return 'INVALID';
  if (diff + 1 > GUARDRAIL_LIMITS.overviewMaxRangeDays) return 'TOO_WIDE';
  return null;
}
