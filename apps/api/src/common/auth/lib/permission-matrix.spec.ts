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

  it('ADMIN은 전체 권한(Permission 유니온, 하이브리드 CS 그룹부터 17종)을 전부 가진다(NFR-S5)', () => {
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

  it('Permission 유니온은 정확히 17종으로 고정된다(No.24 cs:read·cs:write 신설로 15→17). 새 권한 추가/삭제 시 이 값도 의도적으로 갱신해야 한다', () => {
    expect(Permission.options).toHaveLength(17);
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
        'cs:read',
        'cs:write',
      ]),
    );
  });

  it('EDITOR·ADMIN은 simulation:write를 갖고 VIEWER는 갖지 않는다(ADR-0029 §5 — TC 세트 쓰기/실행/취소/고정)', () => {
    expect(hasPermission('EDITOR', 'simulation:write')).toBe(true);
    expect(hasPermission('ADMIN', 'simulation:write')).toBe(true);
    expect(hasPermission('VIEWER', 'simulation:write')).toBe(false);
  });

  describe('복수 인자 AND 판정(§11, ADR-0031 §7 No.25 복원) — PermissionGuard가 쓰는 filter 로직과 동일 규칙', () => {
    /** `PermissionGuard.canActivate()`의 AND 판정과 동일한 순수 로직 — 가상 역할로 "하나만 가진 경우"를 재현한다. */
    function missingPermissions(rolePermissions: readonly Permission[], required: readonly Permission[]): Permission[] {
      return required.filter((p) => !rolePermissions.includes(p));
    }

    it('두 권한을 모두 가진 EDITOR는 복원(dialogue:write AND chatbot:write)을 통과한다', () => {
      const missing = missingPermissions(ROLE_PERMISSIONS.EDITOR, ['dialogue:write', 'chatbot:write']);
      expect(missing).toEqual([]);
    });

    it('VIEWER는 두 권한 모두 없어 복원이 거부된다(둘 다 missing)', () => {
      const missing = missingPermissions(ROLE_PERMISSIONS.VIEWER, ['dialogue:write', 'chatbot:write']);
      expect(missing.sort()).toEqual(['chatbot:write', 'dialogue:write']);
    });

    it('★ 가상 역할 — dialogue:write만 가진 역할은 chatbot:write가 없어 여전히 거부된다(AND는 OR가 아니다, AC-H4-4)', () => {
      const virtualRolePermissions: Permission[] = ['dialogue:write'];
      const missing = missingPermissions(virtualRolePermissions, ['dialogue:write', 'chatbot:write']);
      expect(missing).toEqual(['chatbot:write']);
    });

    it('★ 가상 역할 — chatbot:write만 가진 역할도 dialogue:write가 없어 거부된다', () => {
      const virtualRolePermissions: Permission[] = ['chatbot:write'];
      const missing = missingPermissions(virtualRolePermissions, ['dialogue:write', 'chatbot:write']);
      expect(missing).toEqual(['dialogue:write']);
    });

    it('단일 인자 호출(기존 75곳+)은 배열 [permission] 1개로 취급되어도 판정이 동일하다', () => {
      expect(missingPermissions(ROLE_PERMISSIONS.VIEWER, ['chatbot:read'])).toEqual([]);
      expect(missingPermissions(ROLE_PERMISSIONS.VIEWER, ['chatbot:write'])).toEqual(['chatbot:write']);
    });
  });
});
