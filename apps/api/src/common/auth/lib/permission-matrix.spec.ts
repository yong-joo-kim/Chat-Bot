import { Permission, ROLE_PERMISSIONS, hasPermission } from '@chat-bot/shared-types';

describe('hasPermission / ROLE_PERMISSIONS — ADR-0015', () => {
  it('VIEWER는 읽기 권한만 가진다', () => {
    expect(hasPermission('VIEWER', 'chatbot:read')).toBe(true);
    expect(hasPermission('VIEWER', 'chatbot:write')).toBe(false);
    expect(hasPermission('VIEWER', 'audit:read')).toBe(false);
  });

  it('EDITOR는 쓰기 권한을 갖지만 관리자 전용 권한은 갖지 않는다', () => {
    expect(hasPermission('EDITOR', 'chatbot:write')).toBe(true);
    expect(hasPermission('EDITOR', 'chatbot:purge')).toBe(false);
    expect(hasPermission('EDITOR', 'user:write')).toBe(false);
  });

  it('ADMIN은 14종 권한을 전부 가진다(NFR-S5)', () => {
    for (const permission of Permission.options) {
      expect(hasPermission('ADMIN', permission)).toBe(true);
    }
    expect(ROLE_PERMISSIONS.ADMIN).toHaveLength(Permission.options.length);
  });

  it('EDITOR 권한 집합은 VIEWER의 상위집합이다', () => {
    for (const permission of ROLE_PERMISSIONS.VIEWER) {
      expect(ROLE_PERMISSIONS.EDITOR).toContain(permission);
    }
  });
});
