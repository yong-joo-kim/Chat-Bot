import { describe, expect, it } from 'vitest';
import type { Permission } from '@chat-bot/shared-types';
import { canManageDeploySchedule, deployScheduleRequiredPermissions } from './deploySchedulePermissions';

function canFrom(granted: Permission[]): (p: Permission) => boolean {
  return (p) => granted.includes(p);
}

/** No.28 §8.1 동작별 필요 권한 순수 함수(리뷰 2라운드 M-3). */
describe('deploySchedulePermissions', () => {
  it('RESTORE_VERSION은 dialogue:write와 chatbot:write를 모두 요구한다', () => {
    expect(deployScheduleRequiredPermissions('RESTORE_VERSION')).toEqual(['dialogue:write', 'chatbot:write']);
    expect(canManageDeploySchedule(canFrom(['dialogue:write']), 'RESTORE_VERSION')).toBe(false);
    expect(canManageDeploySchedule(canFrom(['dialogue:write', 'chatbot:write']), 'RESTORE_VERSION')).toBe(true);
  });

  it('PUBLISH는 기본 chatbot:write만 요구하지만, enableWebChannel이면 channel:write도 함께 요구한다', () => {
    expect(deployScheduleRequiredPermissions('PUBLISH')).toEqual(['chatbot:write']);
    expect(deployScheduleRequiredPermissions('PUBLISH', { enableWebChannel: true })).toEqual(['chatbot:write', 'channel:write']);
    expect(canManageDeploySchedule(canFrom(['chatbot:write']), 'PUBLISH', { enableWebChannel: false })).toBe(true);
    expect(canManageDeploySchedule(canFrom(['chatbot:write']), 'PUBLISH', { enableWebChannel: true })).toBe(false);
    expect(canManageDeploySchedule(canFrom(['chatbot:write', 'channel:write']), 'PUBLISH', { enableWebChannel: true })).toBe(true);
  });

  it('SET_WEB_CHANNEL은 channel:write만 요구한다', () => {
    expect(deployScheduleRequiredPermissions('SET_WEB_CHANNEL')).toEqual(['channel:write']);
    expect(canManageDeploySchedule(canFrom(['chatbot:write']), 'SET_WEB_CHANNEL')).toBe(false);
    expect(canManageDeploySchedule(canFrom(['channel:write']), 'SET_WEB_CHANNEL')).toBe(true);
  });
});
