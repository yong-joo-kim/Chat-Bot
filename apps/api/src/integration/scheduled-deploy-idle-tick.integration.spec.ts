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
import { DeploySchedulesEngine } from '../deploy-schedules/engine/deploy-schedule.engine';

const API_ROOT = join(__dirname, '..', '..');

async function safeCleanupTmpDir(dir: string): Promise<void> {
  await new Promise((r) => setTimeout(r, 300));
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch {
    // 정리 실패는 테스트 판정에 영향 없음.
  }
}

/**
 * 운영 예약 배포(No.28) 유휴 tick 쿼리 계측 — AC-D2-9(요구사항 §12 "다음 자동화 대상"·
 * `자동시험_전략.md` §8.7 항목 3). "예약이 전혀 없는 상태"가 전제라, 다른 테스트가 만든 PENDING/RUNNING
 * 행과 계속 흘러가는 공유 시계를 갖는 `scheduled-deploy.integration.spec.ts`와 같은 파일에 두면 실행
 * 순서에 따라 전제가 깨질 수 있다(다른 테스트가 남긴 미처리 행이 우연히 "도래"해 버리는 경우). 완전히
 * 비어 있는 전용 DB에 앱을 새로 띄워 격리한다(`scheduled-deploy-multi-instance.integration.spec.ts`와
 * 같은 이유로 별도 파일을 둔 선례를 따른다).
 */
describe('운영 예약 배포(No.28) 유휴 tick 쿼리 계측 — AC-D2-9', () => {
  let app: NestExpressApplication;
  let tmpDir: string;
  let prisma: PrismaService;
  let engine: DeploySchedulesEngine;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'scheduled-deploy-idle-tick-test-'));
    const dbPath = join(tmpDir, 'test.db').replace(/\\/g, '/');
    const testDatabaseUrl = `file:${dbPath}`;

    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.DEPLOY_SCHEDULE_ENABLED = 'false'; // 폴링 타이머 없이 수동 tick만 쓴다
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
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    app.enableCors();
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalFilters(new AllExceptionsFilter());
    prisma = moduleRef.get(PrismaService);
    engine = moduleRef.get(DeploySchedulesEngine);

    await app.listen(0);
    const server = app.getHttpServer() as http.Server;
    server.address(); // 포트 확보 확인(다른 그룹 선례와 동일한 부트스트랩 관용구, HTTP 호출은 이 파일에서 쓰지 않는다)
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await safeCleanupTmpDir(tmpDir);
  }, 15_000);

  it('AC-D2-9: 예약이 전혀 없는 상태에서 tick 1회는 deploySchedule.findMany을 정확히 1번만 호출한다(조회 1건, 인덱스 컬럼 조건)', async () => {
    // 갓 push된 빈 DB — DeploySchedule 행 자체가 0건임을 먼저 확인해 전제를 명시적으로 고정한다.
    expect(await prisma.deploySchedule.count()).toBe(0);

    const findManySpy = jest.spyOn(prisma.deploySchedule, 'findMany');
    findManySpy.mockClear();
    try {
      await engine.tick();

      // rows.length===0이면 engine.tick()이 즉시 반환한다(deploy-schedule.engine.ts:76-82) — HELD 조회
      // 등 후속 쿼리가 전혀 발생하지 않는다는 것이 "조회 1건"의 실제 근거다.
      expect(findManySpy).toHaveBeenCalledTimes(1);
      expect(findManySpy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: { in: ['PENDING', 'RUNNING'] }, scheduledAt: { lte: expect.any(Date) } },
          orderBy: { scheduledAt: 'asc' },
          take: 100,
        }),
      );
    } finally {
      findManySpy.mockRestore();
    }
  });

  it('두 번째 유휴 tick도 여전히 1건만 조회한다(반복 호출에도 누적/추가 쿼리가 붙지 않는다)', async () => {
    const findManySpy = jest.spyOn(prisma.deploySchedule, 'findMany');
    findManySpy.mockClear();
    try {
      await engine.tick();
      await engine.tick();
      expect(findManySpy).toHaveBeenCalledTimes(2); // tick 2회 = 호출 2회(회당 1건)이지 누적되지 않는다
    } finally {
      findManySpy.mockRestore();
    }
  });
});
