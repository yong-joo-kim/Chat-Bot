import { effectiveStatus } from './effective-status';

describe('effectiveStatus(순수 함수, §8.2 보류 해제 — 상대 시각)', () => {
  const now = new Date();

  it('OPEN은 그대로 OPEN이다', () => {
    expect(effectiveStatus({ status: 'OPEN', snoozeUntil: null }, now)).toEqual({ status: 'OPEN', snoozeExpired: false });
  });

  it('PENDING인데 snoozeUntil이 없으면 그대로 PENDING이다', () => {
    expect(effectiveStatus({ status: 'PENDING', snoozeUntil: null }, now)).toEqual({ status: 'PENDING', snoozeExpired: false });
  });

  it('PENDING이고 해제 시각이 아직 안 지났으면 PENDING이다', () => {
    const future = new Date(now.getTime() + 60_000);
    expect(effectiveStatus({ status: 'PENDING', snoozeUntil: future }, now)).toEqual({ status: 'PENDING', snoozeExpired: false });
  });

  it('PENDING이고 해제 시각이 지났으면 조회 시 OPEN으로 보인다(확정은 다음 쓰기)', () => {
    const past = new Date(now.getTime() - 1000);
    expect(effectiveStatus({ status: 'PENDING', snoozeUntil: past }, now)).toEqual({ status: 'OPEN', snoozeExpired: true });
  });

  it('경계 — 해제 시각과 now가 같으면(≤) OPEN이다', () => {
    expect(effectiveStatus({ status: 'PENDING', snoozeUntil: now }, now)).toEqual({ status: 'OPEN', snoozeExpired: true });
  });

  it('CLOSED는 그대로 CLOSED다', () => {
    expect(effectiveStatus({ status: 'CLOSED', snoozeUntil: null }, now)).toEqual({ status: 'CLOSED', snoozeExpired: false });
  });
});
