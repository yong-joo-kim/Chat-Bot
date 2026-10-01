import { resolveApprovalOffLock } from './approval-off-lock';

describe('resolveApprovalOffLock — N36-1 3상태 판정표', () => {
  it.each([
    [undefined, 'OFF', { locked: false }],
    [undefined, 'ON', { locked: true, by: 'GOVERNANCE_MODE' }],
    [true, 'OFF', { locked: true, by: 'SERVER_SETTING' }],
    [true, 'ON', { locked: true, by: 'SERVER_SETTING' }],
    [false, 'OFF', { locked: false }],
    [false, 'ON', { locked: false }],
  ] as const)('명시값=%s 모드=%s', (explicit, mode, expected) => {
    expect(resolveApprovalOffLock(explicit, mode)).toEqual(expected);
  });

  it('잠금 아닌 결과에는 by 키가 없다', () => {
    expect('by' in resolveApprovalOffLock(false, 'ON')).toBe(false);
  });
});
