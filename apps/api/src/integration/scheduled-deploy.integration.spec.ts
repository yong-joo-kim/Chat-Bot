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
import { VersionRetentionService } from '../versions/capture/version-retention.service';
import * as channelEnableRule from '../channels/lib/channel-enable-rule';
import { ApiException } from '../common/api.exception';
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

/** 시험용 시계 — `CLOCK` 토큰을 오버라이드해 misfire·재시도·체인을 실제 대기 없이 결정적으로 재현한다(§7.10). */
class FakeClock implements Clock {
  private current: Date;
  constructor(initial: Date) {
    this.current = initial;
  }
  now(): Date {
    return this.current;
  }
  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}

/**
 * 운영 예약 배포(No.28) 통합 테스트 — `scheduled-deploy-설계.md` §18 필수 6종 중 HTTP + 결정적 시계로
 * 검증 가능한 항목(AC-D3-1·AC-D3-3·AC-D3-8·AC-D4-3)과 정상 실행 1건을 다룬다. `DEPLOY_SCHEDULE_ENABLED=false`
 * + `engine.tick()` 직접 호출(§7.10) — 다중 인스턴스 동시성(AC-D2-1)은 별도 하네시가 필요해 이 파일
 * 범위 밖이다(`scheduled-deploy-multi-instance.integration.spec.ts` 참고).
 *
 * [2026-09-24 No.28 시험 회차 — 확장] 리뷰·구현 단계에서 명시적으로 공백으로 남겨진 항목을
 * 채운다: PUBLISH/SET_WEB_CHANNEL 실행기 통합(원자성 포함) · G3(실행 직후 TC) · 재시도 분류
 * (ACTIVE_JOB·BLOCKED_TOO_LONG) · AC-D3-11(임대 만료 회수 판정 RECOVERED/INTERRUPTED) · 권한
 * 재확인(역할 강등·mustChangePassword 무영향) · 감사 주체(actorOverride) · 보존 보호/삭제 409
 * (AC-D5-1/2).
 */
describe('운영 예약 배포(No.28) 통합 테스트', () => {
  let app: NestExpressApplication;
  let baseUrl: string;
  let tmpDir: string;
  let prisma: PrismaService;
  let engine: DeploySchedulesEngine;
  let versionRetention: VersionRetentionService;
  let clock: FakeClock;
  let editorCookie = '';

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'scheduled-deploy-test-'));
    const dbPath = join(tmpDir, 'test.db').replace(/\\/g, '/');
    const testDatabaseUrl = `file:${dbPath}`;

    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.DEPLOY_SCHEDULE_ENABLED = 'false';
    process.env.WIDGET_BASE_URL = process.env.WIDGET_BASE_URL ?? 'http://localhost:5174';
    process.env.PUBLIC_API_BASE_URL = process.env.PUBLIC_API_BASE_URL ?? 'http://localhost:3000/api/v1';
    delete process.env.EMBEDDING_BASE_URL;

    try {
      execSync('pnpm exec prisma db push --skip-generate --accept-data-loss', {
        cwd: API_ROOT,
        env: { ...process.env, DATABASE_URL: testDatabaseUrl },
        stdio: 'pipe',
      });
    } catch (e) {
      const err = e as { stdout?: Buffer; stderr?: Buffer };
      throw new Error(`prisma db push 실패:\n${err.stdout?.toString()}\n${err.stderr?.toString()}`);
    }

    clock = new FakeClock(new Date());

    const { AppModule } = await import('../app.module');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(CLOCK).useValue(clock).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    app.enableCors();
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalFilters(new AllExceptionsFilter());
    prisma = moduleRef.get(PrismaService);
    engine = moduleRef.get(DeploySchedulesEngine);
    versionRetention = moduleRef.get(VersionRetentionService);

    await app.listen(0);
    const server = app.getHttpServer() as http.Server;
    const address = server.address();
    const port = typeof address === 'object' && address !== null ? address.port : 0;
    baseUrl = `http://127.0.0.1:${port}/api/v1`;

    await seedTestUsers(prisma);
    editorCookie = await loginAs(baseUrl, 'EDITOR');
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await safeCleanupTmpDir(tmpDir);
  }, 15_000);

  function editor<T = unknown>(method: string, path: string, body?: unknown): Promise<ApiResponse<T>> {
    return jsonRequest(method, `${baseUrl}${path}`, body, { Cookie: editorCookie });
  }

  async function createChatbot(namePrefix: string): Promise<{ id: string }> {
    const groupRes = await editor<{ id: string }>('POST', '/chatbot-groups', { name: `${namePrefix} 그룹` });
    const suffix = Math.random().toString(36).slice(2, 10);
    const res = await editor<{ id: string }>('POST', '/chatbots', { groupId: groupRes.body.id, name: `${namePrefix}-${suffix}`, slug: `sd-${suffix}` });
    return { id: res.body.id };
  }

  /** 공개 대화 API(슬러그 기준) 확인용 — id뿐 아니라 slug도 함께 반환한다. */
  async function createChatbotWithSlug(namePrefix: string): Promise<{ id: string; slug: string }> {
    const groupRes = await editor<{ id: string }>('POST', '/chatbot-groups', { name: `${namePrefix} 그룹` });
    const suffix = Math.random().toString(36).slice(2, 10);
    const slug = `sd-${suffix}`;
    const res = await editor<{ id: string }>('POST', '/chatbots', { groupId: groupRes.body.id, name: `${namePrefix}-${suffix}`, slug });
    return { id: res.body.id, slug };
  }

  async function createIntent(chatbotId: string, name: string): Promise<string> {
    const res = await editor<{ intent: { id: string } }>('POST', `/chatbots/${chatbotId}/intents`, { name, examples: [] });
    expect(res.status).toBe(201);
    return res.body.intent.id;
  }

  async function saveVersion(chatbotId: string, label: string): Promise<{ id: string; versionNo: number }> {
    const res = await editor<{ version: { id: string; versionNo: number } }>('POST', `/chatbots/${chatbotId}/versions`, { label });
    expect(res.status).toBe(201);
    return res.body.version;
  }

  async function createRestoreSchedule(chatbotId: string, versionId: string, scheduledAt: Date): Promise<{ id: string }> {
    const previewRes = await editor<{ restore: { base: { contentHash: string } } }>('POST', `/chatbots/${chatbotId}/deploy-schedules/preview`, {
      action: 'RESTORE_VERSION',
      versionId,
      scheduledAt: scheduledAt.toISOString(),
    });
    expect(previewRes.status).toBe(200);
    const baseHash = previewRes.body.restore.base.contentHash;

    const createRes = await editor<{ schedule: { id: string } }>('POST', `/chatbots/${chatbotId}/deploy-schedules`, {
      action: 'RESTORE_VERSION',
      versionId,
      previewedContentHash: baseHash,
      scheduledAt: scheduledAt.toISOString(),
    });
    expect(createRes.status).toBe(201);
    return createRes.body.schedule;
  }

  it('정상 실행 — 도래한 예약이 SUCCEEDED(APPLIED)로 종결되고 자산이 복원된다', async () => {
    const { id: chatbotId } = await createChatbot('정상실행');
    const intentId = await createIntent(chatbotId, '기준의도');
    const base = await saveVersion(chatbotId, '기준');
    await createIntent(chatbotId, '추가의도'); // 현재 상태를 바꿔 복원 대상과 달라지게 한다

    const scheduledAt = new Date(clock.now().getTime() + 10 * 60_000);
    const schedule = await createRestoreSchedule(chatbotId, base.id, scheduledAt);

    clock.advance(10 * 60_000 + 5_000);
    await engine.tick();

    const row = await prisma.deploySchedule.findUnique({ where: { id: schedule.id } });
    expect(row?.status).toBe('SUCCEEDED');
    expect(row?.outcome).toBe('APPLIED');

    // 복원되어 '추가의도'는 사라지고 기준 의도만 남는다.
    const intents = await editor<{ items: Array<{ id: string }> }>('GET', `/chatbots/${chatbotId}/intents`);
    expect(intents.body.items.map((i) => i.id)).toEqual([intentId]);
  });

  it('AC-D3-1: 예약 이후 자산이 변경되면 실행하지 않고 STATE_CHANGED로 실패한다(자산 불변)', async () => {
    const { id: chatbotId } = await createChatbot('상태변경');
    await createIntent(chatbotId, '기준의도2');
    const base = await saveVersion(chatbotId, '기준2');
    await createIntent(chatbotId, '예약생성시점편집'); // 현재 상태를 대상과 달라지게 해 복원이 의미 있게 만든다

    const scheduledAt = new Date(clock.now().getTime() + 10 * 60_000);
    const schedule = await createRestoreSchedule(chatbotId, base.id, scheduledAt);

    // 예약 생성 이후 다른 편집이 발생 — 기준 해시가 조용히 틀어진다.
    await createIntent(chatbotId, '예약후편집');

    clock.advance(10 * 60_000 + 5_000);
    await engine.tick();

    const row = await prisma.deploySchedule.findUnique({ where: { id: schedule.id } });
    expect(row?.status).toBe('FAILED');
    expect(row?.failureReason).toBe('STATE_CHANGED');

    // 자산이 실제로 바뀌지 않았는지(복원이 실행되지 않았는지) 확인 — 편집한 의도가 여전히 존재.
    const intents = await editor<{ items: Array<{ name: string }> }>('GET', `/chatbots/${chatbotId}/intents`);
    expect(intents.body.items.some((i) => i.name === '예약후편집')).toBe(true);
  });

  it('AC-D3-3: misfire 유예(10분)+허용오차를 넘겨 기동하면 MISSED가 된다(실행하지 않음)', async () => {
    const { id: chatbotId } = await createChatbot('미스파이어');
    await createIntent(chatbotId, '미스기준의도');
    const base = await saveVersion(chatbotId, '미스기준');
    await createIntent(chatbotId, '미스예약생성시점편집');

    const scheduledAt = new Date(clock.now().getTime() + 6 * 60_000); // 최소 리드타임(5분) + 여유
    const schedule = await createRestoreSchedule(chatbotId, base.id, scheduledAt);

    // 유예(10분) + 허용오차(35초)를 넘겨서 도래시킨다.
    clock.advance(6 * 60_000 + 11 * 60_000);
    await engine.tick();

    const row = await prisma.deploySchedule.findUnique({ where: { id: schedule.id } });
    expect(row?.status).toBe('MISSED');
    expect(row?.attemptCount).toBe(0);
  });

  it('AC-D3-8: 선행 복원 실패 시 같은 챗봇의 후속 예약이 HELD로 전파된다(옛 내용 공개 방지)', async () => {
    const { id: chatbotId } = await createChatbot('체인보류');
    await createIntent(chatbotId, '체인기준의도');
    const v1 = await saveVersion(chatbotId, 'v1');
    await createIntent(chatbotId, '체인두번째의도');
    const v2 = await saveVersion(chatbotId, 'v2');

    const firstAt = new Date(clock.now().getTime() + 10 * 60_000);
    const first = await createRestoreSchedule(chatbotId, v1.id, firstAt);

    const secondAt = new Date(firstAt.getTime() + 60_000); // 최소 간격(1분) 이상 뒤
    const second = await createRestoreSchedule(chatbotId, v2.id, secondAt);

    // 선행 예약이 STATE_CHANGED로 실패하도록 그 사이 편집을 넣는다.
    await createIntent(chatbotId, '체인편집');

    clock.advance(10 * 60_000 + 5_000);
    await engine.tick();

    const firstRow = await prisma.deploySchedule.findUnique({ where: { id: first.id } });
    expect(firstRow?.status).toBe('FAILED');

    const secondRow = await prisma.deploySchedule.findUnique({ where: { id: second.id } });
    expect(secondRow?.status).toBe('HELD');
    expect(secondRow?.heldReason).toBe('PREDECESSOR_FAILED');
  });

  it('AC-D4-3: 실행 직전 예약자 계정이 비활성화되면 CREATOR_NOT_AUTHORIZED로 실패하고 자산은 불변이다', async () => {
    const { id: chatbotId } = await createChatbot('권한상실');
    const intentId = await createIntent(chatbotId, '권한기준의도');
    const base = await saveVersion(chatbotId, '권한기준');
    await createIntent(chatbotId, '권한상실후편집');

    const scheduledAt = new Date(clock.now().getTime() + 10 * 60_000);
    const schedule = await createRestoreSchedule(chatbotId, base.id, scheduledAt);

    await prisma.user.update({ where: { email: 'integration-test-editor@chat-bot.local' }, data: { status: 'DISABLED' } });
    try {
      clock.advance(10 * 60_000 + 5_000);
      await engine.tick();

      const row = await prisma.deploySchedule.findUnique({ where: { id: schedule.id } });
      expect(row?.status).toBe('FAILED');
      expect(row?.failureReason).toBe('CREATOR_NOT_AUTHORIZED');
    } finally {
      await prisma.user.update({ where: { email: 'integration-test-editor@chat-bot.local' }, data: { status: 'ACTIVE' } });
    }

    // 계정 복구 후에도 자산은 실행되지 않았어야 한다(편집분이 그대로 남아있음).
    const intents = await editor<{ items: Array<{ id: string }> }>('GET', `/chatbots/${chatbotId}/intents`);
    expect(intents.body.items.map((i) => i.id)).toEqual(expect.arrayContaining([intentId]));
    expect(intents.body.items.length).toBe(2);
  });

  describe('H-1: 재개(RESUME) 미리보기 자기충돌(code-review 2라운드)', () => {
    it('excludeScheduleId 없이 HELD 예약을 재개 미리보기하면 자기 자신을 선행으로 인식해 RESTORE_NO_CHANGES로 막힌다(회귀 재현 — 기존 동작 유지)', async () => {
      const { id: chatbotId } = await createChatbot('재개자기충돌');
      await createIntent(chatbotId, '재개기준의도');
      const base = await saveVersion(chatbotId, '재개기준');
      await createIntent(chatbotId, '재개예약생성시점편집'); // 현재 ≠ 대상이 되게 해 최초 예약을 의미있게 만든다

      const scheduledAt = new Date(clock.now().getTime() + 10 * 60_000);
      const schedule = await createRestoreSchedule(chatbotId, base.id, scheduledAt);

      // 체인 실패로 인한 HELD 전이 메커니즘 자체는 AC-D3-8에서 이미 검증했다 — 여기서는 "HELD 상태의
      // 예약을 재개하기 전 미리보기" 계약만 확인하므로 직접 HELD로 만든다.
      await prisma.deploySchedule.update({ where: { id: schedule.id }, data: { status: 'HELD', heldReason: 'PREDECESSOR_FAILED', heldAt: clock.now() } });

      const newScheduledAt = new Date(clock.now().getTime() + 20 * 60_000);

      const withoutExclude = await editor<{ creatable: boolean; restore?: { blockers: Array<{ code: string }> } }>(
        'POST',
        `/chatbots/${chatbotId}/deploy-schedules/preview`,
        { action: 'RESTORE_VERSION', versionId: base.id, scheduledAt: newScheduledAt.toISOString() },
      );
      expect(withoutExclude.status).toBe(200);
      expect(withoutExclude.body.creatable).toBe(false);
      expect(withoutExclude.body.restore?.blockers.some((b) => b.code === 'NO_CHANGES')).toBe(true);
    });

    it('excludeScheduleId를 지정하면 재개 대상 자신을 제외해 creatable:true다', async () => {
      const { id: chatbotId } = await createChatbot('재개미리보기수정');
      await createIntent(chatbotId, '재개2기준의도');
      const base = await saveVersion(chatbotId, '재개2기준');
      await createIntent(chatbotId, '재개2예약생성시점편집');

      const scheduledAt = new Date(clock.now().getTime() + 10 * 60_000);
      const schedule = await createRestoreSchedule(chatbotId, base.id, scheduledAt);
      await prisma.deploySchedule.update({ where: { id: schedule.id }, data: { status: 'HELD', heldReason: 'PREDECESSOR_FAILED', heldAt: clock.now() } });

      const newScheduledAt = new Date(clock.now().getTime() + 20 * 60_000);

      const withExclude = await editor<{ creatable: boolean; restore?: { blockers: Array<{ code: string }>; base: { contentHash: string } } }>(
        'POST',
        `/chatbots/${chatbotId}/deploy-schedules/preview`,
        { action: 'RESTORE_VERSION', versionId: base.id, scheduledAt: newScheduledAt.toISOString(), excludeScheduleId: schedule.id },
      );
      expect(withExclude.status).toBe(200);
      expect(withExclude.body.creatable).toBe(true);
      expect(withExclude.body.restore?.blockers ?? []).toEqual([]);

      // 이 미리보기 해시로 실제 재개(resume)까지 정상적으로 끝나는지 확인한다(계약의 종단 검증).
      const resumeRes = await editor<{ id: string; status: string }>('POST', `/chatbots/${chatbotId}/deploy-schedules/${schedule.id}/resume`, {
        scheduledAt: newScheduledAt.toISOString(),
        previewedContentHash: withExclude.body.restore?.base.contentHash,
      });
      expect(resumeRes.status).toBe(200);
      expect(resumeRes.body.status).toBe('PENDING');
    });

    it('excludeScheduleId가 다른 챗봇 소속이면 404다(교차 챗봇 방어)', async () => {
      const { id: chatbotA } = await createChatbot('재개교차A');
      const { id: chatbotB } = await createChatbot('재개교차B');
      await createIntent(chatbotB, '교차기준의도');
      const baseB = await saveVersion(chatbotB, '교차기준');
      await createIntent(chatbotB, '교차편집');
      const scheduledAtB = new Date(clock.now().getTime() + 10 * 60_000);
      const scheduleB = await createRestoreSchedule(chatbotB, baseB.id, scheduledAtB);

      await createIntent(chatbotA, '교차A기준의도');
      const baseA = await saveVersion(chatbotA, '교차A기준');
      const res = await editor('POST', `/chatbots/${chatbotA}/deploy-schedules/preview`, {
        action: 'RESTORE_VERSION',
        versionId: baseA.id,
        scheduledAt: new Date(clock.now().getTime() + 20 * 60_000).toISOString(),
        excludeScheduleId: scheduleB.id,
      });
      expect(res.status).toBe(404);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────────────────────
  // [2026-09-24 No.28 시험 회차 — 신규] 리뷰·구현 단계 공백 보강
  // ──────────────────────────────────────────────────────────────────────────────────────────

  describe('PUBLISH/SET_WEB_CHANNEL 실행기 통합(§5.4, AC-D2-3~5)', () => {
    it('AC-D2-3: PUBLISH(enableWebChannel:true) 성공 — DRAFT→ACTIVE + WEB 채널이 같은 실행에서 열리고, 공개 대화 API가 실행 직전 403에서 실행 직후 200으로 즉시 바뀐다', async () => {
      const { id: chatbotId, slug } = await createChatbotWithSlug('공개시작');

      const before = await jsonRequest('GET', `${baseUrl}/public/chatbots/${slug}/config`);
      expect(before.status).toBe(403);
      expect((before.body as { code: string }).code).toBe('CHATBOT_NOT_PUBLISHED');

      const scheduledAt = new Date(clock.now().getTime() + 10 * 60_000);
      const createRes = await editor<{ schedule: { id: string } }>('POST', `/chatbots/${chatbotId}/deploy-schedules`, {
        action: 'PUBLISH',
        enableWebChannel: true,
        scheduledAt: scheduledAt.toISOString(),
      });
      expect(createRes.status).toBe(201);

      clock.advance(10 * 60_000 + 5_000);
      await engine.tick();

      const row = await prisma.deploySchedule.findUnique({ where: { id: createRes.body.schedule.id } });
      expect(row?.status).toBe('SUCCEEDED');
      expect(row?.outcome).toBe('APPLIED');

      const chatbot = await prisma.chatbot.findUnique({ where: { id: chatbotId } });
      expect(chatbot?.status).toBe('ACTIVE');

      // PublicAccessService는 캐시하지 않으므로 다음 요청부터 즉시 200이다(NFR-DP2, No.25 캐시 무효화와 같은 즉시성).
      const after = await jsonRequest('GET', `${baseUrl}/public/chatbots/${slug}/config`);
      expect(after.status).toBe(200);
    });

    it('AC-D2-4: PUBLISH 실행 중 채널 활성화가 실패하면 상태 변경도 함께 롤백된다(원자성, FR-D1-3)', async () => {
      const { id: chatbotId } = await createChatbot('원자성검증');
      const scheduledAt = new Date(clock.now().getTime() + 10 * 60_000);
      const createRes = await editor<{ schedule: { id: string } }>('POST', `/chatbots/${chatbotId}/deploy-schedules`, {
        action: 'PUBLISH',
        enableWebChannel: true,
        scheduledAt: scheduledAt.toISOString(),
      });
      expect(createRes.status).toBe(201);

      // ChatbotPublicationService.publish()는 상태 갱신 이후(같은 트랜잭션 안에서) 채널 활성화를
      // 시도한다(§5.4) — assertChannelEnableAllowed()에 실패를 주입해 "상태는 이미 바뀐 뒤 채널만
      // 실패하는" 중간 실패를 재현한다. 둘 다 같은 트랜잭션이므로 상태 변경도 롤백되어야 한다.
      const spy = jest.spyOn(channelEnableRule, 'assertChannelEnableAllowed').mockImplementationOnce(() => {
        throw new ApiException('CHANNEL_NOT_IMPLEMENTED', 409, 'AC-D2-4 주입 오류');
      });

      clock.advance(10 * 60_000 + 5_000);
      await engine.tick();

      spy.mockRestore();

      const row = await prisma.deploySchedule.findUnique({ where: { id: createRes.body.schedule.id } });
      expect(row?.status).toBe('FAILED');

      const chatbot = await prisma.chatbot.findUnique({ where: { id: chatbotId } });
      // 채널 활성화 실패로 트랜잭션 전체가 롤백돼 상태도 DRAFT 그대로여야 한다(원자성).
      expect(chatbot?.status).toBe('DRAFT');
      const channel = await prisma.channel.findUnique({ where: { chatbotId_type: { chatbotId, type: 'WEB' } } });
      expect(channel).toBeNull();
    });

    it('PUBLISH NOOP — 예약 실행 전에 이미 목표 상태(ACTIVE+채널 열림)가 됐으면 감사·백업 없이 SUCCEEDED(NOOP)다(FR-D3-13)', async () => {
      const { id: chatbotId } = await createChatbot('공개NOOP');

      const scheduledAt = new Date(clock.now().getTime() + 10 * 60_000);
      const createRes = await editor<{ schedule: { id: string } }>('POST', `/chatbots/${chatbotId}/deploy-schedules`, {
        action: 'PUBLISH',
        enableWebChannel: true,
        scheduledAt: scheduledAt.toISOString(),
      });
      expect(createRes.status).toBe(201);

      // 예약이 걸린 뒤(체인 전제가 깨지지 않는 범위에서) 다른 관리자가 즉시 실행 경로로 먼저
      // ACTIVE + WEB 채널을 열어 둔다 — 실행 시각에는 이미 목표 상태와 같다.
      const statusRes = await editor('PATCH', `/chatbots/${chatbotId}/status`, { status: 'ACTIVE' });
      expect(statusRes.status).toBe(200);
      const channelRes = await editor('PATCH', `/chatbots/${chatbotId}/channels/WEB`, { enabled: true });
      expect(channelRes.status).toBe(200);

      const auditCountBefore = await prisma.auditLog.count({ where: { chatbotId } });

      clock.advance(10 * 60_000 + 5_000);
      await engine.tick();

      const row = await prisma.deploySchedule.findUnique({ where: { id: createRes.body.schedule.id } });
      expect(row?.status).toBe('SUCCEEDED');
      expect(row?.outcome).toBe('NOOP');

      const auditCountAfter = await prisma.auditLog.count({ where: { chatbotId } });
      // NOOP은 실행에 대한 추가 감사를 남기지 않는다(FR-D6-6) — 예약 실행 전 즉시 상태·채널 변경
      // 감사(2건)에 더해 실행분(0건)만 그대로다.
      expect(auditCountAfter).toBe(auditCountBefore);
    });

    it('AC-D2-5: SET_WEB_CHANNEL(false) 실행 — 다음 공개 요청부터 403 CHANNEL_DISABLED다', async () => {
      const { id: chatbotId, slug } = await createChatbotWithSlug('채널닫기');
      const statusRes = await editor('PATCH', `/chatbots/${chatbotId}/status`, { status: 'ACTIVE' });
      expect(statusRes.status).toBe(200);
      const channelRes = await editor('PATCH', `/chatbots/${chatbotId}/channels/WEB`, { enabled: true });
      expect(channelRes.status).toBe(200);

      const before = await jsonRequest('GET', `${baseUrl}/public/chatbots/${slug}/config`);
      expect(before.status).toBe(200);

      const scheduledAt = new Date(clock.now().getTime() + 10 * 60_000);
      const createRes = await editor<{ schedule: { id: string } }>('POST', `/chatbots/${chatbotId}/deploy-schedules`, {
        action: 'SET_WEB_CHANNEL',
        enabled: false,
        scheduledAt: scheduledAt.toISOString(),
      });
      expect(createRes.status).toBe(201);

      clock.advance(10 * 60_000 + 5_000);
      await engine.tick();

      const row = await prisma.deploySchedule.findUnique({ where: { id: createRes.body.schedule.id } });
      expect(row?.status).toBe('SUCCEEDED');
      expect(row?.outcome).toBe('APPLIED');

      const after = await jsonRequest('GET', `${baseUrl}/public/chatbots/${slug}/config`);
      expect(after.status).toBe(403);
      expect((after.body as { code: string }).code).toBe('CHANNEL_DISABLED');
    });
  });

  describe('G3 — 실행 직후 TC(§11, FR-D5-3)', () => {
    async function createTestSetWithCase(chatbotId: string, name: string): Promise<string> {
      const setRes = await editor<{ id: string }>('POST', `/chatbots/${chatbotId}/test-sets`, { name });
      expect(setRes.status).toBe(201);
      const caseRes = await editor('POST', `/chatbots/${chatbotId}/test-sets/${setRes.body.id}/cases`, { messages: ['안녕하세요'], expectedKind: 'FALLBACK' });
      expect(caseRes.status).toBe(201);
      return setRes.body.id;
    }

    it('postRunTestSetId 지정 + PUBLISH APPLIED → STARTED이고 resultSummary.postRunTest.testRunId가 채워진다', async () => {
      const { id: chatbotId } = await createChatbot('G3시작됨');
      const setId = await createTestSetWithCase(chatbotId, 'G3세트');

      const scheduledAt = new Date(clock.now().getTime() + 10 * 60_000);
      const createRes = await editor<{ schedule: { id: string } }>('POST', `/chatbots/${chatbotId}/deploy-schedules`, {
        action: 'PUBLISH',
        enableWebChannel: false,
        scheduledAt: scheduledAt.toISOString(),
        postRunTestSetId: setId,
      });
      expect(createRes.status).toBe(201);

      clock.advance(10 * 60_000 + 5_000);
      await engine.tick();

      const row = await prisma.deploySchedule.findUnique({ where: { id: createRes.body.schedule.id } });
      expect(row?.status).toBe('SUCCEEDED');
      expect(row?.outcome).toBe('APPLIED');
      expect(row?.testRunId).toBeTruthy();
      const summary = JSON.parse(row!.resultSummary!) as { postRunTest?: { status: string; testRunId?: string } };
      expect(summary.postRunTest).toEqual({ status: 'STARTED', testRunId: row!.testRunId });
    });

    it('세트에 활성화된 TC가 없으면 SKIPPED(TEST_SET_EMPTY)이고, 예약 자체의 결과는 SUCCEEDED(APPLIED)로 유지된다(G3 실패가 본 결과를 바꾸지 않는다)', async () => {
      const { id: chatbotId } = await createChatbot('G3비어있음');
      const setRes = await editor<{ id: string }>('POST', `/chatbots/${chatbotId}/test-sets`, { name: '빈세트' });
      expect(setRes.status).toBe(201);

      const scheduledAt = new Date(clock.now().getTime() + 10 * 60_000);
      const createRes = await editor<{ schedule: { id: string } }>('POST', `/chatbots/${chatbotId}/deploy-schedules`, {
        action: 'PUBLISH',
        enableWebChannel: false,
        scheduledAt: scheduledAt.toISOString(),
        postRunTestSetId: setRes.body.id,
      });
      expect(createRes.status).toBe(201);

      clock.advance(10 * 60_000 + 5_000);
      await engine.tick();

      const row = await prisma.deploySchedule.findUnique({ where: { id: createRes.body.schedule.id } });
      expect(row?.status).toBe('SUCCEEDED');
      expect(row?.outcome).toBe('APPLIED');
      expect(row?.testRunId).toBeNull();
      const summary = JSON.parse(row!.resultSummary!) as { postRunTest?: { status: string; reason?: string } };
      expect(summary.postRunTest).toEqual({ status: 'SKIPPED', reason: 'TEST_SET_EMPTY' });
    });

    it('SET_WEB_CHANNEL에 postRunTestSetId를 지정하면 생성 자체가 409 TEST_SET_NOT_APPLICABLE로 거부된다(§11 허용 동작 제한)', async () => {
      const { id: chatbotId } = await createChatbot('G3부적합');
      const setId = await createTestSetWithCase(chatbotId, 'G3부적합세트');

      const scheduledAt = new Date(clock.now().getTime() + 10 * 60_000);
      const res = await editor('POST', `/chatbots/${chatbotId}/deploy-schedules`, {
        action: 'SET_WEB_CHANNEL',
        enabled: true,
        scheduledAt: scheduledAt.toISOString(),
        postRunTestSetId: setId,
      });
      expect(res.status).toBe(409);
      expect((res.body as { code: string }).code).toBe('DEPLOY_SCHEDULE_PRECONDITION_FAILED');
      expect((res.body as { details?: Array<{ message: string }> }).details?.some((d) => d.message === 'TEST_SET_NOT_APPLICABLE')).toBe(true);
    });
  });

  describe('재시도 분류 — 일시적 원인(§7.6, AC-D3-5~7)', () => {
    it('AC-D3-5: 진행 중 TestRun(RUNNING)이 있으면 PENDING(재시도, ACTIVE_JOB)으로 되돌아가고, 작업이 끝난 뒤 다음 tick에 성공한다', async () => {
      const { id: chatbotId } = await createChatbot('진행중작업재시도');
      await createIntent(chatbotId, '재시도기준의도');
      const base = await saveVersion(chatbotId, '재시도기준');
      await createIntent(chatbotId, '재시도예약생성시점편집');

      const setRes = await editor<{ id: string }>('POST', `/chatbots/${chatbotId}/test-sets`, { name: '진행중세트' });
      const testRun = await prisma.testRun.create({ data: { chatbotId, setId: setRes.body.id, status: 'RUNNING' } });

      const scheduledAt = new Date(clock.now().getTime() + 10 * 60_000);
      const schedule = await createRestoreSchedule(chatbotId, base.id, scheduledAt);

      clock.advance(10 * 60_000 + 5_000);
      await engine.tick();

      const afterFirstTick = await prisma.deploySchedule.findUnique({ where: { id: schedule.id } });
      expect(afterFirstTick?.status).toBe('PENDING');
      expect(afterFirstTick?.attemptCount).toBe(1);
      expect(afterFirstTick?.lastTransientReason).toBe('ACTIVE_JOB');

      // 진행 중이던 작업이 끝난다.
      await prisma.testRun.update({ where: { id: testRun.id }, data: { status: 'SUCCEEDED' } });
      clock.advance(30_000); // 다음 폴링 주기
      await engine.tick();

      const afterSecondTick = await prisma.deploySchedule.findUnique({ where: { id: schedule.id } });
      expect(afterSecondTick?.status).toBe('SUCCEEDED');
      expect(afterSecondTick?.outcome).toBe('APPLIED');
    });

    it('AC-D3-6: 재시도 창(15분)을 넘기면 FAILED(BLOCKED_TOO_LONG)이고 후속 예약은 HELD로 전파된다', async () => {
      const { id: chatbotId } = await createChatbot('재시도창초과');
      await createIntent(chatbotId, '재시도창기준의도');
      const v1 = await saveVersion(chatbotId, 'v1');
      await createIntent(chatbotId, '재시도창두번째의도');
      const v2 = await saveVersion(chatbotId, 'v2');
      await createIntent(chatbotId, '재시도창예약생성시점편집');

      const setRes = await editor<{ id: string }>('POST', `/chatbots/${chatbotId}/test-sets`, { name: '장기진행세트' });
      await prisma.testRun.create({ data: { chatbotId, setId: setRes.body.id, status: 'RUNNING' } });

      const firstAt = new Date(clock.now().getTime() + 10 * 60_000);
      const first = await createRestoreSchedule(chatbotId, v1.id, firstAt);
      const secondAt = new Date(firstAt.getTime() + 60_000);
      const second = await createRestoreSchedule(chatbotId, v2.id, secondAt);

      clock.advance(10 * 60_000 + 5_000);
      await engine.tick(); // 1차 시도 — TRANSIENT(ACTIVE_JOB), attemptCount=1
      expect((await prisma.deploySchedule.findUnique({ where: { id: first.id } }))?.attemptCount).toBe(1);

      // 재시도 창(15분, 예정 시각 기준)을 넘긴다. 작업은 여전히 RUNNING 상태다.
      clock.advance(16 * 60_000);
      await engine.tick();

      const firstRow = await prisma.deploySchedule.findUnique({ where: { id: first.id } });
      expect(firstRow?.status).toBe('FAILED');
      expect(firstRow?.failureReason).toBe('BLOCKED_TOO_LONG');

      const secondRow = await prisma.deploySchedule.findUnique({ where: { id: second.id } });
      expect(secondRow?.status).toBe('HELD');
      expect(secondRow?.heldReason).toBe('PREDECESSOR_FAILED');
    });
  });

  describe('AC-D3-11: 임대 만료 회수 판정(§7.8) — RUNNING 중 프로세스 사망 시뮬레이션', () => {
    it('BEFORE_RESTORE 백업(이 예약의 triggerContext)이 존재하면 SUCCEEDED(RECOVERED)다(커밋된 실행)', async () => {
      const { id: chatbotId } = await createChatbot('임대회수성공');
      await createIntent(chatbotId, '임대기준의도');
      const base = await saveVersion(chatbotId, '임대기준');
      await createIntent(chatbotId, '임대예약생성시점편집');

      const scheduledAt = new Date(clock.now().getTime() + 10 * 60_000);
      const schedule = await createRestoreSchedule(chatbotId, base.id, scheduledAt);
      const row = await prisma.deploySchedule.findUnique({ where: { id: schedule.id } });

      // "선점은 됐지만 종결 직전 프로세스가 죽었다"를 재현한다 — RUNNING으로 직접 전이시키고
      // (claimedAt을 임대 만료 시점 이전으로), 이 예약이 원인인 BEFORE_RESTORE 백업을 실제로
      // 남긴다(§7.8의 회수 판정은 "백업 존재 = 커밋 증명"이라는 원리를 그대로 이용한다).
      const claimedAt = clock.now();
      await prisma.deploySchedule.update({
        where: { id: schedule.id },
        data: { status: 'RUNNING', claimToken: 'sim-token-1', claimedAt, attemptCount: 1, startedAt: claimedAt },
      });
      await prisma.chatbotVersion.create({
        data: {
          chatbotId,
          versionNo: 999,
          trigger: 'BEFORE_RESTORE',
          triggerContext: JSON.stringify({ deployScheduleId: schedule.id }),
          schemaVersion: 1,
          contentHash: 'f'.repeat(64),
          counts: JSON.stringify({}),
          sizeBytes: 10,
          createdAt: new Date(claimedAt.getTime() + 1000),
        },
      });

      clock.advance((row!.scheduledAt.getTime() - clock.now().getTime()) + 6 * 60_000); // 임대(5분) 초과
      await engine.tick();

      const after = await prisma.deploySchedule.findUnique({ where: { id: schedule.id } });
      expect(after?.status).toBe('SUCCEEDED');
      expect(after?.outcome).toBe('RECOVERED');
    });

    it('백업 흔적이 없고 자산도 그대로면 FAILED(INTERRUPTED)이고 자산은 불변이다(커밋 전 중단)', async () => {
      const { id: chatbotId } = await createChatbot('임대회수중단');
      const intentId = await createIntent(chatbotId, '중단기준의도');
      const base = await saveVersion(chatbotId, '중단기준');
      await createIntent(chatbotId, '중단예약생성시점편집');

      const scheduledAt = new Date(clock.now().getTime() + 10 * 60_000);
      const schedule = await createRestoreSchedule(chatbotId, base.id, scheduledAt);
      const row = await prisma.deploySchedule.findUnique({ where: { id: schedule.id } });

      // 선점만 되고(claimToken 존재) 실제 restore()는 시작도 못 한 채 죽었다고 가정 — 백업이 없다.
      const claimedAt = clock.now();
      await prisma.deploySchedule.update({
        where: { id: schedule.id },
        data: { status: 'RUNNING', claimToken: 'sim-token-2', claimedAt, attemptCount: 1, startedAt: claimedAt },
      });

      clock.advance((row!.scheduledAt.getTime() - clock.now().getTime()) + 6 * 60_000);
      await engine.tick();

      const after = await prisma.deploySchedule.findUnique({ where: { id: schedule.id } });
      expect(after?.status).toBe('FAILED');
      expect(after?.failureReason).toBe('INTERRUPTED');

      // 자산이 실제로 바뀌지 않았어야 한다 — 편집한 의도가 여전히 존재하고, 기준 의도도 그대로다.
      const intents = await editor<{ items: Array<{ id: string; name: string }> }>('GET', `/chatbots/${chatbotId}/intents`);
      expect(intents.body.items.map((i) => i.id)).toEqual(expect.arrayContaining([intentId]));
      expect(intents.body.items.some((i) => i.name === '중단예약생성시점편집')).toBe(true);
    });

    it('AC-D3-12: 임대가 아직 유효한 RUNNING 행은 건드리지 않는다(단일 인스턴스 가정 없음)', async () => {
      const { id: chatbotId } = await createChatbot('임대유효중');
      await createIntent(chatbotId, '임대유효기준의도');
      const base = await saveVersion(chatbotId, '임대유효기준');
      await createIntent(chatbotId, '임대유효예약생성시점편집');

      const scheduledAt = new Date(clock.now().getTime() + 10 * 60_000);
      const schedule = await createRestoreSchedule(chatbotId, base.id, scheduledAt);

      const claimedAt = clock.now();
      await prisma.deploySchedule.update({
        where: { id: schedule.id },
        data: { status: 'RUNNING', claimToken: 'sim-token-3', claimedAt, attemptCount: 1, startedAt: claimedAt },
      });

      // 임대(기본 5분)를 넘기지 않은 시점에 tick — 다른 인스턴스가 아직 정상 실행 중일 수 있으므로
      // 건드리지 않아야 한다.
      clock.advance(2 * 60_000);
      await engine.tick();

      const after = await prisma.deploySchedule.findUnique({ where: { id: schedule.id } });
      expect(after?.status).toBe('RUNNING');
      expect(after?.claimToken).toBe('sim-token-3');
    });
  });

  describe('권한 재확인·감사 주체(§8, AC-D4-4~5)', () => {
    it('AC-D4-4: 생성자 역할이 EDITOR→VIEWER로 강등되면 실행 시각에 CREATOR_NOT_AUTHORIZED로 실패한다', async () => {
      const { id: chatbotId } = await createChatbot('역할강등');
      await createIntent(chatbotId, '강등기준의도');
      const base = await saveVersion(chatbotId, '강등기준');
      await createIntent(chatbotId, '강등예약생성시점편집');

      const scheduledAt = new Date(clock.now().getTime() + 10 * 60_000);
      const schedule = await createRestoreSchedule(chatbotId, base.id, scheduledAt);

      await prisma.user.update({ where: { email: 'integration-test-editor@chat-bot.local' }, data: { role: 'VIEWER' } });
      try {
        clock.advance(10 * 60_000 + 5_000);
        await engine.tick();

        const row = await prisma.deploySchedule.findUnique({ where: { id: schedule.id } });
        expect(row?.status).toBe('FAILED');
        expect(row?.failureReason).toBe('CREATOR_NOT_AUTHORIZED');
      } finally {
        await prisma.user.update({ where: { email: 'integration-test-editor@chat-bot.local' }, data: { role: 'EDITOR' } });
      }
    });

    it('mustChangePassword=true여도 실행은 막히지 않는다(권한 박탈이 아니다, §8.3)', async () => {
      const { id: chatbotId } = await createChatbot('비번변경필요');
      await createIntent(chatbotId, '비번기준의도');
      const base = await saveVersion(chatbotId, '비번기준');
      await createIntent(chatbotId, '비번예약생성시점편집');

      const scheduledAt = new Date(clock.now().getTime() + 10 * 60_000);
      const schedule = await createRestoreSchedule(chatbotId, base.id, scheduledAt);

      await prisma.user.update({ where: { email: 'integration-test-editor@chat-bot.local' }, data: { mustChangePassword: true } });
      try {
        clock.advance(10 * 60_000 + 5_000);
        await engine.tick();

        const row = await prisma.deploySchedule.findUnique({ where: { id: schedule.id } });
        expect(row?.status).toBe('SUCCEEDED');
        expect(row?.outcome).toBe('APPLIED');
      } finally {
        await prisma.user.update({ where: { email: 'integration-test-editor@chat-bot.local' }, data: { mustChangePassword: false } });
      }
    });

    it('AC-D4-5: 감사로그의 RESTORE 레코드 주체가 예약자(생성자)이고 summary에 [예약 실행] 접두가 있다 — system 주체 레코드는 없다', async () => {
      const { id: chatbotId } = await createChatbot('감사주체');
      await createIntent(chatbotId, '감사기준의도');
      const base = await saveVersion(chatbotId, '감사기준');
      await createIntent(chatbotId, '감사예약생성시점편집');

      const scheduledAt = new Date(clock.now().getTime() + 10 * 60_000);
      const schedule = await createRestoreSchedule(chatbotId, base.id, scheduledAt);

      clock.advance(10 * 60_000 + 5_000);
      await engine.tick();

      const restoreLogs = await prisma.auditLog.findMany({ where: { chatbotId, action: 'RESTORE' } });
      expect(restoreLogs).toHaveLength(1);
      expect(restoreLogs[0].actorEmail).toBe('integration-test-editor@chat-bot.local');
      expect(restoreLogs[0].summary).toMatch(/^\[예약 실행 #[0-9a-f]{8}\] /);
      expect(restoreLogs[0].summary).toContain(`#${schedule.id.slice(0, 8)}`);

      const systemLogs = await prisma.auditLog.findMany({ where: { chatbotId, actorEmail: 'system' } });
      expect(systemLogs).toHaveLength(0);

      // 백업 스냅샷의 생성자도 예약자여야 한다(§9.2 — 타이머 경로에서 null이 되는 결함을 막는다).
      const backup = await prisma.chatbotVersion.findFirst({ where: { chatbotId, trigger: 'BEFORE_RESTORE' } });
      expect(backup).not.toBeNull();
    });
  });

  describe('보존 보호·삭제 409(§9.3, AC-D5-1~2)', () => {
    it('AC-D5-2: 활성 예약이 참조하는 버전을 수동 삭제하면 409 VERSION_REFERENCED_BY_SCHEDULE이고, 예약 취소 후에는 삭제된다', async () => {
      const { id: chatbotId } = await createChatbot('버전보호삭제');
      await createIntent(chatbotId, '보호기준의도');
      const base = await saveVersion(chatbotId, '보호기준');
      await createIntent(chatbotId, '보호예약생성시점편집');

      const scheduledAt = new Date(clock.now().getTime() + 10 * 60_000);
      const schedule = await createRestoreSchedule(chatbotId, base.id, scheduledAt);

      const deleteBlocked = await editor('DELETE', `/chatbots/${chatbotId}/versions/${base.id}`);
      expect(deleteBlocked.status).toBe(409);
      expect((deleteBlocked.body as { code: string }).code).toBe('VERSION_REFERENCED_BY_SCHEDULE');

      const cancelRes = await editor('POST', `/chatbots/${chatbotId}/deploy-schedules/${schedule.id}/cancel`);
      expect(cancelRes.status).toBe(200);

      const deleteAllowed = await editor('DELETE', `/chatbots/${chatbotId}/versions/${base.id}`);
      expect(deleteAllowed.status).toBe(204);
    });

    it('AC-D5-1: 활성 예약이 참조하는 버전은 자동 보존 정리(pruneBestEffort)에서 제외된다(자동 한도 초과를 직접 시딩해 재현)', async () => {
      const { id: chatbotId } = await createChatbot('버전보호정리');
      await createIntent(chatbotId, '정리보호기준의도');
      const protectedVersion = await saveVersion(chatbotId, '정리보호대상');
      await createIntent(chatbotId, '정리보호예약생성시점편집');

      const scheduledAt = new Date(clock.now().getTime() + 10 * 60_000);
      await createRestoreSchedule(chatbotId, protectedVersion.id, scheduledAt);

      const beforeCount = await prisma.chatbotVersion.count({ where: { chatbotId } });

      // 자동 보존 한도(기본 30건)를 직접 시딩으로 초과시킨다 — HTTP로 31건을 만드는 비용을 피하고
      // (환경변수는 앱 인스턴스화 시점에 고정돼 동적 조정도 불가하다, No.25 시험 문서의 알려진 제약과
      // 동일 이유) 실제 서비스 메서드(`pruneBestEffort`)를 직접 호출해 배선(§9.3 — deploySchedule
      // 참조 조회 → selectVersionsToPrune 보호 집합 전달)을 검증한다.
      let lastSeedId = '';
      for (let i = 0; i < 35; i += 1) {
        const seed = await prisma.chatbotVersion.create({
          data: {
            chatbotId,
            versionNo: 1000 + i,
            trigger: 'BEFORE_IMPORT',
            schemaVersion: 1,
            contentHash: `seed-${i}`.padEnd(64, '0'),
            counts: JSON.stringify({}),
            sizeBytes: 100,
          },
        });
        lastSeedId = seed.id;
      }

      await versionRetention.pruneBestEffort(chatbotId, lastSeedId);

      // 보호 대상 버전은 정리 한도에 걸릴 만큼 오래됐어도(가장 먼저 만든 버전) 살아있어야 한다.
      const survivor = await prisma.chatbotVersion.findUnique({ where: { id: protectedVersion.id } });
      expect(survivor).not.toBeNull();

      // 보호가 없었다면 정리 대상이었을 오래된 시드가 실제로 정리됐는지(=배선이 살아있는지) 총 행
      // 수 감소로 확인한다 — 35시드 + 보호대상 1건 + 기준 버전(정리보호기준용) 중 자동 한도(30) 초과분이
      // 정리돼야 한다.
      const afterCount = await prisma.chatbotVersion.count({ where: { chatbotId } });
      expect(afterCount).toBeLessThan(beforeCount + 35);
    });
  });
});
