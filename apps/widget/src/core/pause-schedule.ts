import { planPauseSchedule as planPauseScheduleShared } from '@chat-bot/shared-types/output-view';
import type { OutputView } from '@chat-bot/shared-types/output-view';

/** `PAUSE` 아웃풋 지연 일정(FR-W-7) — 공유 순수 함수에 위임, 총 지연 5초 상한은 그 안에서 강제된다. */
export function planPauseSchedule(views: OutputView[]): number[] {
  return planPauseScheduleShared(views);
}
