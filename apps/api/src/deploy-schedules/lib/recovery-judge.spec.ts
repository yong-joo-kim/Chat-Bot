import { judgePublishRecovery, judgeRestoreRecovery, judgeSetWebChannelRecovery } from './recovery-judge';

describe('recovery-judge(§7.8, §18, AC-D3-11)', () => {
  it('백업 흔적 있음 → RECOVERED', () => {
    expect(judgeRestoreRecovery(true, false)).toEqual({ kind: 'RECOVERED' });
  });
  it('흔적 없음 + 해시 같음 → NOOP', () => {
    expect(judgeRestoreRecovery(false, true)).toEqual({ kind: 'NOOP' });
  });
  it('흔적 없음 + 해시 다름 → INTERRUPTED(자산 불변)', () => {
    expect(judgeRestoreRecovery(false, false)).toEqual({ kind: 'INTERRUPTED' });
  });

  it('PUBLISH — 목표 도달 → RECOVERED', () => {
    expect(judgePublishRecovery(true, true)).toEqual({ kind: 'RECOVERED' });
  });
  it('PUBLISH — 상태만 도달, 채널 미충족 → INTERRUPTED', () => {
    expect(judgePublishRecovery(true, false)).toEqual({ kind: 'INTERRUPTED' });
  });
  it('PUBLISH — 상태 미도달 → INTERRUPTED', () => {
    expect(judgePublishRecovery(false, true)).toEqual({ kind: 'INTERRUPTED' });
  });

  it('SET_WEB_CHANNEL — 현재값=목표값 → RECOVERED', () => {
    expect(judgeSetWebChannelRecovery(true, true)).toEqual({ kind: 'RECOVERED' });
    expect(judgeSetWebChannelRecovery(false, false)).toEqual({ kind: 'RECOVERED' });
  });
  it('SET_WEB_CHANNEL — 다르면 INTERRUPTED', () => {
    expect(judgeSetWebChannelRecovery(false, true)).toEqual({ kind: 'INTERRUPTED' });
  });
});
