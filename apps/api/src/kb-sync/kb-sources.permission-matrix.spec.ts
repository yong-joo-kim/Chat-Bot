import 'reflect-metadata';
import { hasPermission } from '@chat-bot/shared-types';
import type { Permission, RoleName } from '@chat-bot/shared-types';
import { PERMISSION_METADATA_KEY } from '../common/auth/require-permission.decorator';
import { KbSourcesController } from './kb-sources.controller';
import { ChatbotKbStatusController } from './chatbot-kb-status.controller';

/**
 * [신규 No.43 — 항목⑩] 지식베이스 API 13개 핸들러 × 역할 4종(ADMIN·EDITOR·VIEWER·AGENT) 권한 매트릭스
 * 를 **모두 나열**해 검증한다(52개 조합). `@RequirePermission` 데코레이터가 실제로 붙인 메타데이터를
 * 읽어(런타임) `hasPermission()`으로 판정하고, 아래 하드코딩한 기대값(설계상의 의도)과 둘 다 비교한다
 * — 데코레이터가 실수로 바뀌거나 `ROLE_PERMISSIONS`가 바뀌어도 이 시험이 잡는다(단순 재유도가 아니다).
 *
 * 컨트롤러 2개(`KbSourcesController` 12 + `ChatbotKbStatusController` 1) = 13개 핸들러.
 */
const ROLES: RoleName[] = ['ADMIN', 'EDITOR', 'VIEWER', 'AGENT'];

interface HandlerCase {
  label: string;
  ctor: new (...args: never[]) => unknown;
  method: string;
  /** 이 핸들러를 통과할 수 있는 역할 집합(설계 의도 — §11 · ADR-0015). */
  allowedRoles: RoleName[];
}

function methodFn(ctor: HandlerCase['ctor'], method: string): (...args: unknown[]) => unknown {
  return (ctor.prototype as Record<string, (...args: unknown[]) => unknown>)[method];
}

const HANDLERS: HandlerCase[] = [
  { label: 'GET /kb-sources', ctor: KbSourcesController, method: 'list', allowedRoles: ['ADMIN'] },
  { label: 'GET /kb-sources/meta', ctor: KbSourcesController, method: 'meta', allowedRoles: ['ADMIN'] },
  { label: 'POST /kb-sources', ctor: KbSourcesController, method: 'create', allowedRoles: ['ADMIN'] },
  { label: 'GET /kb-sources/:id', ctor: KbSourcesController, method: 'findOne', allowedRoles: ['ADMIN'] },
  { label: 'PATCH /kb-sources/:id', ctor: KbSourcesController, method: 'update', allowedRoles: ['ADMIN'] },
  { label: 'DELETE /kb-sources/:id', ctor: KbSourcesController, method: 'remove', allowedRoles: ['ADMIN'] },
  { label: 'POST /kb-sources/:id/runs', ctor: KbSourcesController, method: 'createRun', allowedRoles: ['ADMIN'] },
  { label: 'POST /kb-sources/:id/approve-ingest', ctor: KbSourcesController, method: 'approveIngest', allowedRoles: ['ADMIN'] },
  { label: 'POST /kb-sources/:id/runs/:runId/cancel', ctor: KbSourcesController, method: 'cancelRun', allowedRoles: ['ADMIN'] },
  { label: 'GET /kb-sources/:id/runs', ctor: KbSourcesController, method: 'listRuns', allowedRoles: ['ADMIN'] },
  { label: 'GET /kb-sources/:id/runs/:runId', ctor: KbSourcesController, method: 'getRun', allowedRoles: ['ADMIN'] },
  { label: 'GET /kb-sources/:id/documents', ctor: KbSourcesController, method: 'listDocuments', allowedRoles: ['ADMIN'] },
  { label: 'GET /chatbots/:chatbotId/kb-status', ctor: ChatbotKbStatusController, method: 'get', allowedRoles: ['ADMIN', 'EDITOR', 'VIEWER', 'AGENT'] },
];

describe('지식베이스 API 권한 매트릭스(항목⑩) — 4역할 × 13핸들러 = 52개 조합', () => {
  it('핸들러를 정확히 13개 나열했다', () => {
    expect(HANDLERS).toHaveLength(13);
  });

  it('나열한 13개 메서드가 모두 실제 컨트롤러에 존재한다(오타 방지)', () => {
    for (const h of HANDLERS) {
      expect(typeof methodFn(h.ctor, h.method)).toBe('function');
    }
  });

  for (const h of HANDLERS) {
    describe(h.label, () => {
      const required = Reflect.getMetadata(PERMISSION_METADATA_KEY, methodFn(h.ctor, h.method)) as Permission[] | undefined;

      it('@RequirePermission이 붙어 있다(누락 시 인증만으로 통과하는 사고 방지)', () => {
        expect(Array.isArray(required)).toBe(true);
        expect(required!.length).toBeGreaterThan(0);
      });

      for (const role of ROLES) {
        const expected = h.allowedRoles.includes(role);
        it(`${role} → ${expected ? '허용' : '거부(403)'}`, () => {
          const actual = (required ?? []).every((p) => hasPermission(role, p));
          expect(actual).toBe(expected);
        });
      }
    });
  }
});
