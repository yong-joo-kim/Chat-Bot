import { isSwitchTargetAllowed, pickRollbackTarget, classifySwitch } from './switch-rules';

describe('isSwitchTargetAllowed — §9.3', () => {
  it('SWITCH: 대상이 현재 스테이징이면 허용된다', () => {
    expect(isSwitchTargetAllowed({ target: 'v-staging', staging: 'v-staging', prodHistoryIds: new Set(), kind: 'SWITCH' })).toBe(true);
  });

  it('SWITCH: 대상이 운영 이력에 있으면 허용된다', () => {
    expect(isSwitchTargetAllowed({ target: 'v-old', staging: 'v-staging', prodHistoryIds: new Set(['v-old']), kind: 'SWITCH' })).toBe(true);
  });

  it('SWITCH: 스테이징도 아니고 이력에도 없으면 거부된다', () => {
    expect(isSwitchTargetAllowed({ target: 'v-random', staging: 'v-staging', prodHistoryIds: new Set(['v-old']), kind: 'SWITCH' })).toBe(false);
  });

  it('ROLLBACK: 대상이 운영 이력에 있어야만 허용된다(스테이징이어도 이력에 없으면 거부)', () => {
    expect(isSwitchTargetAllowed({ target: 'v-staging', staging: 'v-staging', prodHistoryIds: new Set(['v-old']), kind: 'ROLLBACK' })).toBe(false);
    expect(isSwitchTargetAllowed({ target: 'v-old', staging: 'v-staging', prodHistoryIds: new Set(['v-old']), kind: 'ROLLBACK' })).toBe(true);
  });

  it('ROLLBACK: 스테이징도 이력에 있으면 허용된다', () => {
    expect(isSwitchTargetAllowed({ target: 'v-staging', staging: 'v-staging', prodHistoryIds: new Set(['v-staging']), kind: 'ROLLBACK' })).toBe(true);
  });
});

describe('pickRollbackTarget — §9.3', () => {
  it('가장 최근 PROD 이력 중 toVersionId=currentProd인 행의 fromVersionId를 고른다', () => {
    const historyDesc = [
      { toVersionId: 'v3', fromVersionId: 'v2' },
      { toVersionId: 'v2', fromVersionId: 'v1' },
    ];
    expect(pickRollbackTarget(historyDesc, 'v3', new Set(['v1', 'v2', 'v3']))).toBe('v2');
  });

  it('fromVersionId가 정리(삭제)되어 존재하지 않으면 currentProd가 아닌 가장 최근 toVersionId로 대체한다', () => {
    const historyDesc = [
      { toVersionId: 'v3', fromVersionId: 'v2-deleted' },
      { toVersionId: 'v2', fromVersionId: 'v1' },
    ];
    expect(pickRollbackTarget(historyDesc, 'v3', new Set(['v1', 'v2', 'v3']))).toBe('v2');
  });

  it('직전 전환 기록 자체가 없으면 null(후보 없음 → 호출자 409)', () => {
    expect(pickRollbackTarget([], 'v1', new Set(['v1']))).toBeNull();
  });

  it('모든 후보가 정리되어 존재하지 않으면 null이다', () => {
    const historyDesc = [{ toVersionId: 'v3', fromVersionId: 'v2-deleted' }];
    expect(pickRollbackTarget(historyDesc, 'v3', new Set(['v3']))).toBeNull();
  });
});

describe('classifySwitch — EX-EN-16', () => {
  it('대상이 현재 운영과 같으면 NOOP이다', () => {
    expect(classifySwitch('v1', 'v1')).toBe('NOOP');
  });
  it('대상이 다르면 SWITCHABLE이다', () => {
    expect(classifySwitch('v2', 'v1')).toBe('SWITCHABLE');
  });
});
