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
import { loginAs, seedTestUsers } from './helpers/auth.helper';

/**
 * 데이터 거버넌스(No.45) 통합 시험 — `docs/02-spec/data-governance-설계.md` §21.
 * `DATA_GOVERNANCE_MODE`·`DATA_ENCRYPTION_ENABLED`는 선택 기능이라 **동적 import**로 앱을 띄운다
 * (CLAUDE.md 규약 — `ConfigModule.forRoot({validate})` 스냅샷은 최초 import 시점에 고정된다).
 */

const API_ROOT = join(__dirname, '..', '..');

async function safeCleanupTmpDir(dir: string): Promise<void> {
  await new Promise((r) => setTimeout(r, 300));
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch {
    // 정리 실패는 판정에 영향 없음(Windows 파일 핸들 지연 해제).
  }
}

interface ApiResponse<T = unknown> {
  status: number;
  body: T;
}

function jsonRequest<T = unknown>(method: string, url: string, body?: unknown, headers: Record<string, string> = {}): Promise<ApiResponse<T>> {
  return new Promise((resolve, reject) => {
    const payload = body !== undefined ? JSON.stringify(body) : undefined;
    const { hostname, port, pathname, search } = new URL(url);
    const req = http.request(
      {
        method,
        hostname,
        port,
        path: pathname + search,
        headers: { ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}), ...headers },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          let parsed: unknown;
          try {
            parsed = data ? JSON.parse(data) : undefined;
          } catch {
            parsed = data;
          }
          resolve({ status: res.statusCode ?? 0, body: parsed as T });
        });
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

describe('데이터 거버넌스(No.45) 통합 시험 — 모드 ON(암호화·출구·보존·체인)', () => {
  let app: NestExpressApplication | undefined;
  let tmpDir: string;
  let prisma: PrismaService;
  let baseUrl: string;
  let adminCookie: string;
  let editorCookie: string;
  const writeKey = randomBytes(32).toString('base64');

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'data-governance-test-'));
    const dbPath = join(tmpDir, 'test.db').replace(/\\/g, '/');
    const testDatabaseUrl = `file:${dbPath}`;

    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.DEPLOY_SCHEDULE_ENABLED = 'false';
    process.env.HANDOFF_SWEEPER_ENABLED = 'false';
    process.env.WIDGET_BASE_URL = process.env.WIDGET_BASE_URL ?? 'http://localhost:5174';
    process.env.PUBLIC_API_BASE_URL = process.env.PUBLIC_API_BASE_URL ?? 'http://localhost:3000/api/v1';
    process.env.EMBEDDING_BASE_URL = '';
    process.env.RAG_BASE_URL = '';

    // 데이터 거버넌스 모드 ON — 필드 암호화 켬(키 1개) · 출구 허용 목록은 비워 둔다(레거시 연결 차단 시험용).
    process.env.DATA_GOVERNANCE_MODE = 'ON';
    process.env.DATA_ENCRYPTION_ENABLED = 'true';
    process.env.DATA_ENCRYPTION_KEYS = `k1:${writeKey}`;
    process.env.DATA_EGRESS_ALLOWED_HOSTS = '';
    process.env.DATA_RETENTION_JOB_ENABLED = 'false';
    process.env.DATA_REENCRYPT_JOB_ENABLED = 'false';
    process.env.RETENTION_MIN_DAYS_CONVERSATION = '1';
    process.env.DATA_RETENTION_WINDOW = '00:00-00:00'; // 항상 창 안(24시간)

    try {
      execSync('pnpm exec prisma migrate deploy', { cwd: API_ROOT, env: { ...process.env, DATABASE_URL: testDatabaseUrl }, stdio: 'pipe' });
    } catch (e) {
      const err = e as { stdout?: Buffer; stderr?: Buffer };
      throw new Error(`prisma migrate deploy 실패:\n${err.stdout?.toString()}\n${err.stderr?.toString()}`);
    }

    const { AppModule } = await import('../app.module');
    const { PrismaService: PrismaServiceClass } = await import('../prisma/prisma.service');

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    app.enableCors();
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalFilters(new AllExceptionsFilter());
    prisma = moduleRef.get(PrismaServiceClass);

    await app.listen(0);
    const server = app.getHttpServer() as http.Server;
    const address = server.address();
    const port = typeof address === 'object' && address !== null ? address.port : 0;
    baseUrl = `http://127.0.0.1:${port}/api/v1`;

    await seedTestUsers(prisma);
    adminCookie = await loginAs(baseUrl, 'ADMIN');
    editorCookie = await loginAs(baseUrl, 'EDITOR');

    (globalThis as Record<string, unknown>).__dgModuleRef = moduleRef;
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await safeCleanupTmpDir(tmpDir);
  }, 30_000);

  async function seedChatbot(): Promise<string> {
    const group = await prisma.chatbotGroup.create({ data: { name: `그룹-${randomUUID().slice(0, 8)}` } });
    const chatbot = await prisma.chatbot.create({
      data: { groupId: group.id, name: '거버넌스 시험 챗봇', slug: `gov-${randomUUID().slice(0, 8)}` },
    });
    return chatbot.id;
  }

  it('AC-DG1-2: 기동 성공 후 GET /governance/map이 모드 ON을 보여준다(security:read)', async () => {
    const res = await jsonRequest<{ mode: string; encryption: { enabled: boolean } }>('GET', `${baseUrl}/governance/map`, undefined, { Cookie: adminCookie });
    expect(res.status).toBe(200);
    expect(res.body.mode).toBe('ON');
    expect(res.body.encryption.enabled).toBe(true);
  });

  it('AC-DG8-1: EDITOR가 데이터 지도를 조회하면 403이다(security:read 없음)', async () => {
    const res = await jsonRequest('GET', `${baseUrl}/governance/map`, undefined, { Cookie: editorCookie });
    expect(res.status).toBe(403);
  });

  it('AC-DG3-1: 상담 메시지를 적재하면 DB 원시값이 enc:v1: 봉투이고, 대화 보기 응답은 평문 그대로다', async () => {
    const { HandoffThreadService } = await import('../handoff/handoff-thread.service');
    const moduleRef = (globalThis as Record<string, unknown>).__dgModuleRef as import('@nestjs/testing').TestingModule;
    const thread = moduleRef.get(HandoffThreadService);

    const chatbotId = await seedChatbot();
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

    const plaintext = '안녕하세요 010-1234-5678로 연락주세요';
    const result = await thread.appendUserMessage({
      handoffSessionId: created.id,
      chatbotId,
      rawInput: plaintext,
      conversationLogId: null,
      now,
      rawTextMaxAgeMs: 60 * 60_000,
    });

    const rawRow = await prisma.handoffMessage.findFirst({ where: { handoffSessionId: created.id, seq: result.seq } });
    expect(rawRow).not.toBeNull();
    expect(rawRow!.text.startsWith('enc:v1:k1:')).toBe(true);
    expect(rawRow!.text.includes('연결되었어요') || rawRow!.text.includes(result.maskedText)).toBe(false);
    if (rawRow!.rawText) {
      expect(rawRow!.rawText.startsWith('enc:v1:k1:')).toBe(true);
    }

    // 읽기 경로(openField)로 개봉하면 저장 전과 같은 마스킹본이 나온다(AC-DG3-1).
    const { openField } = await import('../common/crypto/field-crypto');
    const opened = openField('HANDOFF_TEXT', rawRow!.id, rawRow!.text);
    expect(opened).toBe(result.maskedText);
  });

  it('AC-DG2-3: 출구 허용 목록 밖 호스트로 레거시 연결을 저장하면 400 EGRESS_HOST_NOT_ALLOWED다', async () => {
    const res = await jsonRequest<{ code: string }>(
      'POST',
      `${baseUrl}/api-connections`,
      { name: `차단연결-${randomUUID().slice(0, 6)}`, baseUrl: 'https://blocked.example.com', allowedMethods: ['GET'] },
      { Cookie: adminCookie },
    );
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('EGRESS_HOST_NOT_ALLOWED');
  });

  it('AC-DG5-1/2: 파기 잡 tick() — 대화 로그 텍스트가 소거되고 수치는 불변이며 질문 순위에서 제외된다', async () => {
    const { RetentionJob } = await import('../governance/jobs/retention.job');
    const moduleRef = (globalThis as Record<string, unknown>).__dgModuleRef as import('@nestjs/testing').TestingModule;
    const retentionJob = moduleRef.get(RetentionJob);

    const chatbotId = await seedChatbot();
    const oldDate = new Date(Date.now() - 30 * 86_400_000);
    const log = await prisma.conversationLog.create({
      data: {
        chatbotId,
        channelType: 'WEB',
        sessionId: 'sess-old',
        userMessage: '오래된 질문입니다',
        botResponse: '오래된 답변입니다',
        isAnswered: true,
        dayBucket: '2025-01-01',
        hourBucket: 10,
        createdAt: oldDate,
      },
    });

    // 전역 보존 정책: 대화 원문 1일(환경변수 하한도 1일로 낮춰둠) — 유예 없이 바로 적용되도록 즉시 days에 반영.
    await prisma.retentionPolicy.upsert({
      where: { scopeKey: 'GLOBAL' },
      create: { scopeKey: 'GLOBAL', days: JSON.stringify({ CONVERSATION_TEXT: 1 }), pending: '{}' },
      update: { days: JSON.stringify({ CONVERSATION_TEXT: 1 }), pending: '{}' },
    });

    await retentionJob.tick();

    const purged = await prisma.conversationLog.findUnique({ where: { id: log.id } });
    expect(purged).not.toBeNull();
    expect(purged!.userMessage).toBe('');
    expect(purged!.botResponse).toBe('');
    expect(purged!.textPurgedAt).not.toBeNull();
    // 행·수치·dayBucket은 불변(AC-DG5-1).
    expect(purged!.dayBucket).toBe('2025-01-01');
    expect(purged!.isAnswered).toBe(true);
    expect(purged!.sessionId).toBe('sess-old');

    const runs = await prisma.retentionRun.findMany({ where: { kind: 'PURGE' } });
    expect(runs.length).toBeGreaterThan(0);
  }, 30_000);

  it('AC-DG5-4: 진행 중 목록 — 마지막 발화가 소거된 로그면 lastUserTextPurged=true, 소거되지 않았으면 키 자체가 없다(ui-spec §3.7)', async () => {
    const chatbotId = await seedChatbot();
    const now = new Date();

    await prisma.conversationLog.create({
      data: {
        chatbotId,
        channelType: 'WEB',
        sessionId: 'sess-live-purged',
        userMessage: '',
        botResponse: '',
        isAnswered: true,
        dayBucket: '2026-01-01',
        hourBucket: 10,
        createdAt: now,
        textPurgedAt: now,
      },
    });
    await prisma.conversationLog.create({
      data: {
        chatbotId,
        channelType: 'WEB',
        sessionId: 'sess-live-normal',
        userMessage: '안녕하세요',
        botResponse: '반갑습니다',
        isAnswered: true,
        dayBucket: '2026-01-01',
        hourBucket: 10,
        createdAt: now,
      },
    });

    const res = await jsonRequest<{ items: Array<{ lastUserText: string; lastUserTextPurged?: true }> }>(
      'GET',
      `${baseUrl}/chatbots/${chatbotId}/live-sessions`,
      undefined,
      { Cookie: adminCookie },
    );
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBe(2);

    const purgedItem = res.body.items.find((i) => i.lastUserText === '');
    const normalItem = res.body.items.find((i) => i.lastUserText === '안녕하세요');
    expect(purgedItem).toBeDefined();
    expect(purgedItem!.lastUserTextPurged).toBe(true);
    expect(normalItem).toBeDefined();
    // 모드 OFF와 응답 바이트가 같아야 한다 — 소거되지 않은 행은 키 자체가 없어야 한다(optional 직렬화).
    expect('lastUserTextPurged' in normalItem!).toBe(false);
  });

  it('AC-DG6-1: 감사 체인 검증 — 정상은 OK, DB 직접 변조는 HASH_MISMATCH다', async () => {
    const { AuditChainVerifier } = await import('../audit-logs/chain/audit-chain-verifier.service');
    const moduleRef = (globalThis as Record<string, unknown>).__dgModuleRef as import('@nestjs/testing').TestingModule;
    const verifier = moduleRef.get(AuditChainVerifier);

    const okResult = await verifier.verify(undefined, undefined, new Date());
    expect(['OK', 'EMPTY']).toContain(okResult.status);

    const anyChainRow = await prisma.auditLog.findFirst({ where: { seq: { not: null } }, orderBy: { seq: 'asc' } });
    if (anyChainRow) {
      await prisma.auditLog.update({ where: { id: anyChainRow.id }, data: { summary: '변조된 요약' } });
      const tamperedResult = await verifier.verify(undefined, undefined, new Date());
      expect(tamperedResult.status).toBe('HASH_MISMATCH');
      expect(tamperedResult.firstBadSeq).toBe(anyChainRow.seq);
    }
  });
});
