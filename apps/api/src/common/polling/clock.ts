/**
 * [신규 2026-09-23 No.28] 시계 포트(NFR-DM4) — 엔진·서비스·repository는 `new Date()`/`Date.now()`를
 * 직접 호출하지 않고 이 포트를 주입받는다(정적 검사 §16 D-12). 운영은 `SystemClock`, 시험은
 * `FakeClock`(테스트 파일에서 구현)을 주입한다.
 */
export interface Clock {
  now(): Date;
}

export const CLOCK = Symbol('CLOCK');

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}
