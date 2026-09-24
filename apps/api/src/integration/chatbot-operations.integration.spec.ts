import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import * as http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { INestApplication, VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  ApiErrorSchema,
  ChatbotGroupWithCountSchema,
  ChatbotSchema,
  DashboardSummarySchema,
  EmbedCodeSchema,
} from '@chat-bot/shared-types';
import { AppModule } from '../app.module';
import { AllExceptionsFilter } from '../common/all-exceptions.filter';
import { PrismaService } from '../prisma/prisma.service';
import { loginAs, seedTestUsers } from './helpers/auth.helper';

// apps/api 루트(이 파일 기준 src/integration/../.. = apps/api)
const API_ROOT = join(__dirname, '..', '..');

interface ApiResponse<T = unknown> {
  status: number;
  body: T;
}

// No.12 전역 가드 도입 이후 전 요청에 인증 쿠키가 필요하다(NFR-M4). beforeAll에서 로그인해 채운다.
let authCookie = '';

function request<T = unknown>(method: string, url: string, body?: unknown): Promise<ApiResponse<T>> {
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
          ...(authCookie ? { Cookie: authCookie } : {}),
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
          resolve({ status: res.statusCode ?? 0, body: parsed as T });
        });
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

/**
 * 챗봇 운영관리(No.1~4) 계약 테스트(AC-5-1). 실제 NestJS 앱을 임시 SQLite DB에 띄워
 * 주요 엔드포인트의 상태코드·오류코드·응답 스키마 정합성을 검증한다.
 * 전체 19개 엔드포인트/AC 전 항목의 소진적 검증은 test-automation 단계에서 확장한다.
 */
describe('챗봇 운영관리 통합 테스트 (No.1~4)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let tmpDir: string;
  let prisma: PrismaService;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'chatbot-api-test-'));
    const dbPath = join(tmpDir, 'test.db').replace(/\\/g, '/');
    const testDatabaseUrl = `file:${dbPath}`;

    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.DEPLOY_SCHEDULE_ENABLED = 'false'; // [No.28] 실행 엔진 비활성 — 기존 그룹 통합 시험은 폴링 없이 수행(§7.10)
    process.env.WIDGET_BASE_URL = process.env.WIDGET_BASE_URL ?? 'http://localhost:5174';
    process.env.PUBLIC_API_BASE_URL = process.env.PUBLIC_API_BASE_URL ?? 'http://localhost:3000/api/v1';

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

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
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
    authCookie = await loginAs(baseUrl, 'ADMIN');
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  async function createGroup(name = '테스트 그룹'): Promise<string> {
    const res = await request<Record<string, unknown>>('POST', `${baseUrl}/chatbot-groups`, { name });
    return res.body.id as string;
  }

  async function createChatbot(groupId: string, overrides: Partial<{ name: string; slug: string }> = {}) {
    const suffix = Math.random().toString(36).slice(2, 8);
    return request<Record<string, unknown>>('POST', `${baseUrl}/chatbots`, {
      groupId,
      name: overrides.name ?? '테스트 챗봇',
      slug: overrides.slug ?? `test-bot-${suffix}`,
    });
  }

  it('AC-1-1: 그룹 생성 시 201과 chatbotCount:0을 반환한다', async () => {
    const res = await request('POST', `${baseUrl}/chatbot-groups`, { name: '고객지원 그룹' });
    expect(res.status).toBe(201);
    const parsed = ChatbotGroupWithCountSchema.parse(res.body);
    expect(parsed.chatbotCount).toBe(0);
  });

  it('AC-1-2: 챗봇 생성 시 status는 DRAFT, skin은 기본값으로 초기화된다', async () => {
    const groupId = await createGroup();
    const res = await createChatbot(groupId, { name: '주문봇', slug: `order-bot-${Date.now()}` });
    expect(res.status).toBe(201);
    const parsed = ChatbotSchema.parse(res.body);
    expect(parsed.status).toBe('DRAFT');
    expect(parsed.skin).toEqual({ primaryColor: '#4F46E5', headerTitle: '챗봇 상담' });
  });

  it('AC-1-3: 중복 slug 생성 시 409 DUPLICATE_SLUG를 반환하고 신규 레코드를 만들지 않는다', async () => {
    const groupId = await createGroup();
    const slug = `dup-bot-${Date.now()}`;
    const first = await createChatbot(groupId, { slug });
    expect(first.status).toBe(201);

    const second = await createChatbot(groupId, { slug });
    expect(second.status).toBe(409);
    const err = ApiErrorSchema.parse(second.body);
    expect(err.code).toBe('DUPLICATE_SLUG');
  });

  it('AC-1-4: slug 형식 위반 시 409가 아니라 400과 field:"slug" 오류를 반환한다', async () => {
    const groupId = await createGroup();
    const res = await request('POST', `${baseUrl}/chatbots`, {
      groupId,
      name: '형식위반봇',
      slug: 'Order_Bot!',
    });
    expect(res.status).toBe(400);
    const err = ApiErrorSchema.parse(res.body);
    expect(err.code).toBe('VALIDATION_FAILED');
    expect(err.details?.some((d) => d.field === 'slug')).toBe(true);
  });

  it('EX-1-6: 존재하지 않는 groupId로 챗봇 생성 시 404를 반환한다', async () => {
    const res = await request('POST', `${baseUrl}/chatbots`, {
      groupId: '00000000-0000-0000-0000-000000000000',
      name: '없는그룹봇',
      slug: `no-group-bot-${Date.now()}`,
    });
    expect(res.status).toBe(404);
    expect(ApiErrorSchema.parse(res.body).code).toBe('NOT_FOUND');
  });

  it('AC-1-5: 소속 챗봇이 있는 그룹 삭제는 409 GROUP_NOT_EMPTY를 반환하고 보존한다', async () => {
    const groupId = await createGroup();
    await createChatbot(groupId);

    const res = await request('DELETE', `${baseUrl}/chatbot-groups/${groupId}`);
    expect(res.status).toBe(409);
    expect(ApiErrorSchema.parse(res.body).code).toBe('GROUP_NOT_EMPTY');

    const stillThere = await request('GET', `${baseUrl}/chatbot-groups/${groupId}`);
    expect(stillThere.status).toBe(200);
  });

  it('AC-1-6/EX-1-4: 빈 그룹 삭제는 204를 반환한다', async () => {
    const groupId = await createGroup();
    const res = await request('DELETE', `${baseUrl}/chatbot-groups/${groupId}`);
    expect(res.status).toBe(204);

    const gone = await request('GET', `${baseUrl}/chatbot-groups/${groupId}`);
    expect(gone.status).toBe(404);
  });

  it('AC-1-7/AC-1-8: 챗봇 복사는 이름/slug를 파생하고, 재복사 시 -copy-2로 증가한다', async () => {
    const groupId = await createGroup();
    const slug = `order-bot-${Date.now()}`;
    const original = await createChatbot(groupId, { name: '주문봇', slug });
    const originalId = (original.body as { id: string }).id;

    const firstCopy = await request<Record<string, unknown>>('POST', `${baseUrl}/chatbots/${originalId}/copy`, {});
    expect(firstCopy.status).toBe(201);
    expect(firstCopy.body.name).toBe('주문봇 (사본)');
    expect(firstCopy.body.slug).toBe(`${slug}-copy`);
    expect(firstCopy.body.status).toBe('DRAFT');

    const secondCopy = await request<Record<string, unknown>>('POST', `${baseUrl}/chatbots/${originalId}/copy`, {});
    expect(secondCopy.status).toBe(201);
    expect(secondCopy.body.slug).toBe(`${slug}-copy-2`);
  });

  it('AC-1-9: 그룹 복사는 새 그룹을 만들고 소속 챗봇 전부를 FR-1-13 규칙대로 복제한다', async () => {
    const groupId = await createGroup('원본 그룹');
    const seeds: Array<{ name: string; slugPrefix: string }> = [
      { name: '챗봇A', slugPrefix: 'chatbot-a' },
      { name: '챗봇B', slugPrefix: 'chatbot-b' },
      { name: '챗봇C', slugPrefix: 'chatbot-c' },
    ];
    for (const seed of seeds) {
      const res = await createChatbot(groupId, {
        name: seed.name,
        slug: `${seed.slugPrefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      });
      expect(res.status).toBe(201);
    }

    const copyRes = await request<Record<string, unknown>>('POST', `${baseUrl}/chatbot-groups/${groupId}/copy`, {});
    expect(copyRes.status).toBe(201);
    const newGroup = ChatbotGroupWithCountSchema.parse(copyRes.body);
    expect(newGroup.name).toBe('원본 그룹 (사본)');
    expect(newGroup.chatbotCount).toBe(3);

    const listRes = await request<{ items: unknown[] }>(
      'GET',
      `${baseUrl}/chatbots?groupId=${newGroup.id}&status=DRAFT,ACTIVE,ARCHIVED&pageSize=100`,
    );
    expect(listRes.status).toBe(200);
    expect(listRes.body.items).toHaveLength(3);
    for (const item of listRes.body.items as Array<Record<string, unknown>>) {
      expect(item.status).toBe('DRAFT');
    }
  });

  it('AC-1-10: 챗봇 보관(DELETE)은 status를 ARCHIVED로 전환하고 기본 목록 필터에서 제외되며 "보관됨 포함" 조회 시 다시 보인다', async () => {
    const groupId = await createGroup();
    const created = await createChatbot(groupId);
    const id = (created.body as { id: string }).id;

    const archiveRes = await request('DELETE', `${baseUrl}/chatbots/${id}`);
    expect(archiveRes.status).toBe(204);

    const afterArchive = await request<Record<string, unknown>>('GET', `${baseUrl}/chatbots/${id}`);
    expect((afterArchive.body as { status: string }).status).toBe('ARCHIVED');

    // FR-1-10: 기본 필터(status=DRAFT,ACTIVE)에서는 보이지 않는다.
    const defaultList = await request<{ items: Array<{ id: string }> }>(
      'GET',
      `${baseUrl}/chatbots?groupId=${groupId}&status=DRAFT,ACTIVE&pageSize=100`,
    );
    expect(defaultList.body.items.some((i) => i.id === id)).toBe(false);

    // "보관됨 포함" 필터로는 다시 보인다.
    const withArchived = await request<{ items: Array<{ id: string }> }>(
      'GET',
      `${baseUrl}/chatbots?groupId=${groupId}&status=DRAFT,ACTIVE,ARCHIVED&pageSize=100`,
    );
    expect(withArchived.body.items.some((i) => i.id === id)).toBe(true);
  });

  it('AC-1-11: ConversationLog가 남아있는 ARCHIVED 챗봇의 영구 삭제는 409 CHATBOT_HAS_CHILDREN을 반환하고 보존한다', async () => {
    const groupId = await createGroup();
    const created = await createChatbot(groupId, { name: '로그보유챗봇' });
    const id = (created.body as { id: string }).id;
    await prisma.conversationLog.create({
      data: {
        chatbotId: id,
        channelType: 'WEB',
        userMessage: '배송 조회',
        botResponse: '배송 조회 결과입니다.',
        isAnswered: true,
      },
    });
    await request('PATCH', `${baseUrl}/chatbots/${id}/status`, { status: 'ARCHIVED' });

    const res = await request('POST', `${baseUrl}/chatbots/${id}/permanent-delete`, { confirmName: '로그보유챗봇' });
    expect(res.status).toBe(409);
    expect(ApiErrorSchema.parse(res.body).code).toBe('CHATBOT_HAS_CHILDREN');

    const stillThere = await request('GET', `${baseUrl}/chatbots/${id}`);
    expect(stillThere.status).toBe(200);
  });

  it('AC-1-13: ARCHIVED에서 ACTIVE로 직접 전환은 400, DRAFT로 전환은 200이다', async () => {
    const groupId = await createGroup();
    const created = await createChatbot(groupId);
    const id = (created.body as { id: string }).id;

    const archived = await request('PATCH', `${baseUrl}/chatbots/${id}/status`, { status: 'ARCHIVED' });
    expect(archived.status).toBe(200);

    const toActive = await request('PATCH', `${baseUrl}/chatbots/${id}/status`, { status: 'ACTIVE' });
    expect(toActive.status).toBe(400);
    expect(ApiErrorSchema.parse(toActive.body).code).toBe('INVALID_STATUS_TRANSITION');

    const toDraft = await request('PATCH', `${baseUrl}/chatbots/${id}/status`, { status: 'DRAFT' });
    expect(toDraft.status).toBe(200);
  });

  it('AC-1-14: pageSize=20으로 챗봇 30개를 조회하면 1페이지 20건/total 30, 2페이지에 나머지 10건이 반환된다', async () => {
    const groupId = await createGroup('페이지네이션 그룹');
    for (let i = 0; i < 30; i += 1) {
      const res = await createChatbot(groupId, {
        name: `페이지봇${i}`,
        slug: `page-bot-${Date.now()}-${i}`,
      });
      expect(res.status).toBe(201);
    }

    const page1 = await request<{ items: unknown[]; total: number; page: number }>(
      'GET',
      `${baseUrl}/chatbots?groupId=${groupId}&status=DRAFT,ACTIVE&pageSize=20&page=1`,
    );
    expect(page1.body.items).toHaveLength(20);
    expect(page1.body.total).toBe(30);
    expect(page1.body.page).toBe(1);

    const page2 = await request<{ items: unknown[]; total: number; page: number }>(
      'GET',
      `${baseUrl}/chatbots?groupId=${groupId}&status=DRAFT,ACTIVE&pageSize=20&page=2`,
    );
    expect(page2.body.items).toHaveLength(10);
    expect(page2.body.total).toBe(30);
  });

  it('AC-1-15: q="주문"으로 검색하면 이름에 "주문"을 포함한 챗봇만 반환된다', async () => {
    const groupId = await createGroup('검색 그룹');
    await createChatbot(groupId, { name: '주문 상담봇', slug: `order-a-${Date.now()}` });
    await createChatbot(groupId, { name: '주문 취소봇', slug: `order-b-${Date.now()}` });
    await createChatbot(groupId, { name: '환불 상담봇', slug: `refund-${Date.now()}` });

    const res = await request<{ items: Array<{ name: string }>; total: number }>(
      'GET',
      `${baseUrl}/chatbots?groupId=${groupId}&status=DRAFT,ACTIVE&q=${encodeURIComponent('주문')}&pageSize=100`,
    );
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    expect(res.body.items.every((i) => i.name.includes('주문'))).toBe(true);
  });

  it('AC-1-16: 존재하지 않는 groupId로 그룹 이동을 요청하면 404를 반환한다', async () => {
    const groupId = await createGroup();
    const created = await createChatbot(groupId);
    const id = (created.body as { id: string }).id;

    const res = await request('PATCH', `${baseUrl}/chatbots/${id}/group`, {
      groupId: '00000000-0000-0000-0000-000000000000',
    });
    expect(res.status).toBe(404);
    expect(ApiErrorSchema.parse(res.body).code).toBe('NOT_FOUND');
  });

  it('EX-1-8: ARCHIVED 챗봇의 기본설정 수정은 409 CHATBOT_ARCHIVED를 반환한다', async () => {
    const groupId = await createGroup();
    const created = await createChatbot(groupId);
    const id = (created.body as { id: string }).id;
    await request('PATCH', `${baseUrl}/chatbots/${id}/status`, { status: 'ARCHIVED' });

    const res = await request('PATCH', `${baseUrl}/chatbots/${id}/settings`, { name: '수정 시도' });
    expect(res.status).toBe(409);
    expect(ApiErrorSchema.parse(res.body).code).toBe('CHATBOT_ARCHIVED');
  });

  it('AC-1-11: ARCHIVED가 아닌 챗봇의 영구 삭제는 409 CHATBOT_NOT_ARCHIVED를 반환한다', async () => {
    const groupId = await createGroup();
    const created = await createChatbot(groupId, { name: '영구삭제대상' });
    const id = (created.body as { id: string }).id;

    const res = await request('POST', `${baseUrl}/chatbots/${id}/permanent-delete`, { confirmName: '영구삭제대상' });
    expect(res.status).toBe(409);
    expect(ApiErrorSchema.parse(res.body).code).toBe('CHATBOT_NOT_ARCHIVED');
  });

  it('영구 삭제 시 confirmName이 일치하지 않으면 400 CONFIRM_NAME_MISMATCH를 반환한다', async () => {
    const groupId = await createGroup();
    const created = await createChatbot(groupId, { name: '이름확인대상' });
    const id = (created.body as { id: string }).id;
    await request('PATCH', `${baseUrl}/chatbots/${id}/status`, { status: 'ARCHIVED' });

    const res = await request('POST', `${baseUrl}/chatbots/${id}/permanent-delete`, { confirmName: '다른이름' });
    expect(res.status).toBe(400);
    expect(ApiErrorSchema.parse(res.body).code).toBe('CONFIRM_NAME_MISMATCH');
  });

  it('회귀: FAQ/RAG 그룹(임베딩 벡터·RAG 호출로그)과 학습 고도화 그룹(증강 제안·분류기 모델·학습 Job) 파생 데이터가 있어도 영구 삭제가 FK 제약 위반 없이 성공한다', async () => {
    const groupId = await createGroup();
    const created = await createChatbot(groupId, { name: '파생데이터보유챗봇' });
    const id = (created.body as { id: string }).id;

    // FAQ/의도 매칭 고도화 그룹 파생 데이터(Chatbot에 onDelete: Restrict FK).
    await prisma.embeddingVector.create({
      data: {
        chatbotId: id,
        ownerType: 'INTENT_NAME',
        ownerId: 'fake-intent-id',
        textHash: 'hash',
        modelId: 'test-model',
        dimension: 2,
        vector: Buffer.from(new Float32Array([1, 0]).buffer).toString('base64'),
        status: 'READY',
      },
    });
    await prisma.ragCallLog.create({
      data: { chatbotId: id, outcome: 'SUCCESS', latencyMs: 120 },
    });

    // 학습 고도화 그룹(No.16/23) 파생 데이터(Chatbot에 onDelete: Restrict FK) — 이 3종을 지우지 않으면
    // Prisma FK 제약 위반으로 영구 삭제가 500으로 실패한다(회귀 대상 버그).
    await prisma.augmentationSuggestion.create({
      data: {
        chatbotId: id,
        intentId: 'fake-intent-id',
        text: '증강 예문',
        textNormalized: '증강예문',
        similarityToSeed: 0.9,
        providerId: 'mock',
        modelId: 'test-model',
      },
    });
    await prisma.intentClassifierModel.create({
      data: {
        chatbotId: id,
        modelId: 'test-model',
        dimension: 2,
        classIds: JSON.stringify(['fake-intent-id']),
        weights: Buffer.from(new Float32Array([0, 0]).buffer).toString('base64'),
        bias: Buffer.from(new Float32Array([0]).buffer).toString('base64'),
        classCount: 1,
        sampleCount: 10,
        intentCountAtTrain: 1,
        exampleCountAtTrain: 10,
      },
    });
    await prisma.trainingJob.create({
      data: { chatbotId: id, kind: 'CLASSIFIER_TRAIN', status: 'SUCCEEDED' },
    });

    await request('PATCH', `${baseUrl}/chatbots/${id}/status`, { status: 'ARCHIVED' });

    const res = await request('POST', `${baseUrl}/chatbots/${id}/permanent-delete`, { confirmName: '파생데이터보유챗봇' });
    expect(res.status).toBe(204);

    const gone = await request('GET', `${baseUrl}/chatbots/${id}`);
    expect(gone.status).toBe(404);

    expect(await prisma.embeddingVector.count({ where: { chatbotId: id } })).toBe(0);
    expect(await prisma.ragCallLog.count({ where: { chatbotId: id } })).toBe(0);
    expect(await prisma.augmentationSuggestion.count({ where: { chatbotId: id } })).toBe(0);
    expect(await prisma.intentClassifierModel.count({ where: { chatbotId: id } })).toBe(0);
    expect(await prisma.trainingJob.count({ where: { chatbotId: id } })).toBe(0);
  });

  it('AC-3-1: name만 부분 수정하면 slug/skin/status는 보존된다', async () => {
    const groupId = await createGroup();
    const slug = `preserve-bot-${Date.now()}`;
    const created = await createChatbot(groupId, { name: '원래이름', slug });
    const id = (created.body as { id: string }).id;

    const res = await request<Record<string, unknown>>('PATCH', `${baseUrl}/chatbots/${id}/settings`, { name: '변경된이름' });
    expect(res.status).toBe(200);
    const parsed = ChatbotSchema.parse(res.body);
    expect(parsed.name).toBe('변경된이름');
    expect(parsed.slug).toBe(slug);
    expect(parsed.status).toBe('DRAFT');
    expect(parsed.skin).toEqual({ primaryColor: '#4F46E5', headerTitle: '챗봇 상담' });
  });

  it('AC-3-2: name을 빈 문자열로 PATCH하면 400과 field:"name" 오류를 반환한다', async () => {
    const groupId = await createGroup();
    const created = await createChatbot(groupId);
    const id = (created.body as { id: string }).id;

    const res = await request('PATCH', `${baseUrl}/chatbots/${id}/settings`, { name: '' });
    expect(res.status).toBe(400);
    const err = ApiErrorSchema.parse(res.body);
    expect(err.code).toBe('VALIDATION_FAILED');
    expect(err.details?.some((d) => d.field === 'name')).toBe(true);
  });

  it('AC-3-3: description을 501자로 PATCH하면 400을 반환한다', async () => {
    const groupId = await createGroup();
    const created = await createChatbot(groupId);
    const id = (created.body as { id: string }).id;

    const res = await request('PATCH', `${baseUrl}/chatbots/${id}/settings`, { description: 'a'.repeat(501) });
    expect(res.status).toBe(400);
    const err = ApiErrorSchema.parse(res.body);
    expect(err.details?.some((d) => d.field === 'description')).toBe(true);
  });

  it('AC-3-4/NFR-S3: avatarUrl에 javascript: 스킴을 PATCH하면 400을 반환한다', async () => {
    const groupId = await createGroup();
    const created = await createChatbot(groupId);
    const id = (created.body as { id: string }).id;

    const res = await request('PATCH', `${baseUrl}/chatbots/${id}/settings`, { avatarUrl: 'javascript:alert(1)' });
    expect(res.status).toBe(400);
    const err = ApiErrorSchema.parse(res.body);
    expect(err.details?.some((d) => d.field === 'avatarUrl')).toBe(true);
  });

  it('AC-3-5: slug에 예약어 "admin"을 PATCH하면 400과 예약어 안내를 반환한다', async () => {
    const groupId = await createGroup();
    const created = await createChatbot(groupId);
    const id = (created.body as { id: string }).id;

    const res = await request('PATCH', `${baseUrl}/chatbots/${id}/settings`, { slug: 'admin' });
    expect(res.status).toBe(400);
    const err = ApiErrorSchema.parse(res.body);
    expect(err.details?.some((d) => d.field === 'slug' && d.message.includes('예약어'))).toBe(true);
  });

  it('AC-4-2: primaryColor 형식 위반(#GGGGGG)으로 스킨을 PATCH하면 400을 반환한다', async () => {
    const groupId = await createGroup();
    const created = await createChatbot(groupId);
    const id = (created.body as { id: string }).id;

    const res = await request('PATCH', `${baseUrl}/chatbots/${id}/skin`, { primaryColor: '#GGGGGG' });
    expect(res.status).toBe(400);
    const err = ApiErrorSchema.parse(res.body);
    expect(err.details?.some((d) => d.field === 'primaryColor')).toBe(true);
  });

  it('AC-4-4: headerTitle을 51자로 PATCH하면 400을 반환한다', async () => {
    const groupId = await createGroup();
    const created = await createChatbot(groupId);
    const id = (created.body as { id: string }).id;

    const res = await request('PATCH', `${baseUrl}/chatbots/${id}/skin`, { headerTitle: 'a'.repeat(51) });
    expect(res.status).toBe(400);
    const err = ApiErrorSchema.parse(res.body);
    expect(err.details?.some((d) => d.field === 'headerTitle')).toBe(true);
  });

  it('AC-4-5: 스킨 저장 후 재조회하면 skin이 저장값과 일치하는 객체 형태로 반환된다', async () => {
    const groupId = await createGroup();
    const created = await createChatbot(groupId);
    const id = (created.body as { id: string }).id;

    const updateRes = await request('PATCH', `${baseUrl}/chatbots/${id}/skin`, {
      primaryColor: '#0F62FE',
      headerTitle: '고객센터',
    });
    expect(updateRes.status).toBe(200);

    const refetch = await request<Record<string, unknown>>('GET', `${baseUrl}/chatbots/${id}`);
    const parsed = ChatbotSchema.parse(refetch.body);
    expect(typeof parsed.skin).toBe('object');
    expect(parsed.skin).toEqual({ primaryColor: '#0F62FE', headerTitle: '고객센터' });
  });

  it('AC-4-9/FR-4-13: slug 변경 후 임베드 코드를 다시 조회하면 새 slug가 반영된다(조회 시점 생성)', async () => {
    const groupId = await createGroup();
    const oldSlug = `order-bot-${Date.now()}`;
    const created = await createChatbot(groupId, { slug: oldSlug });
    const id = (created.body as { id: string }).id;

    const beforeEmbed = await request<Record<string, string>>('GET', `${baseUrl}/chatbots/${id}/embed-code`);
    expect(beforeEmbed.body.pc).toContain(oldSlug);

    const newSlug = `order-bot-v2-${Date.now()}`;
    const patchRes = await request('PATCH', `${baseUrl}/chatbots/${id}/settings`, { slug: newSlug });
    expect(patchRes.status).toBe(200);

    const afterEmbed = await request<Record<string, string>>('GET', `${baseUrl}/chatbots/${id}/embed-code`);
    expect(afterEmbed.status).toBe(200);
    const embed = EmbedCodeSchema.parse(afterEmbed.body);
    expect(embed.pc).toContain(newSlug);
    expect(embed.mobile).toContain(newSlug);
    expect(embed.publicUrl).toContain(newSlug);
    expect(embed.pc).not.toContain(oldSlug);
  });

  it('AC-2-5/AC-2-9: 로그 0건 챗봇은 200과 0값을, 존재하지 않는 챗봇은 404를 반환한다', async () => {
    const groupId = await createGroup();
    const created = await createChatbot(groupId);
    const id = (created.body as { id: string }).id;

    const res = await request('GET', `${baseUrl}/stats/dashboard?chatbotId=${id}`);
    expect(res.status).toBe(200);
    const summary = DashboardSummarySchema.parse(res.body);
    expect(summary.visitCount).toBe(0);
    expect(summary.responseRate).toBe(0);
    expect(summary.noResponseRate).toBe(0);
    expect(summary.topQuestions).toEqual([]);

    const notFound = await request(
      'GET',
      `${baseUrl}/stats/dashboard?chatbotId=00000000-0000-0000-0000-000000000000`,
    );
    expect(notFound.status).toBe(404);
  });

  it('AC-2-10: ARCHIVED 챗봇도 대시보드 조회는 200으로 허용된다(누적 지표 보존)', async () => {
    const groupId = await createGroup();
    const created = await createChatbot(groupId, { name: '보관대시보드봇' });
    const id = (created.body as { id: string }).id;
    await prisma.conversationLog.create({
      data: {
        chatbotId: id,
        channelType: 'WEB',
        userMessage: '영업시간 문의',
        botResponse: '평일 09:00~18:00입니다.',
        isAnswered: true,
      },
    });
    await request('PATCH', `${baseUrl}/chatbots/${id}/status`, { status: 'ARCHIVED' });

    const res = await request('GET', `${baseUrl}/stats/dashboard?chatbotId=${id}`);
    expect(res.status).toBe(200);
    const summary = DashboardSummarySchema.parse(res.body);
    expect(summary.totalLogCount).toBeGreaterThanOrEqual(1);
  });

  it('FR-2-8/AC-2-8: from이 to보다 늦으면 400 INVALID_PERIOD를 반환한다', async () => {
    const groupId = await createGroup();
    const created = await createChatbot(groupId);
    const id = (created.body as { id: string }).id;

    const res = await request(
      'GET',
      `${baseUrl}/stats/dashboard?chatbotId=${id}&from=2026-02-01&to=2026-01-01`,
    );
    expect(res.status).toBe(400);
    expect(ApiErrorSchema.parse(res.body).code).toBe('INVALID_PERIOD');
  });

  it('AC-4-7/FR-4-9: 임베드 코드는 PC/모바일 스니펫과 slug를 포함한다', async () => {
    const groupId = await createGroup();
    const slug = `embed-bot-${Date.now()}`;
    const created = await createChatbot(groupId, { slug });
    const id = (created.body as { id: string }).id;

    const res = await request('GET', `${baseUrl}/chatbots/${id}/embed-code`);
    expect(res.status).toBe(200);
    const embed = EmbedCodeSchema.parse(res.body);
    expect(embed.pc).toContain(slug);
    expect(embed.mobile).toContain(slug);
    expect(embed.publicUrl).toContain(slug);
  });

  it('FR-3-7: slug-available은 형식 위반/예약어/중복을 각각 reason으로 구분해 200으로 반환한다', async () => {
    const groupId = await createGroup();
    const slug = `avail-bot-${Date.now()}`;
    await createChatbot(groupId, { slug });

    const takenRes = await request('GET', `${baseUrl}/chatbots/slug-available?slug=${slug}`);
    expect(takenRes.status).toBe(200);
    expect((takenRes.body as { available: boolean }).available).toBe(false);
    expect((takenRes.body as { reason?: string }).reason).toBe('TAKEN');

    const reservedRes = await request('GET', `${baseUrl}/chatbots/slug-available?slug=admin`);
    expect((reservedRes.body as { reason?: string }).reason).toBe('RESERVED');

    const formatRes = await request('GET', `${baseUrl}/chatbots/slug-available?slug=AB`);
    expect((formatRes.body as { reason?: string }).reason).toBe('FORMAT');

    const freeRes = await request('GET', `${baseUrl}/chatbots/slug-available?slug=brand-new-slug-${Date.now()}`);
    expect((freeRes.body as { available: boolean }).available).toBe(true);
  });
});
