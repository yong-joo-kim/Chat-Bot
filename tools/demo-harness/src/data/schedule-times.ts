// 예약 배포 시각 계산(설계 §7.6 · DHD-8 · H-T4) — 순수 함수. 서버가 다시 검증하므로(`checkScheduleTimeRules`) 생성 전에 같은 함수로 미리 판정한다.
import { checkScheduleTimeRules, DEPLOY_SCHEDULE_LIMITS } from '@chat-bot/shared-types';

const MIN = 60_000;

/** t의 초·밀리초가 0이면 t, 아니면 다음 분 0초(제품은 분 단위로 내림하므로 하네스가 올림해서 최소 5분 규칙을 지킨다). */
export function ceilMinute(t: Date): Date {
  const ms = t.getTime();
  const r = ms % MIN;
  return new Date(r === 0 ? ms : ms - r + MIN);
}

/** 이력용 예약 C-1: `ceilMinute(Pc + 5분 + 30초)` — 최소 5분(LEAD) + 시계 차·전송 여유 30초. */
export function historyScheduleTime(pc: Date): Date {
  return ceilMinute(new Date(pc.getTime() + DEPLOY_SCHEDULE_LIMITS.minLeadMinutes * MIN + 30_000));
}

/** 라이브 예약 C-2: `ceilMinute(T0 + 6분)` — 실행은 T0+6:00~7:00 + 폴링 5초 이내. */
export function liveScheduleTime(t0: Date): Date {
  return ceilMinute(new Date(t0.getTime() + 6 * MIN));
}

/**
 * 같은 분·최소 선행 시간 위반을 피하는 예약 시각. 서버 시계와의 어긋남(400)에 대비해 위반이면 다음 분으로 한 번씩 미룬다(최대 3회).
 * `now`는 호출 시점의 하네스 시계, `otherActive`는 같은 챗봇의 활성 예약 시각들.
 */
export function pickValidScheduleTime(base: Date, now: Date, otherActive: readonly Date[], maxShifts = 3): Date {
  let t = base;
  for (let i = 0; i <= maxShifts; i++) {
    if (checkScheduleTimeRules({ scheduledAt: t, now, otherActiveTimes: otherActive }).length === 0) return t;
    t = new Date(t.getTime() + MIN);
  }
  throw new Error(`예약 시각 규칙을 만족하는 시각을 찾지 못했습니다(기준 ${base.toISOString()})`);
}

/** KST 표시용 `HH:mm`(시연 자막·터미널). */
export function formatKstHm(t: Date): string {
  const kst = new Date(t.getTime() + 9 * 60 * MIN);
  return `${String(kst.getUTCHours()).padStart(2, '0')}:${String(kst.getUTCMinutes()).padStart(2, '0')}`;
}
