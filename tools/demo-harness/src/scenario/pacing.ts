// 보이는 시연의 사람 속도 연출(설계 §9.2 · FR-DH4-5) — "표시 유지(dwell)"와 "타이핑 지연" 2가지만 여기에 둔다(결과 대기가 아니라 연출 시간).
import type { Locator } from 'playwright-core';
import type { Pacing } from './types';
import { sleepMs } from '../util/wait-for';

/** 글자당 입력 지연(FR-DH4-5 권고 범위 안). */
export const TYPING_DELAY_MS = 70;
/** 단계 사이 최소 표시 시간. */
export const MIN_SHOW_MS = 1500;

export function makePacing(mode: 'visible' | 'headless-check'): Pacing {
  return {
    async type(target: Locator, text: string): Promise<void> {
      if (mode === 'headless-check') {
        await target.fill(text);
        return;
      }
      await target.click();
      await target.fill('');
      await target.pressSequentially(text, { delay: TYPING_DELAY_MS });
    },
  };
}

/** 화면 유지(연출). 취소 신호가 오면 즉시 끝난다. */
export async function dwell(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms > 0) await sleepMs(ms, signal);
}

/**
 * [DT-2] 매체가 실제 시간으로 재생되는 동안의 유지(예: 합성 음성 WAV 길이 + 1.0초) — 결과 대기가 아니라 "소리가 나는 시간"이라
 * 보이는 시연·무인 점검 모두에서 필요하다(NFR-DHR2 허용 예외 3번째 · 설계 §8.3). 취소 신호가 오면 즉시 끝난다.
 */
export async function holdForMedia(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms > 0) await sleepMs(ms, signal);
}
