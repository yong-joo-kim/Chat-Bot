import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import * as http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { VersioningType } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { AppModule as AppModuleType } from '../app.module';
import { Test } from '@nestjs/testing';
import { AllExceptionsFilter } from '../common/all-exceptions.filter';
import { PrismaService } from '../prisma/prisma.service';
import { loginAs, seedTestUsers } from './helpers/auth.helper';
import { CLOCK } from '../common/polling/clock';
import type { Clock } from '../common/polling/clock';
import { WorkflowDispatchJob } from '../workflow/dispatch/workflow-dispatch.job';

/**
 * 업무 자동화 워크플로우(No.41) — 보류 만료(§7.6)·실패 본문 소거(§7.8)를 **설정값이 기본(24h·7일)이
 * 아닐 때**(코드 리뷰 R1 H-2 — `WORKFLOW_HOLD_MAX_HOURS` 하드코딩 수정) 검증한다. `WORKFLOW_HOLD_MAX_HOURS`·
 * `WORKFLOW_FAILED_PAYLOAD_RETENTION_DAYS`는 선택 env라 `AppModule`을 동적 import한다(CLAUDE.md).
 * 시각은 전부 `FakeClock`의 상대 오프셋으로 만든다(절대 날짜 리터럴 금지 — §21.2).
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
      { method, hostname, port, path: pathname + search, headers: { ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}), ...headers } },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
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

class FakeClock implements Clock {
  private offsetMs = 0;
  now(): Date {
    return new Date(Date.now() + this.offsetMs);
  }
  advance(ms: number): void {
    this.offsetMs += ms;
  }
}

describe('업무 자동화 워크플로우(No.41) 통합 시험 — 보류 만료·실패 본문 소거(설정값 커스텀, 코드 리뷰 R1 H-2)', () => {
  let app: NestExpressApplication;
  let baseUrl: string;
  let tmpDir: string;
  let prisma: PrismaService;
  let dispatchJob: WorkflowDispatchJob;
  const clock = new FakeClock();
  let adminCookie = '';

  const HOLD_MAX_HOURS = 12; // 기본값(24)이 아닌 값으로 하드코딩 회귀를 잡는다.
  const RETENTION_DAYS = 3; // 기본값(7)이 아닌 값.

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'workflow-hold-expiry-test-'));
    const dbPath = join(tmpDir, 'test.db').replace(/\\/g, '/');
    const testDatabaseUrl = `file:${dbPath}`;

    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.DEPLOY_SCHEDULE_ENABLED = 'false';
    process.env.HANDOFF_SWEEPER_ENABLED = 'false';
    process.env.WIDGET_BASE_URL = process.env.WIDGET_BASE_URL ?? 'http://localhost:5174';
    process.env.PUBLIC_API_BASE_URL = process.env.PUBLIC_API_BASE_URL ?? 'http://localhost:3000/api/v1';
    process.env.EMBEDDING_BASE_URL = '';
    process.env.RAG_BASE_URL = '';

    process.env.WORKFLOW_ENABLED = 'true';
    process.env.WORKFLOW_DISPATCH_ENABLED = 'false'; // 시험은 tick()을 직접 호출한다.
    process.env.WORKFLOW_HOLD_MAX_HOURS = String(HOLD_MAX_HOURS);
    process.env.WORKFLOW_FAILED_PAYLOAD_RETENTION_DAYS = String(RETENTION_DAYS);

    try {
      execSync('pnpm exec prisma migrate deploy', { cwd: API_ROOT, env: { ...process.env, DATABASE_URL: testDatabaseUrl }, stdio: 'pipe' });
    } catch (e) {
      const err = e as { stdout?: Buffer; stderr?: Buffer };
      throw new Error(`prisma migrate deploy 실패:\n${err.stdout?.toString()}\n${err.stderr?.toString()}`);
    }

    const { AppModule } = (await import('../app.module')) as { AppModule: typeof AppModuleType };
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(CLOCK).useValue(clock).compile();

    app = moduleRef.createNestApplication<NestExpressApplication>();
    app.enableCors();
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalFilters(new AllExceptionsFilter());
    prisma = moduleRef.get(PrismaService);
    dispatchJob = moduleRef.get(WorkflowDispatchJob);

    await app.listen(0);
    const server = app.getHttpServer() as http.Server;
    const address = server.address();
    const port = typeof address === 'object' && address !== null ? address.port : 0;
    baseUrl = `http://127.0.0.1:${port}/api/v1`;

    await seedTestUsers(prisma);
    adminCookie = await loginAs(baseUrl, 'ADMIN');
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await safeCleanupTmpDir(tmpDir);
  }, 15_000);

  function admin<T = unknown>(method: string, path: string, body?: unknown): Promise<ApiResponse<T>> {
    return jsonRequest(method, `${baseUrl}${path}`, body, { Cookie: adminCookie });
  }

  /** 정리 단계는 12틱마다 1회다(§7.2 step⑦) — 대기 행이 없어도(§NFR-WFP4) 12번 호출해 트리거한다. */
  async function runMaintenanceCycle(): Promise<void> {
    for (let i = 0; i < 12; i += 1) await dispatchJob.tick();
  }

  it(`보류(HELD) 행은 설정된 ${HOLD_MAX_HOURS}시간(기본 24가 아님)이 지나야 EXPIRED로 정리된다`, async () => {
    const targetRes = await admin<{ id: string }>('POST', '/workflow-targets', { name: `보류만료대상-${randomUUID().slice(0, 8)}`, baseUrl: 'https://wf-hold-expiry.example.invalid/hook', signingEnabled: false });
    const targetId = targetRes.body.id;
    await admin('POST', `/workflow-targets/${targetId}/pause`); // 이후 적재는 HELD(TARGET).

    const heldId = randomUUID();
    const now = clock.now();
    await prisma.workflowRun.create({
      data: {
        id: heldId,
        targetId,
        targetName: '보류만료대상',
        chatbotId: null,
        triggerKind: 'TEST',
        eventType: 'TEST',
        status: 'HELD',
        holdReason: 'TARGET',
        heldAt: now,
        personalDataMasked: false,
        fieldNames: '[]',
        dayBucket: now.toISOString().slice(0, 10),
        createdAt: now,
      },
    });

    // 설정값(12h) 미만 경과 — 아직 만료되지 않는다.
    clock.advance((HOLD_MAX_HOURS - 1) * 3_600_000);
    await runMaintenanceCycle();
    const beforeExpiry = await prisma.workflowRun.findUnique({ where: { id: heldId } });
    expect(beforeExpiry?.status).toBe('HELD');

    // 설정값을 넘기면(12h + 1분) 만료된다 — 기본값 24h를 썼다면 이 시점에 아직 HELD였을 것이다.
    clock.advance(2 * 3_600_000);
    await runMaintenanceCycle();
    const afterExpiry = await prisma.workflowRun.findUnique({ where: { id: heldId } });
    expect(afterExpiry?.status).toBe('EXPIRED');
    expect(afterExpiry?.statusReason).toBe('HOLD_EXPIRED');
    expect(afterExpiry?.payload).toBeNull();
  });

  it(`대상 재개(resume) API도 같은 설정값(${HOLD_MAX_HOURS}h)으로 만료를 판정한다(§7.6 — 하드코딩 회귀 가드)`, async () => {
    const targetRes = await admin<{ id: string }>('POST', '/workflow-targets', { name: `재개만료대상-${randomUUID().slice(0, 8)}`, baseUrl: 'https://wf-resume-expiry.example.invalid/hook', signingEnabled: false });
    const targetId = targetRes.body.id;
    await admin('POST', `/workflow-targets/${targetId}/pause`);

    const heldId = randomUUID();
    // ★ 상대 시각 — `WorkflowTargetsService.resume()`은 주입된 `CLOCK`이 아니라 실제 `new Date()`를 쓴다
    // (§7.6 구현 — clock 미주입 지점). 그래서 여기서도 `clock.now()`가 아니라 실제 벽시계 기준으로
    // 설정값보다 더 지난 시점을 만든다(절대 날짜 리터럴은 아니다 — CLAUDE.md 상대 시각 원칙 준수).
    const staleCreatedAt = new Date(Date.now() - (HOLD_MAX_HOURS + 1) * 3_600_000);
    await prisma.workflowRun.create({
      data: {
        id: heldId,
        targetId,
        targetName: '재개만료대상',
        chatbotId: null,
        triggerKind: 'TEST',
        eventType: 'TEST',
        status: 'HELD',
        holdReason: 'TARGET',
        heldAt: staleCreatedAt,
        personalDataMasked: false,
        fieldNames: '[]',
        dayBucket: staleCreatedAt.toISOString().slice(0, 10),
        createdAt: staleCreatedAt,
      },
    });

    const resumeRes = await admin('POST', `/workflow-targets/${targetId}/resume`);
    expect([200, 201]).toContain(resumeRes.status);

    const row = await prisma.workflowRun.findUnique({ where: { id: heldId } });
    // 기본값(24h)이 하드코딩돼 있었다면 (holdMax+1h)만 지난 이 행은 여전히 HELD로 남았을 것이다.
    expect(row?.status).toBe('EXPIRED');
    expect(row?.statusReason).toBe('HOLD_EXPIRED');
  });

  it(`실패 본문은 설정된 보관 기간(${RETENTION_DAYS}일 — 기본 7일이 아님)이 지나야 소거된다`, async () => {
    const targetRes = await admin<{ id: string }>('POST', '/workflow-targets', { name: `본문소거대상-${randomUUID().slice(0, 8)}`, baseUrl: 'https://wf-purge.example.invalid/hook', signingEnabled: false });
    const targetId = targetRes.body.id;

    const runId = randomUUID();
    const completedAt = new Date(clock.now().getTime() - (RETENTION_DAYS * 24 + 1) * 3_600_000); // 보관기간 + 1시간 경과.
    await prisma.workflowRun.create({
      data: {
        id: runId,
        targetId,
        targetName: '본문소거대상',
        chatbotId: null,
        triggerKind: 'TEST',
        eventType: 'TEST',
        status: 'FAILED',
        statusReason: 'PERMANENT_ERROR',
        personalDataMasked: false,
        fieldNames: '[]',
        payload: '{"placeholder":true}',
        payloadBytes: 20,
        completedAt,
        dayBucket: completedAt.toISOString().slice(0, 10),
        createdAt: completedAt,
      },
    });

    await runMaintenanceCycle();
    const row = await prisma.workflowRun.findUnique({ where: { id: runId } });
    expect(row?.payload).toBeNull();
    expect(row?.payloadPurgedAt).not.toBeNull();
  });
});
