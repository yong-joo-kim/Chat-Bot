import * as http from 'node:http';
import { normalizeEmail } from '@chat-bot/shared-types';
import { hashPassword } from '../../common/auth/lib/password-hash';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * 통합 테스트 인증 헬퍼(NFR-M4, security-audit-설계.md §13.2). 전역 가드 전환으로 기존
 * 통합 테스트가 전부 `401`이 되는 것을 막는다. 세션을 직접 INSERT하는 우회는 쓰지 않는다 —
 * 실제 `POST /auth/login` 경로를 타야 인증 경로 자체의 회귀도 함께 검증된다.
 */
export type TestRole = 'ADMIN' | 'EDITOR' | 'VIEWER' | 'AGENT';

export const TEST_PASSWORD = 'Test-Password#1';

const TEST_USER_EMAILS: Record<TestRole, string> = {
  ADMIN: 'integration-test-admin@chat-bot.local',
  EDITOR: 'integration-test-editor@chat-bot.local',
  VIEWER: 'integration-test-viewer@chat-bot.local',
  // [신규 No.24] 상담원 — ADR-0036 §7.
  AGENT: 'integration-test-agent@chat-bot.local',
};

/** ADMIN/EDITOR/VIEWER 3계정을 생성한다. 해시는 1회만 계산해 재사용한다(3계정 × 1회 ≈ 300ms). */
export async function seedTestUsers(prisma: PrismaService): Promise<void> {
  const passwordHash = await hashPassword(TEST_PASSWORD);
  for (const role of Object.keys(TEST_USER_EMAILS) as TestRole[]) {
    const email = normalizeEmail(TEST_USER_EMAILS[role]);
    await prisma.user.upsert({
      where: { email },
      update: {},
      create: { email, name: `테스트 ${role}`, role, passwordHash, mustChangePassword: false, status: 'ACTIVE' },
    });
  }
}

/** 실제 `POST /auth/login`을 호출해 `Set-Cookie`의 세션 쿠키 문자열(`cb_session=...`)을 반환한다. */
export function loginAs(baseUrl: string, role: TestRole): Promise<string> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({ email: TEST_USER_EMAILS[role], password: TEST_PASSWORD });
    const { hostname, port, pathname } = new URL(`${baseUrl}/auth/login`);
    const req = http.request(
      {
        method: 'POST',
        hostname,
        port,
        path: pathname,
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          if (res.statusCode !== 200) {
            reject(new Error(`로그인 실패(테스트 헬퍼): status=${res.statusCode} body=${data}`));
            return;
          }
          const setCookie = res.headers['set-cookie'];
          const raw = Array.isArray(setCookie) ? setCookie[0] : setCookie;
          if (!raw) {
            reject(new Error('로그인 응답에 Set-Cookie가 없습니다.'));
            return;
          }
          resolve(raw.split(';')[0]);
        });
      },
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}
