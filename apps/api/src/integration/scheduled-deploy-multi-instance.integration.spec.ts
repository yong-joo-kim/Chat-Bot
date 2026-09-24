import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import * as http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { VersioningType } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { AllExceptionsFilter } from '../common/all-exceptions.filter';
import { PrismaService } from '../prisma/prisma.service';
import { CLOCK } from '../common/polling/clock';
import type { Clock } from '../common/polling/clock';
import { DeploySchedulesEngine } from '../deploy-schedules/engine/deploy-schedule.engine';
import { loginAs, seedTestUsers } from './helpers/auth.helper';

const API_ROOT = join(__dirname, '..', '..');

async function safeCleanupTmpDir(dir: string): Promise<void> {
  await new Promise((r) => setTimeout(r, 300));
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch {
    // 정리 실패는 테스트 판정에 영향 없음.
  }
}

interface ApiResponse<T = unknown> {
  status: number;
  headers: http.IncomingHttpHeaders;
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
        headers: {
          ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
          ...headers,
        },
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
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body: parsed as T });
        });
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

class FakeClock implements Clock {
  private current: Date;
  constructor(initial: Date) {
    this.current = initial;
  }
  now(): Date {
    return this.current;
  }
  set(d: Date): void {
    this.current = d;
  }
}

/**
 * 운영 예약 배포(No.28) 다중 인스턴스 통합 테스트 — AC-D2-1(요구사항 §12 필수 6종 중 하나,
 * `scheduled-deploy-설계.md` §7.10 "다중 인스턴스 시험" 지침대로 같은 SQLite 파일에 Nest 앱 2개를
 * 띄우고 `Promise.all([a.tick(), b.tick()])`로 동시 tick을 재현한다). 단일 앱 하네스
 * (`scheduled-deploy.integration.spec.ts`)와 분리한 이유는 앱 인스턴스 2개를 동시에 띄우고 종료
 * 순서를 관리해야 해서다.
 */
describe('운영 예약 배포(No.28) 다중 인스턴스 통합 테스트 — AC-D2-1', () => {
  let app1: NestExpressApplication;
  let app2: NestExpressApplication;
  let baseUrl1: string;
  let tmpDir: string;
  let prisma1: PrismaService;
  let clock1: FakeClock;
  let clock2: FakeClock;
  let engine1: DeploySchedulesEngine;
  let engine2: DeploySchedulesEngine;
  let editorCookie = '';

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'scheduled-deploy-multi-'));
    const dbPath = join(tmpDir, 'test.db').replace(/\\/g, '/');
    const testDatabaseUrl = `file:${dbPath}`;

    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.DEPLOY_SCHEDULE_ENABLED = 'false'; // 두 인스턴스 다 폴링 타이머 없이 수동 tick만 쓴다
    process.env.WIDGET_BASE_URL = process.env.WIDGET_BASE_URL ?? 'http://localhost:5174';
    process.env.PUBLIC_API_BASE_URL = process.env.PUBLIC_API_BASE_URL ?? 'http://localhost:3000/api/v1';
    delete process.env.EMBEDDING_BASE_URL;

    try {
      execSync('pnpm exec prisma migrate deploy', {
        cwd: API_ROOT,
        env: { ...process.env, DATABASE_URL: testDatabaseUrl },
        stdio: 'pipe',
      });
    } catch (e) {
      const err = e as { stdout?: Buffer; stderr?: Buffer };
      throw new Error(`prisma migrate deploy 실패:\n${err.stdout?.toString()}\n${err.stderr?.toString()}`);
    }

    const { AppModule } = await import('../app.module');

    // 인스턴스 1 — HTTP로 챗봇·버전·예약을 만드는 데 쓴다(실제 관리자 요청 경로 그대로).
    clock1 = new FakeClock(new Date());
    const moduleRef1 = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(CLOCK).useValue(clock1).compile();
    app1 = moduleRef1.createNestApplication<NestExpressApplication>();
    app1.enableCors();
    app1.setGlobalPrefix('api');
    app1.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app1.useGlobalFilters(new AllExceptionsFilter());
    prisma1 = moduleRef1.get(PrismaService);
    engine1 = moduleRef1.get(DeploySchedulesEngine);

    await app1.listen(0);
    const server1 = app1.getHttpServer() as http.Server;
    const address1 = server1.address();
    const port1 = typeof address1 === 'object' && address1 !== null ? address1.port : 0;
    baseUrl1 = `http://127.0.0.1:${port1}/api/v1`;

    await seedTestUsers(prisma1);
    editorCookie = await loginAs(baseUrl1, 'EDITOR');

    // 인스턴스 2 — 같은 DATABASE_URL을 보는 완전히 별도의 DI 컨테이너(= "다른 프로세스" 시뮬레이션).
    // HTTP 포트를 열 필요는 없다 — 엔진(`tick()`)만 직접 호출한다.
    clock2 = new FakeClock(new Date());
    const moduleRef2 = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(CLOCK).useValue(clock2).compile();
    app2 = moduleRef2.createNestApplication<NestExpressApplication>();
    await app2.init();
    engine2 = moduleRef2.get(DeploySchedulesEngine);
  }, 90_000);

  afterAll(async () => {
    await app1?.close();
    await app2?.close().catch(() => undefined);
    await safeCleanupTmpDir(tmpDir);
  }, 20_000);

  function editor<T = unknown>(method: string, path: string, body?: unknown): Promise<ApiResponse<T>> {
    return jsonRequest(method, `${baseUrl1}${path}`, body, { Cookie: editorCookie });
  }

  it('AC-D2-1: 같은 예약에 두 인스턴스가 동시에 tick을 돌려도 정확히 1회만 실행되고 BEFORE_RESTORE 백업도 1건이다(CAS 선점)', async () => {
    const groupRes = await editor<{ id: string }>('POST', '/chatbot-groups', { name: '다중인스턴스 그룹' });
    const suffix = Math.random().toString(36).slice(2, 10);
    const chatbotRes = await editor<{ id: string }>('POST', '/chatbots', { groupId: groupRes.body.id, name: `다중인스턴스-${suffix}`, slug: `mi-${suffix}` });
    const chatbotId = chatbotRes.body.id;

    const intentRes = await editor<{ intent: { id: string } }>('POST', `/chatbots/${chatbotId}/intents`, { name: '기준의도', examples: [] });
    expect(intentRes.status).toBe(201);

    const versionRes = await editor<{ version: { id: string } }>('POST', `/chatbots/${chatbotId}/versions`, { label: '기준' });
    expect(versionRes.status).toBe(201);
    const baseVersionId = versionRes.body.version.id;

    // 현재 상태를 대상과 달라지게 해 복원이 "의미 있는" 실행이 되게 한다.
    const secondIntentRes = await editor('POST', `/chatbots/${chatbotId}/intents`, { name: '추가의도', examples: [] });
    expect(secondIntentRes.status).toBe(201);

    const scheduledAt = new Date(clock1.now().getTime() + 10 * 60_000);
    const previewRes = await editor<{ restore: { base: { contentHash: string } } }>('POST', `/chatbots/${chatbotId}/deploy-schedules/preview`, {
      action: 'RESTORE_VERSION',
      versionId: baseVersionId,
      scheduledAt: scheduledAt.toISOString(),
    });
    expect(previewRes.status).toBe(200);

    const createRes = await editor<{ schedule: { id: string } }>('POST', `/chatbots/${chatbotId}/deploy-schedules`, {
      action: 'RESTORE_VERSION',
      versionId: baseVersionId,
      previewedContentHash: previewRes.body.restore.base.contentHash,
      scheduledAt: scheduledAt.toISOString(),
    });
    expect(createRes.status).toBe(201);
    const scheduleId = createRes.body.schedule.id;

    // 두 인스턴스의 시계를 정확히 같은(도래한) 시각으로 맞추고 동시에 tick을 돌린다.
    const dueAt = new Date(scheduledAt.getTime() + 5_000);
    clock1.set(dueAt);
    clock2.set(dueAt);

    await Promise.all([engine1.tick(), engine2.tick()]);

    const row = await prisma1.deploySchedule.findUnique({ where: { id: scheduleId } });
    expect(row?.status).toBe('SUCCEEDED');
    expect(row?.outcome).toBe('APPLIED');
    expect(row?.attemptCount).toBe(1); // 정확히 1회만 선점·실행됐다(두 번 실행되면 2가 된다)

    const backups = await prisma1.chatbotVersion.findMany({ where: { chatbotId, trigger: 'BEFORE_RESTORE' } });
    expect(backups).toHaveLength(1);

    // 복원이 실제로 딱 1번 적용됐다는 행위 기반 증거 — 두 번 적용됐어도 최종 상태는 같아 보일 수
    // 있으므로(멱등) 감사 로그 RESTORE 레코드 건수로 "정확히 1회 실행"을 교차 확인한다.
    const restoreLogs = await prisma1.auditLog.findMany({ where: { chatbotId, action: 'RESTORE' } });
    expect(restoreLogs).toHaveLength(1);
  }, 30_000);

  it('AC-D2-1 보조: 선점에 실패한 인스턴스는 같은 예약을 건너뛴다(부분 유니크②·CAS의 관측 가능한 효과)', async () => {
    // 위 테스트가 "결과가 1회"임을 증명했다면, 이 테스트는 "왜 1회인가"의 메커니즘(선점 실패 시
    // 조용히 건너뜀 — 에러가 아님)을 반대 순서로 재확인한다: 인스턴스 1이 먼저 선점하게 하고
    // (tick을 순차 호출), 인스턴스 2가 뒤늦게 같은 예약을 tick해도 예외 없이 정상 반환하는지 본다.
    const groupRes = await editor<{ id: string }>('POST', '/chatbot-groups', { name: '다중인스턴스 그룹2' });
    const suffix = Math.random().toString(36).slice(2, 10);
    const chatbotRes = await editor<{ id: string }>('POST', '/chatbots', { groupId: groupRes.body.id, name: `다중인스턴스2-${suffix}`, slug: `mi2-${suffix}` });
    const chatbotId = chatbotRes.body.id;


    const scheduledAt = new Date(clock1.now().getTime() + 10 * 60_000);
    const createRes = await editor<{ schedule: { id: string } }>('POST', `/chatbots/${chatbotId}/deploy-schedules`, {
      action: 'SET_WEB_CHANNEL',
      enabled: true,
      scheduledAt: scheduledAt.toISOString(),
    });
    expect(createRes.status).toBe(201);
    const scheduleId = createRes.body.schedule.id;

    const dueAt = new Date(scheduledAt.getTime() + 5_000);
    clock1.set(dueAt);
    clock2.set(dueAt);

    await engine1.tick(); // 인스턴스 1이 먼저 선점·완료
    const afterFirst = await prisma1.deploySchedule.findUnique({ where: { id: scheduleId } });
    expect(afterFirst?.status).toBe('SUCCEEDED');

    await expect(engine2.tick()).resolves.toBeUndefined(); // 이미 종결된 예약 — 예외 없이 조용히 지나간다

    const afterSecond = await prisma1.deploySchedule.findUnique({ where: { id: scheduleId } });
    expect(afterSecond?.status).toBe('SUCCEEDED');
    expect(afterSecond?.finishedAt?.getTime()).toBe(afterFirst?.finishedAt?.getTime()); // 재실행되지 않았다
  }, 30_000);
});
