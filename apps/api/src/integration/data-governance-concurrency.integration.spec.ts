import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import * as http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { VersioningType } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { AllExceptionsFilter } from '../common/all-exceptions.filter';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * 데이터 거버넌스(No.45) — 다중 인스턴스·동시성 통합 시험.
 * - AC-DG5-4: 같은 SQLite 파일을 보는 완전히 별도의 Nest DI 컨테이너 2개(`scheduled-deploy-multi-
 *   instance.integration.spec.ts` 선례)가 같은 파기 대상을 동시에 `tick()`해도 임대(lease) CAS로
 *   1인스턴스만 실행된다.
 * - AC-DG6-3: 같은 프로세스에서 `AuditLogService.record()` 50건을 `Promise.all`로 동시 기록해도
 *   헤드 CAS + 재시도가 `seq` 중복·결손을 만들지 않는다(실제 SQLite).
 */

jest.setTimeout(60_000); // 50건 동시 기록(인스턴스 로컬 직렬화 큐 적용 후 실측 ~10초 내외) 여유를 둔다.

const API_ROOT = join(__dirname, '..', '..');

async function safeCleanupTmpDir(dir: string): Promise<void> {
  await new Promise((r) => setTimeout(r, 300));
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch {
    // 정리 실패는 판정에 영향 없음.
  }
}

describe('데이터 거버넌스(No.45) 다중 인스턴스·동시성 통합 시험', () => {
  let app1: NestExpressApplication | undefined;
  let app2: NestExpressApplication | undefined;
  let tmpDir: string;
  let prisma1: PrismaService;
  let moduleRef1: import('@nestjs/testing').TestingModule;
  let moduleRef2: import('@nestjs/testing').TestingModule;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'data-governance-concurrency-test-'));
    const dbPath = join(tmpDir, 'test.db').replace(/\\/g, '/');
    const testDatabaseUrl = `file:${dbPath}`;

    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.DEPLOY_SCHEDULE_ENABLED = 'false';
    process.env.HANDOFF_SWEEPER_ENABLED = 'false';
    process.env.WIDGET_BASE_URL = process.env.WIDGET_BASE_URL ?? 'http://localhost:5174';
    process.env.PUBLIC_API_BASE_URL = process.env.PUBLIC_API_BASE_URL ?? 'http://localhost:3000/api/v1';
    process.env.EMBEDDING_BASE_URL = '';
    process.env.RAG_BASE_URL = '';

    process.env.DATA_GOVERNANCE_MODE = 'OFF';
    process.env.DATA_ENCRYPTION_ENABLED = 'false';
    process.env.DATA_ENCRYPTION_KEYS = '';
    process.env.DATA_EGRESS_ALLOWED_HOSTS = '';
    process.env.DATA_RETENTION_JOB_ENABLED = 'false';
    process.env.DATA_REENCRYPT_JOB_ENABLED = 'false';
    process.env.RETENTION_MIN_DAYS_CONVERSATION = '1';
    process.env.DATA_RETENTION_WINDOW = '00:00-00:00'; // 항상 창 안(24시간) — tick()이 즉시 동작

    try {
      execSync('pnpm exec prisma migrate deploy', { cwd: API_ROOT, env: { ...process.env, DATABASE_URL: testDatabaseUrl }, stdio: 'pipe' });
    } catch (e) {
      const err = e as { stdout?: Buffer; stderr?: Buffer };
      throw new Error(`prisma migrate deploy 실패:\n${err.stdout?.toString()}\n${err.stderr?.toString()}`);
    }

    const { AppModule } = await import('../app.module');
    const { PrismaService: PrismaServiceClass } = await import('../prisma/prisma.service');

    // 인스턴스 1
    moduleRef1 = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app1 = moduleRef1.createNestApplication<NestExpressApplication>();
    app1.enableCors();
    app1.setGlobalPrefix('api');
    app1.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app1.useGlobalFilters(new AllExceptionsFilter());
    prisma1 = moduleRef1.get(PrismaServiceClass);
    await app1.listen(0);

    // 인스턴스 2 — 완전히 별도의 DI 컨테이너(별도 PrismaClient 연결), 같은 SQLite 파일.
    moduleRef2 = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app2 = moduleRef2.createNestApplication<NestExpressApplication>();
    app2.enableCors();
    app2.setGlobalPrefix('api');
    app2.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app2.useGlobalFilters(new AllExceptionsFilter());
    await app2.listen(0);
  }, 60_000);

  afterAll(async () => {
    await app1?.close();
    await app2?.close();
    await safeCleanupTmpDir(tmpDir);
  }, 30_000);

  it('AC-DG5-4: 두 인스턴스가 같은 파기 대상을 동시에 tick()해도 1인스턴스만 실행된다(임대 CAS)', async () => {
    const { RetentionJob } = await import('../governance/jobs/retention.job');
    const job1 = moduleRef1.get(RetentionJob);
    const job2 = moduleRef2.get(RetentionJob);

    const group = await prisma1.chatbotGroup.create({ data: { name: `동시성-그룹-${randomUUID().slice(0, 8)}` } });
    const chatbot = await prisma1.chatbot.create({ data: { groupId: group.id, name: '동시성 챗봇', slug: `concurrency-${randomUUID().slice(0, 8)}` } });
    const oldDate = new Date(Date.now() - 30 * 86_400_000);
    const log = await prisma1.conversationLog.create({
      data: {
        chatbotId: chatbot.id,
        channelType: 'WEB',
        sessionId: 'sess-concurrency',
        userMessage: '동시성 시험 질문',
        botResponse: '동시성 시험 답변',
        isAnswered: true,
        dayBucket: '2025-01-01',
        hourBucket: 10,
        createdAt: oldDate,
      },
    });

    await prisma1.retentionPolicy.upsert({
      where: { scopeKey: 'GLOBAL' },
      create: { scopeKey: 'GLOBAL', days: JSON.stringify({ CONVERSATION_TEXT: 1 }), pending: '{}' },
      update: { days: JSON.stringify({ CONVERSATION_TEXT: 1 }), pending: '{}' },
    });

    // 두 인스턴스가 정확히 같은 시각에 tick()을 돈다.
    await Promise.all([job1.tick(), job2.tick()]);

    const purged = await prisma1.conversationLog.findUnique({ where: { id: log.id } });
    expect(purged!.textPurgedAt).not.toBeNull();
    expect(purged!.userMessage).toBe('');

    // 요약 RetentionRun(kind=PURGE, target=null) 행이 정확히 1건이어야 한다 — 1인스턴스만 실행된 증거.
    const summaryRuns = await prisma1.retentionRun.findMany({ where: { kind: 'PURGE', target: null } });
    expect(summaryRuns.length).toBe(1);
  }, 30_000);

  it('AC-DG5-4 보조: 선점에 실패한 인스턴스는 즉시 반환한다(임대가 이미 유효할 때 두 번째 tick은 아무 일도 하지 않는다)', async () => {
    const { RetentionJob } = await import('../governance/jobs/retention.job');
    const { GovernanceJobLease } = await import('../governance/jobs/job-lease');
    const lease1 = moduleRef1.get(GovernanceJobLease);
    const job2 = moduleRef2.get(RetentionJob);

    const now = new Date();
    const token = await lease1.claim('RETENTION', 10 * 60_000, now); // 인스턴스 1이 먼저 선점
    expect(token).not.toBeNull();

    const before = await prisma1.retentionRun.count();
    await job2.tick(); // 인스턴스 2는 선점 실패 → 조용히 반환
    const after = await prisma1.retentionRun.count();
    expect(after).toBe(before);

    await lease1.release('RETENTION', token as string);
  }, 30_000);

  it('AC-DG6-3: 감사 기록 50건을 동시에(Promise.all) 기록해도 seq 중복·결손이 없다', async () => {
    const { AuditLogService } = await import('../audit-logs/audit-log.service');
    const { AuditChainVerifier } = await import('../audit-logs/chain/audit-chain-verifier.service');
    const auditLog = moduleRef1.get(AuditLogService);
    const verifier = moduleRef1.get(AuditChainVerifier);

    const before = await prisma1.auditChainHead.findUnique({ where: { id: 'HEAD' } });
    const beforeSeq = before?.headSeq ?? 0;

    const N = 50;
    await Promise.all(
      Array.from({ length: N }, (_, i) =>
        auditLog.record({
          action: 'UPDATE',
          targetType: 'BannedWord',
          targetId: `concurrency-${i}`,
          summary: `동시 기록 시험 ${i}`,
          actorOverride: { id: null, email: 'system', role: null },
        }),
      ),
    );

    const after = await prisma1.auditChainHead.findUnique({ where: { id: 'HEAD' } });
    const afterSeq = after?.headSeq ?? 0;

    // 체인 밖 폴백(경합 초과) 없이 전부 체인에 들어갔다면 정확히 N만큼 전진한다.
    const rows = await prisma1.auditLog.findMany({
      where: { seq: { gt: beforeSeq, lte: afterSeq } },
      orderBy: { seq: 'asc' },
      select: { seq: true },
    });
    const seqs = rows.map((r) => r.seq as number);
    const uniqueSeqs = new Set(seqs);
    expect(uniqueSeqs.size).toBe(seqs.length); // 중복 없음
    for (let i = 0; i < seqs.length - 1; i += 1) {
      expect(seqs[i + 1]).toBe(seqs[i] + 1); // 결손 없음(연속)
    }

    const result = await verifier.verify(undefined, undefined, new Date());
    expect(result.status).toBe('OK');
  }, 60_000);
});
