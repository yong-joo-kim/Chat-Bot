import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import * as http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { VersioningType } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { normalizeText } from '@chat-bot/shared-types';
import { AllExceptionsFilter } from '../common/all-exceptions.filter';
import { PrismaService } from '../prisma/prisma.service';
import { computeContentHash, serializeEnvelopeForStorage } from '../versions/lib/snapshot-canonical';
import type { SnapshotEnvelope } from '../versions/lib/snapshot-envelope';
import { VersionRestoreApplier } from '../versions/restore/version-restore.applier';
import { VersionCaptureService } from '../versions/capture/version-capture.service';
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

/**
 * 챗봇 복원/버전 이력관리(No.25) 통합 테스트 — `version-history-설계.md` §17 시험 관점의 필수 5종
 * (AC-H3-2·AC-H3-4·AC-H3-8·AC-H3-7·AC-H3-20) 중 HTTP 계약으로 검증 가능한 항목 + 409 조건들 +
 * 보존 정리 + 권한 AND + 훅 fail-open(정상 경로 배선 확인)을 다룬다. AC-H3-20(픽스처 복원 가능성)은
 * `versions/lib/snapshot-upcasters.spec.ts`가 단위 수준에서 이미 담당한다.
 */
describe('챗봇 복원/버전 이력관리(No.25) 통합 테스트', () => {
  let app: NestExpressApplication;
  let baseUrl: string;
  let tmpDir: string;
  let prisma: PrismaService;
  let editorCookie = '';
  let viewerCookie = '';

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'chatbot-version-history-test-'));
    const dbPath = join(tmpDir, 'test.db').replace(/\\/g, '/');
    const testDatabaseUrl = `file:${dbPath}`;

    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.DEPLOY_SCHEDULE_ENABLED = 'false'; // [No.28] 실행 엔진 비활성 — 기존 그룹 통합 시험은 폴링 없이 수행(§7.10)
    process.env.WIDGET_BASE_URL = process.env.WIDGET_BASE_URL ?? 'http://localhost:5174';
    process.env.PUBLIC_API_BASE_URL = process.env.PUBLIC_API_BASE_URL ?? 'http://localhost:3000/api/v1';
    delete process.env.EMBEDDING_BASE_URL; // 규칙 매칭만 — 이 그룹은 임베딩을 쓰지 않는다.
    // 보존/고정 상한을 작게 잡아 테스트를 짧게 유지한다.
    process.env.VERSION_RETENTION_MANUAL = '3';
    process.env.VERSION_RETENTION_AUTO = '3';
    process.env.VERSION_PINNED_MAX = '2';

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

    // `ConfigModule.forRoot({ validate })`는 모듈이 실제로 인스턴스화되는 시점의 process.env를
    // 읽는다(`unanswered-collector.service.spec.ts` 상단 주석 참고) — 파일 상단의 정적 import는
    // beforeAll보다 먼저 평가되어 그 시점의 env를 굳힐 수 있으므로, env 오버라이드를 마친 **뒤**
    // 동적 import로 AppModule을 가져와야 VERSION_* 환경변수 오버라이드가 실제로 반영된다.
    const { AppModule } = await import('../app.module');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    app.enableCors();
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalFilters(new AllExceptionsFilter());
    prisma = moduleRef.get(PrismaService);

    await app.listen(0);
    const server = app.getHttpServer() as http.Server;
    const address = server.address();
    const port = typeof address === 'object' && address !== null ? address.port : 0;
    baseUrl = `http://127.0.0.1:${port}/api/v1`;

    await seedTestUsers(prisma);
    editorCookie = await loginAs(baseUrl, 'EDITOR');
    viewerCookie = await loginAs(baseUrl, 'VIEWER');
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await safeCleanupTmpDir(tmpDir);
  }, 15_000);

  function editor<T = unknown>(method: string, path: string, body?: unknown): Promise<ApiResponse<T>> {
    return jsonRequest(method, `${baseUrl}${path}`, body, { Cookie: editorCookie });
  }

  function viewer<T = unknown>(method: string, path: string, body?: unknown): Promise<ApiResponse<T>> {
    return jsonRequest(method, `${baseUrl}${path}`, body, { Cookie: viewerCookie });
  }

  async function createChatbot(namePrefix: string): Promise<{ id: string }> {
    const groupRes = await editor<{ id: string }>('POST', '/chatbot-groups', { name: `${namePrefix} 그룹` });
    const suffix = Math.random().toString(36).slice(2, 10);
    const res = await editor<{ id: string }>('POST', '/chatbots', { groupId: groupRes.body.id, name: `${namePrefix}-${suffix}`, slug: `vh-${suffix}` });
    return { id: res.body.id };
  }

  async function createIntent(chatbotId: string, name: string, examples: string[] = []): Promise<string> {
    const res = await editor<{ intent: { id: string } }>('POST', `/chatbots/${chatbotId}/intents`, { name, examples });
    expect(res.status).toBe(201);
    return res.body.intent.id;
  }

  describe('캡처 일관성 · 해시 동일 생략', () => {
    it('빈 챗봇에서 연속 수동 저장하면 두 번째는 unchanged:true를 반환한다(FR-H1-5)', async () => {
      const { id: chatbotId } = await createChatbot('캡처일관성');

      const first = await editor<{ unchanged: boolean; version: { versionNo: number } }>('POST', `/chatbots/${chatbotId}/versions`, { label: '최초' });
      expect(first.status).toBe(201);
      expect(first.body.unchanged).toBe(false);
      expect(first.body.version.versionNo).toBe(1);

      const second = await editor<{ unchanged: boolean; latestVersionNo: number }>('POST', `/chatbots/${chatbotId}/versions`, {});
      expect(second.status).toBe(200);
      expect(second.body.unchanged).toBe(true);
      expect(second.body.latestVersionNo).toBe(1);
    });

    it('GET current는 저장되지 않은 변경 유무를 정확히 보고한다', async () => {
      const { id: chatbotId } = await createChatbot('현재상태');
      const before = await editor<{ hasUnsavedChanges: boolean; latestVersion: unknown }>('GET', `/chatbots/${chatbotId}/versions/current`);
      expect(before.body.hasUnsavedChanges).toBe(true); // 버전이 아예 없음
      expect(before.body.latestVersion).toBeNull();

      await editor('POST', `/chatbots/${chatbotId}/versions`, {});
      const afterSave = await editor<{ hasUnsavedChanges: boolean }>('GET', `/chatbots/${chatbotId}/versions/current`);
      expect(afterSave.body.hasUnsavedChanges).toBe(false);

      await createIntent(chatbotId, '새의도');
      const afterEdit = await editor<{ hasUnsavedChanges: boolean }>('GET', `/chatbots/${chatbotId}/versions/current`);
      expect(afterEdit.body.hasUnsavedChanges).toBe(true);
    });
  });

  describe('자동 스냅샷 훅(fail-open 배선) — 일괄 삭제 직전', () => {
    it('의도 일괄 삭제 직전 BEFORE_BULK_DELETE 자동 스냅샷이 만들어진다(§6.4)', async () => {
      const { id: chatbotId } = await createChatbot('자동스냅샷');
      const intentId = await createIntent(chatbotId, '삭제될의도');

      const del = await editor<{ autoSnapshot?: unknown }>('POST', `/chatbots/${chatbotId}/intents/bulk-delete`, { ids: [intentId] });
      expect(del.status).toBe(204);

      const list = await editor<{ items: Array<{ trigger: string }> }>('GET', `/chatbots/${chatbotId}/versions`);
      expect(list.body.items.some((v) => v.trigger === 'BEFORE_BULK_DELETE')).toBe(true);
    });
  });

  describe('복원 — 원자적 · ID 보존 · 해시 동일(AC-H3-2/3/4)', () => {
    it('복원 후 해시가 대상과 같고, ID가 보존되어 TC가 계속 유효하다', async () => {
      const { id: chatbotId } = await createChatbot('복원핵심');
      const intentId = await createIntent(chatbotId, '환불규정문의', ['환불 어떻게 하나요']);

      const saved = await editor<{ version: { id: string; versionNo: number } }>('POST', `/chatbots/${chatbotId}/versions`, { label: '기준' });
      const baseVersionId = saved.body.version.id;
      const baseStatus = await editor<{ contentHash: string }>('GET', `/chatbots/${chatbotId}/versions/current`);
      const baseHash = baseStatus.body.contentHash;

      // TC 세트 — 복원 대상 의도 ID를 기대값으로 저장(AC-H3-4).
      const setRes = await editor<{ id: string }>('POST', `/chatbots/${chatbotId}/test-sets`, { name: '복원검증세트' });
      await editor('POST', `/chatbots/${chatbotId}/test-sets/${setRes.body.id}/cases`, {
        messages: ['환불 어떻게 하나요'],
        expectedKind: 'INTENT',
        expectedTargetId: intentId,
      });

      // 예문 추가 + 새 의도 생성으로 상태를 바꾼다.
      await editor('PATCH', `/chatbots/${chatbotId}/intents/${intentId}/examples`, { add: ['환불 규정 알려줘'] });
      await createIntent(chatbotId, '임시의도');

      const afterEditStatus = await editor<{ contentHash: string }>('GET', `/chatbots/${chatbotId}/versions/current`);
      expect(afterEditStatus.body.contentHash).not.toBe(baseHash);

      const preview = await editor<{ currentContentHash: string; restorable: boolean; blockers: unknown[] }>(
        'POST',
        `/chatbots/${chatbotId}/versions/${baseVersionId}/restore/preview`,
      );
      expect(preview.status).toBe(200);
      expect(preview.body.blockers).toEqual([]);
      expect(preview.body.restorable).toBe(true);

      const restore = await editor<{ restoredFromVersionNo: number; backupVersionNo: number; contentHash: string; classifierDeleted: boolean }>(
        'POST',
        `/chatbots/${chatbotId}/versions/${baseVersionId}/restore`,
        { expectedCurrentHash: preview.body.currentContentHash },
      );
      expect(restore.status).toBe(200);
      expect(restore.body.restoredFromVersionNo).toBe(1);
      expect(restore.body.backupVersionNo).toBe(2);
      expect(restore.body.contentHash).toBe(baseHash);
      // M-3: 분류기 행이 없는 챗봇이므로 applier의 deleteMany count가 0 — false여야 한다.
      expect(restore.body.classifierDeleted).toBe(false);

      // AC-H3-2 — 복원 후 현재 해시 == 대상 해시.
      const afterRestoreStatus = await editor<{ contentHash: string }>('GET', `/chatbots/${chatbotId}/versions/current`);
      expect(afterRestoreStatus.body.contentHash).toBe(baseHash);

      // AC-H3-3 — ID 보존: 원래 의도가 원래 id로 존재하고 예문은 원상태다.
      const intentAfter = await editor<{ id: string; examples: string[] }>('GET', `/chatbots/${chatbotId}/intents/${intentId}`);
      expect(intentAfter.status).toBe(200);
      expect(intentAfter.body.id).toBe(intentId);
      expect(intentAfter.body.examples).toEqual(['환불 어떻게 하나요']);

      // AC-H3-4 — TC 실행 시 UNRESOLVED가 아니어야 한다(대상이 존재).
      const runRes = await editor<{ runId: string }>('POST', `/chatbots/${chatbotId}/test-sets/${setRes.body.id}/runs`, {
        overlaySource: 'NONE',
        useRag: false,
      });
      expect(runRes.status).toBe(202);
      let finalRun: { status: string; summary?: { a?: { unresolved: number } } } | undefined;
      for (let i = 0; i < 100; i += 1) {
        const poll = await editor<{ status: string; summary?: { a?: { unresolved: number } } }>('GET', `/chatbots/${chatbotId}/test-runs/${runRes.body.runId}`);
        if (poll.body.status === 'SUCCEEDED' || poll.body.status === 'FAILED') {
          finalRun = poll.body;
          break;
        }
        await new Promise((r) => setTimeout(r, 100));
      }
      expect(finalRun?.status).toBe('SUCCEEDED');
      expect(finalRun?.summary?.a?.unresolved ?? 0).toBe(0);
    }, 30_000);
  });

  describe('M-3: 복원 응답의 classifierDeleted는 실제 삭제 결과를 반영한다(AC-H3-13)', () => {
    it('IntentClassifierModel 행이 있는 챗봇을 복원하면 classifierDeleted:true다', async () => {
      const { id: chatbotId } = await createChatbot('분류기존재');
      await createIntent(chatbotId, '의도1');
      const saved = await editor<{ version: { id: string } }>('POST', `/chatbots/${chatbotId}/versions`, {});
      const versionId = saved.body.version.id;

      await prisma.intentClassifierModel.create({
        data: {
          chatbotId,
          modelId: 'test-model@1',
          dimension: 4,
          classIds: JSON.stringify(['c1']),
          weights: Buffer.from(new Float32Array([0, 0, 0, 0]).buffer).toString('base64'),
          bias: Buffer.from(new Float32Array([0]).buffer).toString('base64'),
          classCount: 1,
          sampleCount: 10,
          intentCountAtTrain: 1,
          exampleCountAtTrain: 10,
        },
      });

      await createIntent(chatbotId, '의도2'); // 되돌아갈 변경을 만든다.

      const preview = await editor<{ currentContentHash: string }>('POST', `/chatbots/${chatbotId}/versions/${versionId}/restore/preview`);
      const restore = await editor<{ classifierDeleted: boolean }>('POST', `/chatbots/${chatbotId}/versions/${versionId}/restore`, {
        expectedCurrentHash: preview.body.currentContentHash,
      });
      expect(restore.status).toBe(200);
      expect(restore.body.classifierDeleted).toBe(true);

      const remaining = await prisma.intentClassifierModel.findUnique({ where: { chatbotId } });
      expect(remaining).toBeNull();
    });

    it('IntentClassifierModel 행이 없는 챗봇을 복원하면 classifierDeleted:false다', async () => {
      const { id: chatbotId } = await createChatbot('분류기없음');
      await createIntent(chatbotId, '의도1');
      const saved = await editor<{ version: { id: string } }>('POST', `/chatbots/${chatbotId}/versions`, {});
      const versionId = saved.body.version.id;

      await createIntent(chatbotId, '의도2');

      const preview = await editor<{ currentContentHash: string }>('POST', `/chatbots/${chatbotId}/versions/${versionId}/restore/preview`);
      const restore = await editor<{ classifierDeleted: boolean }>('POST', `/chatbots/${chatbotId}/versions/${versionId}/restore`, {
        expectedCurrentHash: preview.body.currentContentHash,
      });
      expect(restore.status).toBe(200);
      expect(restore.body.classifierDeleted).toBe(false);
    });
  });

  describe('409 조건들', () => {
    it('RESTORE_NO_CHANGES — 현재와 동일한 버전으로 복원 시도하면 409다', async () => {
      const { id: chatbotId } = await createChatbot('변경없음');
      await createIntent(chatbotId, '의도1');
      const saved = await editor<{ version: { id: string } }>('POST', `/chatbots/${chatbotId}/versions`, {});
      const versionId = saved.body.version.id;

      const preview = await editor<{ currentContentHash: string }>('POST', `/chatbots/${chatbotId}/versions/${versionId}/restore/preview`);
      const res = await editor('POST', `/chatbots/${chatbotId}/versions/${versionId}/restore`, { expectedCurrentHash: preview.body.currentContentHash });
      expect(res.status).toBe(409);
      expect((res.body as { code: string }).code).toBe('RESTORE_NO_CHANGES');
    });

    it('RESTORE_PREVIEW_STALE — 미리보기 이후 다른 편집이 있으면 409다(S-5)', async () => {
      const { id: chatbotId } = await createChatbot('미리보기이후편집');
      await createIntent(chatbotId, '의도1');
      const saved = await editor<{ version: { id: string } }>('POST', `/chatbots/${chatbotId}/versions`, {});
      const versionId = saved.body.version.id;

      await createIntent(chatbotId, '의도2');
      const preview = await editor<{ currentContentHash: string }>('POST', `/chatbots/${chatbotId}/versions/${versionId}/restore/preview`);
      const staleHash = preview.body.currentContentHash;

      await createIntent(chatbotId, '의도3'); // 미리보기 이후 추가 편집

      const res = await editor('POST', `/chatbots/${chatbotId}/versions/${versionId}/restore`, { expectedCurrentHash: staleHash });
      expect(res.status).toBe(409);
      expect((res.body as { code: string }).code).toBe('RESTORE_PREVIEW_STALE');
    });

    it('CHATBOT_ARCHIVED — 미리보기는 200+blocker로 알리고, 확정은 409로 거부한다', async () => {
      const { id: chatbotId } = await createChatbot('보관챗봇');
      await createIntent(chatbotId, '의도1');
      const saved = await editor<{ version: { id: string } }>('POST', `/chatbots/${chatbotId}/versions`, {});
      const versionId = saved.body.version.id;
      await createIntent(chatbotId, '의도2'); // 복원 시 되돌아갈 변경을 만들어 둔다.

      const archiveRes = await editor('PATCH', `/chatbots/${chatbotId}/status`, { status: 'ARCHIVED' });
      expect(archiveRes.status).toBe(200);

      // 조회(미리보기)는 보관 챗봇도 허용한다 — blockers에 CHATBOT_ARCHIVED가 포함되고 restorable:false.
      const preview = await editor<{ blockers: Array<{ code: string }>; restorable: boolean; currentContentHash: string }>(
        'POST',
        `/chatbots/${chatbotId}/versions/${versionId}/restore/preview`,
      );
      expect(preview.status).toBe(200);
      expect(preview.body.blockers.some((b) => b.code === 'CHATBOT_ARCHIVED')).toBe(true);
      expect(preview.body.restorable).toBe(false);

      const confirm = await editor('POST', `/chatbots/${chatbotId}/versions/${versionId}/restore`, {
        expectedCurrentHash: preview.body.currentContentHash,
      });
      expect(confirm.status).toBe(409);
      expect((confirm.body as { code: string }).code).toBe('CHATBOT_ARCHIVED');
    });

    it('VERSION_PINNED_LIMIT_EXCEEDED · VERSION_PINNED — 고정 상한 초과와 고정 버전 삭제 거부', async () => {
      const { id: chatbotId } = await createChatbot('고정상한');
      const versionIds: string[] = [];
      for (let i = 0; i < 3; i += 1) {
        await createIntent(chatbotId, `의도${i}`);
        const saved = await editor<{ version: { id: string } }>('POST', `/chatbots/${chatbotId}/versions`, {});
        versionIds.push(saved.body.version.id);
      }

      const pin1 = await editor('PATCH', `/chatbots/${chatbotId}/versions/${versionIds[0]}`, { pinned: true });
      expect(pin1.status).toBe(200);
      const pin2 = await editor('PATCH', `/chatbots/${chatbotId}/versions/${versionIds[1]}`, { pinned: true });
      expect(pin2.status).toBe(200);

      // VERSION_PINNED_MAX=2 — 3번째 고정은 거부된다.
      const pin3 = await editor('PATCH', `/chatbots/${chatbotId}/versions/${versionIds[2]}`, { pinned: true });
      expect(pin3.status).toBe(409);
      expect((pin3.body as { code: string }).code).toBe('VERSION_PINNED_LIMIT_EXCEEDED');

      const del = await editor('DELETE', `/chatbots/${chatbotId}/versions/${versionIds[0]}`);
      expect(del.status).toBe(409);
      expect((del.body as { code: string }).code).toBe('VERSION_PINNED');
    });
  });

  describe('보존 정리', () => {
    it('AC-H1-8: 수동 보존 한도(3)를 넘으면 오래된 비고정 버전부터 정리된다', async () => {
      const { id: chatbotId } = await createChatbot('보존정리');
      const versionNos: number[] = [];
      for (let i = 0; i < 5; i += 1) {
        await createIntent(chatbotId, `보존의도${i}`);
        const saved = await editor<{ version: { versionNo: number } }>('POST', `/chatbots/${chatbotId}/versions`, {});
        versionNos.push(saved.body.version.versionNo);
      }

      const list = await editor<{ items: Array<{ versionNo: number }>; total: number }>('GET', `/chatbots/${chatbotId}/versions?pageSize=100`);
      // VERSION_RETENTION_MANUAL=3 — 최신 3건만 남는다(가장 최근 생성분 포함).
      expect(list.body.items.length).toBeLessThanOrEqual(3);
      const remainingNos = list.body.items.map((v) => v.versionNo).sort((a, b) => a - b);
      expect(remainingNos).toEqual(versionNos.slice(-3));
    });
  });

  describe('권한 AND', () => {
    it('dialogue:read만 있는 VIEWER는 복원 미리보기에서 403이다', async () => {
      const { id: chatbotId } = await createChatbot('권한검사');
      await createIntent(chatbotId, '의도1');
      const saved = await editor<{ version: { id: string } }>('POST', `/chatbots/${chatbotId}/versions`, {});

      const res = await viewer('POST', `/chatbots/${chatbotId}/versions/${saved.body.version.id}/restore/preview`);
      expect(res.status).toBe(403);
    });

    it('VIEWER는 목록 조회는 가능하다(dialogue:read)', async () => {
      const { id: chatbotId } = await createChatbot('조회권한');
      const res = await viewer('GET', `/chatbots/${chatbotId}/versions`);
      expect(res.status).toBe(200);
    });
  });

  describe('L-1: 교차 챗봇 ID 방어(§5.5 ⑤, FR-H3-11)', () => {
    it('다른 챗봇 소유의 id를 담은(비정상) 버전은 미리보기에서 INTEGRITY_FAILED 블로커로, 확정은 422로 거부된다', async () => {
      const { id: chatbotA } = await createChatbot('교차챗봇A');
      const intentAId = await createIntent(chatbotA, '챗봇A의도');

      const { id: chatbotB } = await createChatbot('교차챗봇B');

      // 정상 경로로는 만들 수 없는 상태를 직접 DB에 주입한다 — chatbotB의 스냅샷인데 intents[0].id가
      // chatbotA 소유의 실제 의도 id다.
      const envelope: SnapshotEnvelope = {
        schemaVersion: 1,
        capturedAt: new Date().toISOString(),
        chatbotId: chatbotB,
        assets: {
          intents: [{ id: intentAId, name: '위조된의도', examples: [], createdAt: new Date().toISOString() } as never],
          keywords: [],
          homonyms: [],
          dialogNodes: [],
          contexts: [],
          faqs: [],
        },
        answerSetting: null,
        profile: { name: '챗봇B', avatarUrl: null, description: null, skin: { primaryColor: '#4F46E5', headerTitle: 'h' } },
      };
      const contentHash = computeContentHash(envelope);
      const payload = serializeEnvelopeForStorage(envelope);

      await prisma.chatbotVersionSequence.upsert({
        where: { chatbotId: chatbotB },
        create: { chatbotId: chatbotB, lastVersionNo: 1 },
        update: { lastVersionNo: { increment: 1 } },
      });
      const versionRow = await prisma.chatbotVersion.create({
        data: {
          chatbotId: chatbotB,
          versionNo: 1,
          trigger: 'MANUAL',
          schemaVersion: 1,
          contentHash,
          counts: JSON.stringify({
            intents: 1,
            intentExamples: 0,
            keywords: 0,
            homonyms: 0,
            contexts: 0,
            dialogNodes: 0,
            nodeIntentLinks: 0,
            nodeKeywordLinks: 0,
            faqs: 0,
            answerSetting: 0,
          }),
          sizeBytes: Buffer.byteLength(payload, 'utf8'),
        },
      });
      await prisma.chatbotVersionPayload.create({ data: { versionId: versionRow.id, payload } });

      const preview = await editor<{ blockers: Array<{ code: string; violations?: Array<{ rule: string }> }> }>(
        'POST',
        `/chatbots/${chatbotB}/versions/${versionRow.id}/restore/preview`,
      );
      expect(preview.status).toBe(200);
      const blocker = preview.body.blockers.find((b) => b.code === 'INTEGRITY_FAILED');
      expect(blocker).toBeDefined();
      expect(blocker!.violations?.some((v) => v.rule === 'CROSS_CHATBOT_ID')).toBe(true);

      const confirm = await editor('POST', `/chatbots/${chatbotB}/versions/${versionRow.id}/restore`, {
        expectedCurrentHash: '0'.repeat(64),
      });
      expect(confirm.status).toBe(422);
      expect((confirm.body as { code: string }).code).toBe('VERSION_INTEGRITY_FAILED');
    });
  });


  describe('AC-H3-8: 트랜잭션 중간 실패 시 자산 불변(원자성) — applier §8.4 S1~S9 완료 직후 주입', () => {
    it('apply() 완료 후(사후 검증 이전) 오류를 주입하면 S1~S9 쓰기와 BEFORE_RESTORE 백업까지 전부 롤백된다', async () => {
      const { id: chatbotId } = await createChatbot('원자성검증');
      const intentId = await createIntent(chatbotId, '기준의도', ['샘플문장']);

      const saved = await editor<{ version: { id: string } }>('POST', `/chatbots/${chatbotId}/versions`, {});
      const baseVersionId = saved.body.version.id;

      // 되돌아갈 변경을 여러 종류 섞어 만든다 — 삭제 대상이 될 새 의도(S1~S4) + 수정 대상(S5) 둘 다 포함.
      await editor('PATCH', `/chatbots/${chatbotId}/intents/${intentId}/examples`, { add: ['추가예문'] });
      await createIntent(chatbotId, '새의도');

      const beforeIntents = await prisma.intent.findMany({ where: { chatbotId }, orderBy: { id: 'asc' } });
      const beforeVersionCount = await prisma.chatbotVersion.count({ where: { chatbotId } });

      const applier = app.get(VersionRestoreApplier, { strict: false });
      const originalApply = applier.apply.bind(applier);
      const applySpy = jest.spyOn(applier, 'apply').mockImplementationOnce(async (tx, cid, plan) => {
        // S1~S9 + 분류기 삭제까지 실제 트랜잭션 안에서 수행한 뒤, 커밋 전에 실패를 주입한다 —
        // 이 시점 이후 서비스의 '사후 검증'(§8.5)이 실행되기 전에 예외가 발생하므로 전체 트랜잭션이
        // 롤백된다(원자성). Prisma 인터랙티브 트랜잭션의 tx 클라이언트는 매 트랜잭션마다 새로 생성되어
        // 외부에서 개별 모델 메서드를 가로챌 수 없으므로, 실제 적용을 전부 수행한 뒤 실패를 주입하는
        // 이 방식이 블랙박스 통합 시험에서 재현 가능한 가장 충실한 '중간 실패' 시뮬레이션이다.
        await originalApply(tx, cid, plan);
        throw new Error('AC-H3-8 주입 오류 — apply() 완료 직후');
      });

      const preview = await editor<{ currentContentHash: string }>('POST', `/chatbots/${chatbotId}/versions/${baseVersionId}/restore/preview`);
      const restoreRes = await editor('POST', `/chatbots/${chatbotId}/versions/${baseVersionId}/restore`, {
        expectedCurrentHash: preview.body.currentContentHash,
      });

      applySpy.mockRestore();

      expect(restoreRes.status).toBe(500);
      expect((restoreRes.body as { code: string }).code).toBe('INTERNAL_ERROR');

      const afterIntents = await prisma.intent.findMany({ where: { chatbotId }, orderBy: { id: 'asc' } });
      expect(afterIntents.map((i) => ({ id: i.id, name: i.name, examples: i.examples }))).toEqual(
        beforeIntents.map((i) => ({ id: i.id, name: i.name, examples: i.examples })),
      );
      // BEFORE_RESTORE 백업도 같은 트랜잭션 안에서 생성되므로 실패 시 함께 롤백된다(AC-H3-8은 잔존을
      // '허용'할 뿐 '필수'로 요구하지 않는다 — §8.3 판단표) — 버전 테이블 행 수가 그대로다.
      const afterVersionCount = await prisma.chatbotVersion.count({ where: { chatbotId } });
      expect(afterVersionCount).toBe(beforeVersionCount);
    }, 30_000);
  });

  describe('자동 스냅샷 fail-open(EX-H-1, P-4) — 대표 경로 + bulk-delete 204 계약 불변(L-3)', () => {
    it('학습현황 일괄 반영 직전 캡처가 실패해도 본 동작은 성공하고 응답의 autoSnapshot.status는 FAILED다', async () => {
      const { id: chatbotId } = await createChatbot('failopen학습');
      const intentId = await createIntent(chatbotId, '반영대상의도', ['기존예문']);
      const question = await prisma.unansweredQuestion.create({
        data: { chatbotId, questionText: '반영될질문', questionNormalized: normalizeText('반영될질문') },
      });

      const captureService = app.get(VersionCaptureService, { strict: false });
      const captureSpy = jest.spyOn(captureService, 'captureSnapshotData').mockRejectedValueOnce(new Error('EX-H-1 주입 — 캡처 DB 오류 재현'));

      const res = await editor<{ autoSnapshot?: { status: string }; succeeded: number }>(
        'POST',
        `/chatbots/${chatbotId}/unanswered-questions/bulk-resolve`,
        { items: [{ id: question.id, intentId }] },
      );
      captureSpy.mockRestore();

      expect(res.status).toBe(200);
      expect(res.body.succeeded).toBe(1); // 본 동작은 계속 성공한다(fail-open, P-4)
      expect(res.body.autoSnapshot?.status).toBe('FAILED');

      // 캡처가 실패했으므로 BEFORE_LEARNING_BULK_APPLY 버전 행이 생기지 않았다.
      const list = await editor<{ items: Array<{ trigger: string }> }>('GET', `/chatbots/${chatbotId}/versions`);
      expect(list.body.items.some((v) => v.trigger === 'BEFORE_LEARNING_BULK_APPLY')).toBe(false);
    });

    it('의도 일괄 삭제는 캡처 실패에도 204를 유지한다(L-3, 본 동작 성공 불변)', async () => {
      const { id: chatbotId } = await createChatbot('failopen삭제');
      const intentId = await createIntent(chatbotId, '삭제될의도2');

      const captureService = app.get(VersionCaptureService, { strict: false });
      const captureSpy = jest.spyOn(captureService, 'captureSnapshotData').mockRejectedValueOnce(new Error('EX-H-1 주입'));

      const res = await editor('POST', `/chatbots/${chatbotId}/intents/bulk-delete`, { ids: [intentId] });
      captureSpy.mockRestore();

      expect(res.status).toBe(204); // 본 동작(204) 계약 불변 — L-3, D-7
      const check = await editor('GET', `/chatbots/${chatbotId}/intents/${intentId}`);
      expect(check.status).toBe(404); // 삭제 자체는 실제로 수행됨(fail-open)

      const list = await editor<{ items: Array<{ trigger: string }> }>('GET', `/chatbots/${chatbotId}/versions`);
      expect(list.body.items.some((v) => v.trigger === 'BEFORE_BULK_DELETE')).toBe(false);
    });
  });

  describe('권한 — VIEWER 403 전수(AC-H4-3, gap 7)', () => {
    it('VIEWER는 수동 버전 저장에서 403이고 DB에 행이 생기지 않는다', async () => {
      const { id: chatbotId } = await createChatbot('뷰어생성차단');
      const res = await viewer('POST', `/chatbots/${chatbotId}/versions`, { label: '시도' });
      expect(res.status).toBe(403);

      const list = await editor<{ items: unknown[] }>('GET', `/chatbots/${chatbotId}/versions`);
      expect(list.body.items).toEqual([]);
    });

    it('VIEWER는 라벨 수정·삭제·복원 확정에서 전부 403이고 자산은 변경되지 않는다', async () => {
      const { id: chatbotId } = await createChatbot('뷰어수정차단');
      await createIntent(chatbotId, '의도1');
      const saved = await editor<{ version: { id: string } }>('POST', `/chatbots/${chatbotId}/versions`, {});
      const versionId = saved.body.version.id;
      await createIntent(chatbotId, '의도2');

      const beforeHash = (await editor<{ contentHash: string }>('GET', `/chatbots/${chatbotId}/versions/current`)).body.contentHash;

      const patchRes = await viewer('PATCH', `/chatbots/${chatbotId}/versions/${versionId}`, { label: '시도' });
      expect(patchRes.status).toBe(403);

      const deleteRes = await viewer('DELETE', `/chatbots/${chatbotId}/versions/${versionId}`);
      expect(deleteRes.status).toBe(403);

      const preview = await editor<{ currentContentHash: string }>('POST', `/chatbots/${chatbotId}/versions/${versionId}/restore/preview`);
      const restoreRes = await viewer('POST', `/chatbots/${chatbotId}/versions/${versionId}/restore`, {
        expectedCurrentHash: preview.body.currentContentHash,
      });
      expect(restoreRes.status).toBe(403);

      // DB 변경 없음 — 현재 해시가 그대로다(복원되지 않았고, 라벨도 바뀌지 않았고, 버전도 삭제되지 않았다).
      const afterHash = (await editor<{ contentHash: string }>('GET', `/chatbots/${chatbotId}/versions/current`)).body.contentHash;
      expect(afterHash).toBe(beforeHash);
      const stillThere = await editor('GET', `/chatbots/${chatbotId}/versions/${versionId}`);
      expect(stillThere.status).toBe(200);
    });
  });
});
