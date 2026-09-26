import { execSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
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
 * 데이터 거버넌스(No.45) — 키 교체 전체 흐름 통합 시험(AC-DG3-4) + `FieldCryptoJob` 전용 시험.
 * `resetKeyProvidersForTest()`(함수명에 `ForTest` — 운영 코드 호출 0)로 `env-key.provider.ts`의
 * 지연 1회 파싱 메모를 재설정해 "환경변수를 바꾸고 재기동"을 같은 프로세스 안에서 재현한다.
 */

const API_ROOT = join(__dirname, '..', '..');

function newKeyBase64(): string {
  return randomBytes(32).toString('base64');
}

async function safeCleanupTmpDir(dir: string): Promise<void> {
  await new Promise((r) => setTimeout(r, 300));
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch {
    // 정리 실패는 판정에 영향 없음.
  }
}

describe('데이터 거버넌스(No.45) 통합 시험 — 키 교체 전체 흐름(AC-DG3-4) · FieldCryptoJob', () => {
  let app: NestExpressApplication | undefined;
  let tmpDir: string;
  let prisma: PrismaService;
  let moduleRef: import('@nestjs/testing').TestingModule;
  let chatbotId: string;
  let handoffSessionId: string;

  const k1 = newKeyBase64();
  const k2 = newKeyBase64();

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'data-governance-key-rotation-test-'));
    const dbPath = join(tmpDir, 'test.db').replace(/\\/g, '/');
    const testDatabaseUrl = `file:${dbPath}`;

    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.DEPLOY_SCHEDULE_ENABLED = 'false';
    process.env.HANDOFF_SWEEPER_ENABLED = 'false';
    process.env.WIDGET_BASE_URL = process.env.WIDGET_BASE_URL ?? 'http://localhost:5174';
    process.env.PUBLIC_API_BASE_URL = process.env.PUBLIC_API_BASE_URL ?? 'http://localhost:3000/api/v1';
    process.env.EMBEDDING_BASE_URL = '';
    process.env.RAG_BASE_URL = '';

    process.env.DATA_GOVERNANCE_MODE = 'ON';
    process.env.DATA_ENCRYPTION_ENABLED = 'true';
    process.env.DATA_ENCRYPTION_KEYS = `k1:${k1}`;
    process.env.DATA_EGRESS_ALLOWED_HOSTS = '';
    process.env.DATA_RETENTION_JOB_ENABLED = 'false';
    process.env.DATA_REENCRYPT_JOB_ENABLED = 'false';

    try {
      execSync('pnpm exec prisma migrate deploy', { cwd: API_ROOT, env: { ...process.env, DATABASE_URL: testDatabaseUrl }, stdio: 'pipe' });
    } catch (e) {
      const err = e as { stdout?: Buffer; stderr?: Buffer };
      throw new Error(`prisma migrate deploy 실패:\n${err.stdout?.toString()}\n${err.stderr?.toString()}`);
    }

    const { AppModule } = await import('../app.module');
    const { PrismaService: PrismaServiceClass } = await import('../prisma/prisma.service');

    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    app.enableCors();
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalFilters(new AllExceptionsFilter());
    prisma = moduleRef.get(PrismaServiceClass);
    await app.listen(0);
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await safeCleanupTmpDir(tmpDir);
  }, 30_000);

  it('1단계 — k1만 있을 때 상담 메시지·설문 답이 enc:v1:k1: 봉투로 저장된다', async () => {
    const { HandoffThreadService } = await import('../handoff/handoff-thread.service');
    const thread = moduleRef.get(HandoffThreadService);

    const group = await prisma.chatbotGroup.create({ data: { name: `키교체-그룹-${randomUUID().slice(0, 8)}` } });
    const chatbot = await prisma.chatbot.create({ data: { groupId: group.id, name: '키 교체 챗봇', slug: `key-rot-${randomUUID().slice(0, 8)}` } });
    chatbotId = chatbot.id;

    const now = new Date();
    const created = await thread.createHandoff({
      chatbotId,
      groupId: 'group-1',
      sessionId: `sess-${randomUUID()}`,
      sessionRef: randomUUID(),
      channelType: 'WEB',
      assignedUserId: 'agent-1',
      assignedUserName: '상담원',
      startedById: 'agent-1',
      startedByName: '상담원',
      alertLevelAtStart: 'NORMAL',
      consecutiveUnansweredAtStart: 0,
      connectNotice: '상담원이 연결되었어요.',
      now,
      dayBucket: '2026-01-01',
    });
    handoffSessionId = created.id;
    await thread.appendUserMessage({
      handoffSessionId,
      chatbotId,
      rawInput: '010-1111-2222로 연락주세요',
      conversationLogId: null,
      now,
      rawTextMaxAgeMs: 60 * 60_000,
    });

    const rows = await prisma.handoffMessage.findMany({ where: { handoffSessionId } });
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.text.startsWith('enc:v1:k1:')).toBe(true);
      if (row.rawText) expect(row.rawText.startsWith('enc:v1:k1:')).toBe(true);
    }
  });

  it('2단계 — k1을 재암호화 완료 전에 제거하면 기동(부트스트랩)이 실패한다(§5.3 키 사용 행 검사)', async () => {
    const { resetKeyProvidersForTest } = await import('../common/crypto/env-key.provider');
    const { GovernanceBootstrapService } = await import('../governance/bootstrap/governance-bootstrap.service');
    const bootstrap = moduleRef.get(GovernanceBootstrapService);

    resetKeyProvidersForTest();
    process.env.DATA_ENCRYPTION_KEYS = `k2:${k2}`; // k1 제거 — 아직 k1로 암호화된 행이 남아 있다.

    await expect(bootstrap.onModuleInit()).rejects.toThrow(/k1/);

    // 원상 복구(다음 단계를 위해 k1을 다시 넣는다) — 아직 재암호화 전이므로 정상 기동해야 한다.
    resetKeyProvidersForTest();
    process.env.DATA_ENCRYPTION_KEYS = `k1:${k1}`;
    await expect(bootstrap.onModuleInit()).resolves.toBeUndefined();
  });

  it('3단계 — k2를 앞에 추가(쓰기 키 전환)하면 새 부트스트랩은 성공하고, FieldCryptoJob.tick()이 기존 행을 k2로 재암호화한다', async () => {
    const { resetKeyProvidersForTest, fieldKeyProvider } = await import('../common/crypto/env-key.provider');
    const { GovernanceBootstrapService } = await import('../governance/bootstrap/governance-bootstrap.service');
    const { FieldCryptoJob } = await import('../governance/jobs/field-crypto.job');
    const bootstrap = moduleRef.get(GovernanceBootstrapService);
    const fieldCryptoJob = moduleRef.get(FieldCryptoJob);

    resetKeyProvidersForTest();
    process.env.DATA_ENCRYPTION_KEYS = `k2:${k2},k1:${k1}`; // k2 = 새 쓰기 키, k1 = 읽기 전용 유지.
    await expect(bootstrap.onModuleInit()).resolves.toBeUndefined();
    expect(fieldKeyProvider().writeKeyId()).toBe('k2');

    // 기존 행은 여전히 k1로 개봉 가능해야 한다(읽기 겸용).
    const { openField } = await import('../common/crypto/field-crypto');
    const beforeRows = await prisma.handoffMessage.findMany({ where: { handoffSessionId } });
    for (const row of beforeRows) {
      expect(openField('HANDOFF_TEXT', row.id, row.text)).not.toBe('[복호화 실패]');
    }

    await fieldCryptoJob.tick();
    await fieldCryptoJob.tick(); // 커서 소진 확인 겸 2회(멱등 — 이미 k2인 행은 다시 건드리지 않는다).

    const afterRows = await prisma.handoffMessage.findMany({ where: { handoffSessionId } });
    expect(afterRows.length).toBeGreaterThan(0);
    for (const row of afterRows) {
      expect(row.text.startsWith('enc:v1:k2:')).toBe(true);
      if (row.rawText) expect(row.rawText.startsWith('enc:v1:k2:')).toBe(true);
    }
  }, 30_000);

  it('4단계 — 재암호화가 끝난 뒤 k1을 제거하고 재기동하면 성공한다', async () => {
    const { resetKeyProvidersForTest, fieldKeyProvider } = await import('../common/crypto/env-key.provider');
    const { GovernanceBootstrapService } = await import('../governance/bootstrap/governance-bootstrap.service');
    const bootstrap = moduleRef.get(GovernanceBootstrapService);

    resetKeyProvidersForTest();
    process.env.DATA_ENCRYPTION_KEYS = `k2:${k2}`; // k1 완전히 제거.

    await expect(bootstrap.onModuleInit()).resolves.toBeUndefined();
    expect(fieldKeyProvider().keyIds()).toEqual(['k2']);
  });

  it('FieldCryptoJob — 데이터 지도 encryption.fields에 필드별 키 사용 통계가 채워진다(§7.6)', async () => {
    const { FieldCryptoJob } = await import('../governance/jobs/field-crypto.job');
    const fieldCryptoJob = moduleRef.get(FieldCryptoJob);
    await fieldCryptoJob.tick(); // 패스 완료 → 통계 계산.

    const { GovernanceMapService } = await import('../governance/governance-map.service');
    const mapService = moduleRef.get(GovernanceMapService);
    const map = await mapService.build();

    const handoffTextStats = map.encryption.fields.find((f) => f.field === 'HANDOFF_TEXT');
    expect(handoffTextStats).toBeDefined();
    expect(handoffTextStats!.byKey.k2).toBeGreaterThan(0);
    expect(handoffTextStats!.plaintextRows).toBe(0);
    expect(map.encryption.statsComputedAt).not.toBeNull();
  }, 30_000);
});
