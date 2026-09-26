import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Test } from '@nestjs/testing';
import type { PrismaService as PrismaServiceType } from '../prisma/prisma.service';

/**
 * [No.42] 보존기간 파기(★ AC-OC6-2) — `INBOX_TEXT`·`CUSTOMER_IDENTITY`(전역 전용). 상대 시각
 * 픽스처(now 기준 오프셋)를 쓴다(CLAUDE.md). `DATA_RETENTION_WINDOW` 등 동적 조회 설정도 `AppModule`
 * 동적 import 뒤에 읽히므로 data-governance-purge-effects 선례를 따라 동적 import한다.
 */
const API_ROOT = join(__dirname, '..', '..');

async function safeCleanupTmpDir(dir: string): Promise<void> {
  await new Promise((r) => setTimeout(r, 300));
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch {
    // 무시.
  }
}

describe('옴니채널 통합 인박스(No.42) — 보존기간 파기(INBOX_TEXT·CUSTOMER_IDENTITY)', () => {
  it('경과분은 소거되고 미경과분은 유지된다(행·수치·연결은 그대로)', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'chatbot-inbox-retention-test-'));
    const dbPath = join(tmpDir, 'test.db').replace(/\\/g, '/');
    const testDatabaseUrl = `file:${dbPath}`;

    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.DEPLOY_SCHEDULE_ENABLED = 'false';
    process.env.HANDOFF_SWEEPER_ENABLED = 'false';
    process.env.WIDGET_BASE_URL = process.env.WIDGET_BASE_URL ?? 'http://localhost:5174';
    process.env.PUBLIC_API_BASE_URL = process.env.PUBLIC_API_BASE_URL ?? 'http://localhost:3000/api/v1';
    process.env.RETENTION_MIN_DAYS_CONVERSATION = '7';
    process.env.DATA_RETENTION_WINDOW = '00:00-00:00'; // 항상 창 안 — tick()이 즉시 동작

    try {
      execSync('pnpm exec prisma migrate deploy', { cwd: API_ROOT, env: { ...process.env, DATABASE_URL: testDatabaseUrl }, stdio: 'pipe' });

      const { AppModule } = await import('../app.module');
      const { PrismaService } = (await import('../prisma/prisma.service')) as { PrismaService: typeof PrismaServiceType };
      const { RetentionJob } = await import('../governance/jobs/retention.job');
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      const prisma = moduleRef.get(PrismaService);
      const retentionJob = moduleRef.get(RetentionJob);

      const now = new Date();
      const tenDaysAgo = new Date(now.getTime() - 10 * 86_400_000);
      const oneDayAgo = new Date(now.getTime() - 1 * 86_400_000);

      // ── INBOX_TEXT: 전역 10일로 단축(즉시 적용 — 기존 값 없음) ──
      await prisma.retentionPolicy.upsert({
        where: { scopeKey: 'GLOBAL' },
        create: { scopeKey: 'GLOBAL', days: JSON.stringify({ INBOX_TEXT: 7, CUSTOMER_IDENTITY: 7 }), pending: '{}' },
        update: { days: JSON.stringify({ INBOX_TEXT: 7, CUSTOMER_IDENTITY: 7 }), pending: '{}' },
      });

      const oldCustomer = await prisma.customer.create({
        data: { ref: randomUUID().replace(/-/g, '').slice(0, 16), kind: 'ANONYMOUS', status: 'ACTIVE', firstSeenAt: tenDaysAgo, lastActivityAt: tenDaysAgo },
      });
      const oldThread = await prisma.inboxThread.create({
        data: { customerId: oldCustomer.id, status: 'OPEN', openReason: 'MANUAL', lastActivityAt: tenDaysAgo, lastActivityKind: 'SYSTEM', openedAt: tenDaysAgo },
      });
      const oldEntryId = randomUUID();
      await prisma.inboxEntry.create({
        data: { id: oldEntryId, threadId: oldThread.id, kind: 'NOTE', text: '오래된 메모 원문', occurredAt: tenDaysAgo, createdAt: tenDaysAgo },
      });

      const recentCustomer = await prisma.customer.create({
        data: { ref: randomUUID().replace(/-/g, '').slice(0, 16), kind: 'ANONYMOUS', status: 'ACTIVE', firstSeenAt: oneDayAgo, lastActivityAt: oneDayAgo },
      });
      const recentThread = await prisma.inboxThread.create({
        data: { customerId: recentCustomer.id, status: 'OPEN', openReason: 'MANUAL', lastActivityAt: oneDayAgo, lastActivityKind: 'SYSTEM', openedAt: oneDayAgo },
      });
      const recentEntryId = randomUUID();
      await prisma.inboxEntry.create({
        data: { id: recentEntryId, threadId: recentThread.id, kind: 'NOTE', text: '최근 메모 원문', occurredAt: oneDayAgo, createdAt: oneDayAgo },
      });

      // ── CUSTOMER_IDENTITY: 식별 고객(오래됨/최근) ──
      const oldIdentified = await prisma.customer.create({
        data: {
          ref: randomUUID().replace(/-/g, '').slice(0, 16),
          kind: 'IDENTIFIED',
          status: 'ACTIVE',
          customerKeyHash: randomUUID(),
          keyFingerprint: 'abcd1234',
          displayName: '오래된 고객',
          firstSeenAt: tenDaysAgo,
          lastActivityAt: tenDaysAgo,
        },
      });
      const recentIdentified = await prisma.customer.create({
        data: {
          ref: randomUUID().replace(/-/g, '').slice(0, 16),
          kind: 'IDENTIFIED',
          status: 'ACTIVE',
          customerKeyHash: randomUUID(),
          keyFingerprint: 'efgh5678',
          displayName: '최근 고객',
          firstSeenAt: oneDayAgo,
          lastActivityAt: oneDayAgo,
        },
      });

      await retentionJob.tick();

      const purgedEntry = await prisma.inboxEntry.findUniqueOrThrow({ where: { id: oldEntryId } });
      expect(purgedEntry.text).toBe('');
      expect(purgedEntry.textPurgedAt).not.toBeNull();

      const keptEntry = await prisma.inboxEntry.findUniqueOrThrow({ where: { id: recentEntryId } });
      expect(keptEntry.text).toBe('최근 메모 원문');
      expect(keptEntry.textPurgedAt).toBeNull();

      const purgedIdentity = await prisma.customer.findUniqueOrThrow({ where: { id: oldIdentified.id } });
      expect(purgedIdentity.customerKeyHash).toBeNull();
      expect(purgedIdentity.displayName).toBeNull();
      expect(purgedIdentity.keyFingerprint).toBeNull();
      expect(purgedIdentity.identityPurgedAt).not.toBeNull();
      // 행·연결·스레드 자체는 유지된다(EX-OC — "소거된 고객"으로 남는다).
      expect(purgedIdentity.id).toBe(oldIdentified.id);

      const keptIdentity = await prisma.customer.findUniqueOrThrow({ where: { id: recentIdentified.id } });
      expect(keptIdentity.customerKeyHash).not.toBeNull();
      expect(keptIdentity.identityPurgedAt).toBeNull();

      await moduleRef.close();
    } finally {
      await safeCleanupTmpDir(tmpDir);
    }
  }, 60_000);
});
