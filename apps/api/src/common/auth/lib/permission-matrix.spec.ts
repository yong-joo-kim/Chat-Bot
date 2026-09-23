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

  it('ADMIN은 전체 권한(Permission 유니온, 검증/품질 고도화 그룹부터 15종)을 전부 가진다(NFR-S5)', () => {
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

  it('Permission 유니온은 정확히 15종으로 고정된다(ADR-0029 §5 — simulation:write 신설로 14→15). 새 권한 추가/삭제 시 이 값도 의도적으로 갱신해야 한다', () => {
    expect(Permission.options).toHaveLength(15);
    expect(Permission.options).toEqual(
      expect.arrayContaining([
        'chatbot:read',
        'chatbot:write',
        'chatbot:delete',
        'chatbot:purge',
        'dialogue:read',
        'dialogue:write',
        'channel:read',
        'channel:write',
        'simulation:read',
        'simulation:write',
        'user:read',
        'user:write',
        'security:read',
        'security:write',
        'audit:read',
      ]),
    );
  });

  it('EDITOR·ADMIN은 simulation:write를 갖고 VIEWER는 갖지 않는다(ADR-0029 §5 — TC 세트 쓰기/실행/취소/고정)', () => {
    expect(hasPermission('EDITOR', 'simulation:write')).toBe(true);
    expect(hasPermission('ADMIN', 'simulation:write')).toBe(true);
    expect(hasPermission('VIEWER', 'simulation:write')).toBe(false);
  });
});
