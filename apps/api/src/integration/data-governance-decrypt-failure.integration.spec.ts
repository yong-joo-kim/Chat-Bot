import { execSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import * as http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { VersioningType } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { normalizeEmail } from '@chat-bot/shared-types';
import { AllExceptionsFilter } from '../common/all-exceptions.filter';
import type { PrismaService } from '../prisma/prisma.service';
import { loginAs, seedTestUsers } from './helpers/auth.helper';

/**
 * 데이터 거버넌스(No.45) — 복호화 실패 표시·상담 rawText 생략·RAW_VIEW 미기록 통합 시험
 * (AC-DG3-2 · EX-DG-4/5 · `data-governance-설계.md` §7.5 · §7.8). 기존 통합 시험은 키 교체·정상
 * 왕복만 다루고, "복호화가 실패하는 행"을 대화 보기 API 종단까지 재현하지 않았다 — 이 파일이 채운다.
 *
 * `HandoffTranscriptService.getTranscript()`가 개봉 실패 시 하는 일(§7.5·§7.8 코드 인용):
 * - `text`(마스킹본)는 항상 `openField()`를 거친다 — 실패하면 `[복호화 실패]`가 그대로 응답에 실린다.
 * - `rawText`는 실패하면 **키 자체를 생략**한다(`[복호화 실패]`로 보여주지 않는다 — 원문 자리에
 *   실패 문구조차 노출하지 않는다는 설계 판단).
 * - `RAW_VIEW` 감사는 `rawText`가 응답에 실제로 실린 경우에만 기록된다 — 개봉 실패 시 0건이어야 한다.
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

interface TranscriptHandoffEntry {
  kind: 'HANDOFF';
  messageId: string;
  text: string;
  rawText?: string;
}

interface TranscriptResponseShape {
  entries: Array<TranscriptHandoffEntry | { kind: 'BOT_TURN' }>;
}

describe('데이터 거버넌스(No.45) 통합 시험 — 복호화 실패 표시·rawText 생략·RAW_VIEW 미기록(AC-DG3-2)', () => {
  let app: NestExpressApplication | undefined;
  let tmpDir: string;
  let prisma: PrismaService;
  let baseUrl: string;
  let adminCookie: string;
  let adminUserId: string;
  const writeKey = randomBytes(32).toString('base64');

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'data-governance-decrypt-fail-test-'));
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
    process.env.DATA_ENCRYPTION_KEYS = `k1:${writeKey}`;
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
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: normalizeEmail('integration-test-admin@chat-bot.local') } });
    adminUserId = admin.id;
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await safeCleanupTmpDir(tmpDir);
  }, 30_000);

  async function seedConnectedHandoff(): Promise<{ chatbotId: string; sessionRef: string; handoffSessionId: string }> {
    const group = await prisma.chatbotGroup.create({ data: { name: `그룹-복호화실패-${randomUUID().slice(0, 8)}` } });
    const chatbot = await prisma.chatbot.create({ data: { groupId: group.id, name: '복호화 실패 챗봇', slug: `decrypt-fail-${randomUUID().slice(0, 8)}` } });
    const now = new Date();
    const sessionRef = randomUUID().replace(/-/g, '').slice(0, 16);
    const handoff = await prisma.handoffSession.create({
      data: {
        chatbotId: chatbot.id,
        groupId: group.id,
        sessionId: `sess-${randomUUID()}`,
        sessionRef,
        channelType: 'WEB',
        status: 'CONNECTED',
        assignedUserId: adminUserId,
        assignedUserName: '관리자',
        startedById: adminUserId,
        startedByName: '관리자',
        alertLevelAtStart: 'NORMAL',
        consecutiveUnansweredAtStart: 0,
        startedAt: now,
        connectedAt: now,
        dayBucket: now.toISOString().slice(0, 10),
      },
    });
    return { chatbotId: chatbot.id, sessionRef, handoffSessionId: handoff.id };
  }

  it('AC-DG3-2/EX-DG-4: 알 수 없는 키 id(zz)로 봉인된 행은 text가 [복호화 실패]이고, rawText 키는 응답에서 생략되며, 요청은 200이고 RAW_VIEW가 기록되지 않는다', async () => {
    const { buildEnvelope, encryptWithKey } = await import('../common/crypto/field-envelope');
    const { buildFieldAad } = await import('../common/crypto/encrypted-fields');

    const { chatbotId, sessionRef, handoffSessionId } = await seedConnectedHandoff();
    const messageId = randomUUID();
    const bogusKeyBytes = randomBytes(32); // 키링에 없는 임의의 32바이트 — keyId 'zz'는 키링에 존재하지 않는다.
    const now = new Date();

    const corruptedText = buildEnvelope('zz', encryptWithKey(bogusKeyBytes, buildFieldAad('HANDOFF_TEXT', messageId), '평문이었을 마스킹본'));
    const corruptedRawText = buildEnvelope('zz', encryptWithKey(bogusKeyBytes, buildFieldAad('HANDOFF_RAW_TEXT', messageId), '평문이었을 원문'));

    await prisma.handoffMessage.create({
      data: {
        id: messageId,
        handoffSessionId,
        chatbotId,
        seq: 1,
        sender: 'USER',
        text: corruptedText,
        rawText: corruptedRawText,
        rawExpiresAt: new Date(now.getTime() + 60 * 60_000),
      },
    });

    const before = await prisma.auditLog.count({ where: { action: 'RAW_VIEW', targetType: 'HandoffSession', targetId: handoffSessionId } });
    expect(before).toBe(0);

    const res = await jsonRequest<TranscriptResponseShape>(
      'GET',
      `${baseUrl}/chatbots/${chatbotId}/live-sessions/${sessionRef}/transcript?includeRaw=true`,
      undefined,
      { Cookie: adminCookie },
    );
    expect(res.status).toBe(200); // 개봉 실패가 요청 자체를 실패시키지 않는다(FR-DG4-4).

    const entry = res.body.entries.find((e): e is TranscriptHandoffEntry => e.kind === 'HANDOFF' && e.messageId === messageId);
    expect(entry).toBeDefined();
    expect(entry!.text).toBe('[복호화 실패]');
    expect('rawText' in entry!).toBe(false); // 키 자체가 생략된다 — '[복호화 실패]' 문자열조차 원문 자리에 넣지 않는다.

    const after = await prisma.auditLog.count({ where: { action: 'RAW_VIEW', targetType: 'HandoffSession', targetId: handoffSessionId } });
    expect(after).toBe(0); // rawText가 응답에 실리지 않았으므로 RAW_VIEW 감사도 없다.
  });

  it('AC-DG3-2: 알려진 키(k1)이지만 태그가 손상된 행(다른 행에 복사해 붙이는 공격과 같은 실패 형태)도 [복호화 실패]다', async () => {
    const { buildEnvelope, encryptWithKey } = await import('../common/crypto/field-envelope');
    const { buildFieldAad } = await import('../common/crypto/encrypted-fields');
    const { fieldKeyProvider } = await import('../common/crypto/env-key.provider');

    const { chatbotId, sessionRef, handoffSessionId } = await seedConnectedHandoff();
    const messageId = randomUUID();
    const now = new Date();

    // k1으로 봉인하되 AAD를 다른 행 id로 잘못 계산해(=행이 바뀐 것과 동치) 태그 검증이 실패하게 만든다.
    const payload = encryptWithKey(randomBytes(32), buildFieldAad('HANDOFF_TEXT', 'other-row-id'), '다른 행이었을 값');
    const wrongAadText = buildEnvelope(fieldKeyProvider().writeKeyId() as string, payload);

    await prisma.handoffMessage.create({
      data: {
        id: messageId,
        handoffSessionId,
        chatbotId,
        seq: 1,
        sender: 'AGENT',
        text: wrongAadText,
        rawText: null,
      },
    });

    const res = await jsonRequest<TranscriptResponseShape>(
      'GET',
      `${baseUrl}/chatbots/${chatbotId}/live-sessions/${sessionRef}/transcript?includeRaw=true`,
      undefined,
      { Cookie: adminCookie },
    );
    expect(res.status).toBe(200);
    const entry = res.body.entries.find((e): e is TranscriptHandoffEntry => e.kind === 'HANDOFF' && e.messageId === messageId);
    expect(entry).toBeDefined();
    expect(entry!.text).toBe('[복호화 실패]');
  });
});
