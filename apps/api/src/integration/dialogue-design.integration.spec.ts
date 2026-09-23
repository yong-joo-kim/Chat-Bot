import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import * as http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { INestApplication, VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  ApiErrorSchema,
  ChatbotSchema,
  DesignValidationReportSchema,
  FlowTreeSchema,
  HomonymDictionarySchema,
  ImportCommitResultSchema,
  ImportValidateResultSchema,
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

function jsonRequest<T = unknown>(method: string, url: string, body?: unknown): Promise<ApiResponse<T>> {
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
 * 대량 업로드 검증/커밋 엔드포인트는 `FileInterceptor`(multipart/form-data)를 쓰므로 `fetch`+`FormData`로
 * 파일을 첨부해 호출한다(Node 18+ 내장 fetch, 별도 의존성 추가 없음).
 */
async function uploadCsv<T = unknown>(url: string, filename: string, csvContent: string): Promise<ApiResponse<T>> {
  const form = new FormData();
  const blob = new Blob([csvContent], { type: 'text/csv' });
  form.append('file', blob, filename);
  const res = await fetch(url, { method: 'POST', body: form, headers: authCookie ? { Cookie: authCookie } : undefined });
  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : undefined;
  } catch {
    parsed = text;
  }
  return { status: res.status, body: parsed as T };
}

const BOM = '﻿';
function csv(headers: string[], rows: string[][]): string {
  return BOM + [headers, ...rows].map((r) => r.join(',')).join('\r\n') + '\r\n';
}

/**
 * 대화 설계(No.5~9) 통합 테스트. `docs/requirements/dialogue-design.md` §7(AC)/§8(EX) 중
 * 순수 함수 단위시험으로 커버되지 않는 HTTP 계약 레벨 항목을 다룬다.
 * H1/H2(삭제차단 배너 참조종류) 검증은 `reference-check.service.ts`가 던지는 메시지 문구가
 * `apps/web`의 `resolveBlockedRefKind`가 기대하는 문구("동음이의어"/"컨텍스트")와 실제로 일치하는지를
 * 서버 응답 메시지 자체로 검증한다(프런트 매핑 로직은 `DeleteBlockedBanner.spec.tsx`에서 별도 검증).
 */
describe('대화 설계(No.5~9) 통합 테스트', () => {
  let app: INestApplication;
  let baseUrl: string;
  let tmpDir: string;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'chatbot-dialogue-test-'));
    const dbPath = join(tmpDir, 'test.db').replace(/\\/g, '/');
    const testDatabaseUrl = `file:${dbPath}`;

    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.DEPLOY_SCHEDULE_ENABLED = 'false'; // [No.28] 실행 엔진 비활성 — 기존 그룹 통합 시험은 폴링 없이 수행(§7.10)
    process.env.WIDGET_BASE_URL = process.env.WIDGET_BASE_URL ?? 'http://localhost:5174';
    process.env.PUBLIC_API_BASE_URL = process.env.PUBLIC_API_BASE_URL ?? 'http://localhost:3000/api/v1';

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

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalFilters(new AllExceptionsFilter());
    const prisma = moduleRef.get(PrismaService);

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

  async function createGroup(name = '대화설계 테스트 그룹'): Promise<string> {
    const res = await jsonRequest<Record<string, unknown>>('POST', `${baseUrl}/chatbot-groups`, { name });
    return res.body.id as string;
  }

  async function createChatbot(overrides: Partial<{ name: string; slug: string; groupId: string }> = {}): Promise<{ id: string }> {
    const groupId = overrides.groupId ?? (await createGroup());
    const suffix = Math.random().toString(36).slice(2, 10);
    const res = await jsonRequest<Record<string, unknown>>('POST', `${baseUrl}/chatbots`, {
      groupId,
      name: overrides.name ?? '대화설계 테스트봇',
      slug: overrides.slug ?? `dlg-bot-${suffix}`,
    });
    return { id: res.body.id as string };
  }

  async function archiveChatbot(chatbotId: string): Promise<void> {
    const del = await jsonRequest('DELETE', `${baseUrl}/chatbots/${chatbotId}`);
    expect(del.status).toBe(204);
    const after = await jsonRequest('GET', `${baseUrl}/chatbots/${chatbotId}`);
    expect((after.body as { status: string }).status).toBe('ARCHIVED');
  }

  function base(chatbotId: string): string {
    return `${baseUrl}/chatbots/${chatbotId}`;
  }

  // ================================================================================================
  // 의도(Intent) — FR-6-1~13, AC-6
  // ================================================================================================
  describe('의도(Intent)', () => {
    it('AC-6-1: 예문 2건으로 의도를 생성하면 201과 exampleCount:2를 반환한다', async () => {
      const { id: chatbotId } = await createChatbot();
      const res = await jsonRequest('POST', `${base(chatbotId)}/intents`, {
        name: '주문_배송조회',
        examples: ['배송 조회', '택배 어디'],
      });
      expect(res.status).toBe(201);
      const body = res.body as { intent: { examples: string[] } };
      expect(body.intent.examples).toHaveLength(2);
    });

    it('AC-6-2: 공백 차이만 있는 이름으로 재생성하면 409 DUPLICATE_NAME을 반환한다', async () => {
      const { id: chatbotId } = await createChatbot();
      await jsonRequest('POST', `${base(chatbotId)}/intents`, { name: '환불문의' });
      const dup = await jsonRequest('POST', `${base(chatbotId)}/intents`, { name: ' 환불문의 ' });
      expect(dup.status).toBe(409);
      expect(ApiErrorSchema.parse(dup.body).code).toBe('DUPLICATE_NAME');
    });

    it('AC-6-3: 정규화 기준 중복 예문은 제거되고 deduplicatedCount로 알린다', async () => {
      const { id: chatbotId } = await createChatbot();
      const res = await jsonRequest('POST', `${base(chatbotId)}/intents`, {
        name: '택배조회',
        examples: ['택배 조회', '택배  조회', ' 택배 조회'],
      });
      expect(res.status).toBe(201);
      const body = res.body as { intent: { examples: string[] }; meta: { deduplicatedCount: number } };
      expect(body.intent.examples).toHaveLength(1);
      expect(body.meta.deduplicatedCount).toBe(2);
    });

    it('AC-6-4: 공백만 있는 예문은 400과 위치 정보를 반환한다', async () => {
      const { id: chatbotId } = await createChatbot();
      const res = await jsonRequest('POST', `${base(chatbotId)}/intents`, {
        name: '빈예문의도',
        examples: ['정상 예문', '   '],
      });
      expect(res.status).toBe(400);
    });

    it('AC-6-5: 다른 의도가 이미 가진 예문을 저장하면 200으로 성공하되 conflicts에 포함된다', async () => {
      const { id: chatbotId } = await createChatbot();
      await jsonRequest('POST', `${base(chatbotId)}/intents`, { name: '의도A', examples: ['환불 되나요'] });
      const res = await jsonRequest('POST', `${base(chatbotId)}/intents`, { name: '의도B', examples: ['환불 되나요'] });
      expect(res.status).toBe(201);
      const body = res.body as { meta: { conflicts: Array<{ intentName: string }> } };
      expect(body.meta.conflicts.some((c) => c.intentName === '의도A')).toBe(true);
    });

    it('AC-6-6: 노드가 참조 중인 의도를 삭제하면 409 INTENT_IN_USE와 참조 노드 목록을 반환한다', async () => {
      const { id: chatbotId } = await createChatbot();
      const intentRes = await jsonRequest<{ intent: { id: string } }>('POST', `${base(chatbotId)}/intents`, { name: '배송조회' });
      const intentId = intentRes.body.intent.id;
      const nodeRes = await jsonRequest<{ id: string; name: string }>('POST', `${base(chatbotId)}/dialog-nodes`, {
        name: '배송조회_응답',
        intentIds: [intentId],
        outputs: [{ type: 'TEXT', payload: { text: '안내드립니다.' } }],
      });
      expect(nodeRes.status).toBe(201);

      const del = await jsonRequest('DELETE', `${base(chatbotId)}/intents/${intentId}`);
      expect(del.status).toBe(409);
      const err = ApiErrorSchema.parse(del.body);
      expect(err.code).toBe('INTENT_IN_USE');
      expect(err.details?.some((d) => d.message === '배송조회_응답')).toBe(true);
    });

    it('AC-6-7: 참조가 없는 의도는 204로 삭제된다', async () => {
      const { id: chatbotId } = await createChatbot();
      const intentRes = await jsonRequest<{ intent: { id: string } }>('POST', `${base(chatbotId)}/intents`, { name: '미사용의도' });
      const del = await jsonRequest('DELETE', `${base(chatbotId)}/intents/${intentRes.body.intent.id}`);
      expect(del.status).toBe(204);
    });

    it('AC-6-8: 일괄 삭제 중 1건이라도 참조되면 전체가 롤백되고 409를 반환한다(부분 삭제 금지)', async () => {
      const { id: chatbotId } = await createChatbot();
      const a = await jsonRequest<{ intent: { id: string } }>('POST', `${base(chatbotId)}/intents`, { name: '일괄A' });
      const b = await jsonRequest<{ intent: { id: string } }>('POST', `${base(chatbotId)}/intents`, { name: '일괄B' });
      const c = await jsonRequest<{ intent: { id: string } }>('POST', `${base(chatbotId)}/intents`, { name: '일괄C' });
      await jsonRequest('POST', `${base(chatbotId)}/dialog-nodes`, {
        name: '일괄C_사용노드',
        intentIds: [c.body.intent.id],
        outputs: [{ type: 'TEXT', payload: { text: 'ok' } }],
      });

      const bulk = await jsonRequest('POST', `${base(chatbotId)}/intents/bulk-delete`, {
        ids: [a.body.intent.id, b.body.intent.id, c.body.intent.id],
      });
      expect(bulk.status).toBe(409);

      const listRes = await jsonRequest<{ total: number }>('GET', `${base(chatbotId)}/intents?pageSize=20`);
      expect(listRes.body.total).toBe(3); // 3건 모두 보존
    });

    it('EX-R-2 / H2: 동음이의어 사전이 연결한 의도를 삭제하면 409 메시지에 "동음이의어"가 포함된다', async () => {
      const { id: chatbotId } = await createChatbot();
      const intentRes = await jsonRequest<{ intent: { id: string } }>('POST', `${base(chatbotId)}/intents`, { name: '선박운항' });
      const intentId = intentRes.body.intent.id;
      const homonymRes = await jsonRequest('POST', `${base(chatbotId)}/homonyms`, {
        word: '배',
        meanings: [
          { label: '과일', contextHints: ['사과'] },
          { label: '선박', contextHints: ['항구'], intentId },
        ],
      });
      expect(homonymRes.status).toBe(201);

      const del = await jsonRequest('DELETE', `${base(chatbotId)}/intents/${intentId}`);
      expect(del.status).toBe(409);
      const err = ApiErrorSchema.parse(del.body);
      expect(err.code).toBe('INTENT_IN_USE');
      expect(err.message).toContain('동음이의어');
      // frontend `resolveBlockedRefKind('intent', message)`가 이 문구를 보고 kind='homonym'을 고른다.
      expect(err.details?.some((d) => d.message === '배')).toBe(true);
    });
  });

  // ================================================================================================
  // 키워드(Keyword) — FR-6-14~18, AC-6-9
  // ================================================================================================
  describe('키워드(Keyword)', () => {
    it('AC-6-9: 다른 키워드가 이미 가진 동의어를 등록하면 409 SYNONYM_CONFLICT를 반환한다', async () => {
      const { id: chatbotId } = await createChatbot();
      await jsonRequest('POST', `${base(chatbotId)}/keywords`, { name: '택배사', synonyms: ['한진'] });
      const dup = await jsonRequest('POST', `${base(chatbotId)}/keywords`, { name: '운송사', synonyms: ['한진'] });
      expect(dup.status).toBe(409);
      const err = ApiErrorSchema.parse(dup.body);
      expect(err.code).toBe('SYNONYM_CONFLICT');
      expect(err.message).toContain('택배사');
    });

    it('FR-6-18: 노드가 참조 중인 키워드를 삭제하면 409 KEYWORD_IN_USE를 반환한다', async () => {
      const { id: chatbotId } = await createChatbot();
      const kw = await jsonRequest<{ id: string }>('POST', `${base(chatbotId)}/keywords`, { name: '메뉴', synonyms: ['아메리카노'] });
      await jsonRequest('POST', `${base(chatbotId)}/dialog-nodes`, {
        name: '메뉴조건노드',
        keywordIds: [kw.body.id],
        outputs: [{ type: 'TEXT', payload: { text: 'ok' } }],
      });
      const del = await jsonRequest('DELETE', `${base(chatbotId)}/keywords/${kw.body.id}`);
      expect(del.status).toBe(409);
      expect(ApiErrorSchema.parse(del.body).code).toBe('KEYWORD_IN_USE');
    });

    it('EX-R-3 / H2: 컨텍스트 슬롯이 참조 중인 키워드를 삭제하면 409 메시지에 "컨텍스트"가 포함된다', async () => {
      const { id: chatbotId } = await createChatbot();
      const kw = await jsonRequest<{ id: string }>('POST', `${base(chatbotId)}/keywords`, { name: '사이즈', synonyms: ['톨'] });
      const ctxRes = await jsonRequest('POST', `${base(chatbotId)}/contexts`, {
        name: '커피주문',
        slots: [
          {
            name: 'size',
            label: '사이즈',
            prompt: '사이즈를 선택해 주세요.',
            type: 'KEYWORD',
            keywordId: kw.body.id,
          },
        ],
      });
      expect(ctxRes.status).toBe(201);

      const del = await jsonRequest('DELETE', `${base(chatbotId)}/keywords/${kw.body.id}`);
      expect(del.status).toBe(409);
      const err = ApiErrorSchema.parse(del.body);
      expect(err.code).toBe('KEYWORD_IN_USE');
      expect(err.message).toContain('컨텍스트');
      // frontend `resolveBlockedRefKind('keyword', message)`가 이 문구를 보고 kind='context'를 고른다.
      expect(err.details?.some((d) => d.message === '커피주문')).toBe(true);
    });
  });

  // ================================================================================================
  // 동음이의어/다의어 사전 — FR-7-1~11, AC-7
  // ================================================================================================
  describe('동음이의어/다의어 사전', () => {
    it('AC-7-1: 의미가 1건이면 400, 2건 이상이면 201이다', async () => {
      const { id: chatbotId } = await createChatbot();
      const oneMeaning = await jsonRequest('POST', `${base(chatbotId)}/homonyms`, {
        word: '눈',
        meanings: [{ label: '신체', contextHints: ['보다'] }],
      });
      expect(oneMeaning.status).toBe(400);

      const twoMeanings = await jsonRequest('POST', `${base(chatbotId)}/homonyms`, {
        word: '눈',
        meanings: [
          { label: '신체', contextHints: ['보다'] },
          { label: '날씨', contextHints: ['내리다'] },
        ],
      });
      expect(twoMeanings.status).toBe(201);
    });

    it('AC-7-2: 두 의미에 동일한 문맥 힌트가 있으면 400을 반환한다', async () => {
      const { id: chatbotId } = await createChatbot();
      const res = await jsonRequest('POST', `${base(chatbotId)}/homonyms`, {
        word: '배',
        meanings: [
          { label: '과일', contextHints: ['항구'] },
          { label: '선박', contextHints: ['항구'] },
        ],
      });
      expect(res.status).toBe(400);
    });

    it('AC-7-3: 존재하지 않는 intentId를 지정하면 404를 반환한다', async () => {
      const { id: chatbotId } = await createChatbot();
      const res = await jsonRequest('POST', `${base(chatbotId)}/homonyms`, {
        word: '배',
        meanings: [
          { label: '과일', contextHints: ['사과'], intentId: '00000000-0000-0000-0000-000000000000' },
          { label: '선박', contextHints: ['항구'] },
        ],
      });
      expect(res.status).toBe(404);
      expect(ApiErrorSchema.parse(res.body).code).toBe('INVALID_REFERENCE');
    });

    it('AC-7-4/7-5: ASK 정책에서 힌트 없는 입력은 되묻기, 힌트 있는 입력은 의미가 확정된다', async () => {
      const { id: chatbotId } = await createChatbot();
      await jsonRequest('POST', `${base(chatbotId)}/homonyms`, {
        word: '배',
        policy: 'ASK',
        meanings: [
          { label: '과일', contextHints: ['사과', '포도'] },
          { label: '선박', contextHints: ['항구', '운항'] },
        ],
      });

      const ambiguous = await jsonRequest<{ outputs: unknown[] }>('POST', `${base(chatbotId)}/homonyms/test`, { text: '배 얼마예요?' });
      expect(ambiguous.status).toBe(200);
      expect(ambiguous.body.outputs.length).toBeGreaterThan(0); // 되묻기 BUTTON 출력

      const resolved = await jsonRequest<{ resolution: { status: string } }>('POST', `${base(chatbotId)}/homonyms/test`, {
        text: '항구에서 배 출발 시간',
      });
      expect(resolved.body.resolution?.status).toBe('RESOLVED');
    });

    it('AC-7-6: IGNORE 정책에서는 모호한 입력에도 되묻지 않는다', async () => {
      const { id: chatbotId } = await createChatbot();
      await jsonRequest('POST', `${base(chatbotId)}/homonyms`, {
        word: '눈',
        policy: 'IGNORE',
        meanings: [
          { label: '신체', contextHints: ['보다'] },
          { label: '날씨', contextHints: ['내리다'] },
        ],
      });
      const res = await jsonRequest<{ outputs: unknown[]; resolution: { status: string } }>('POST', `${base(chatbotId)}/homonyms/test`, {
        text: '눈이 좋아요',
      });
      expect(res.body.resolution?.status).toBe('IGNORED');
      expect(res.body.outputs.length).toBe(0);
    });

    it('FR-7-9: 사전 항목은 참조 제약이 없으므로 항상 204로 삭제된다', async () => {
      const { id: chatbotId } = await createChatbot();
      const created = await jsonRequest<{ id: string }>('POST', `${base(chatbotId)}/homonyms`, {
        word: '차',
        meanings: [
          { label: '음료', contextHints: ['마시다'] },
          { label: '자동차', contextHints: ['운전'] },
        ],
      });
      const parsed = HomonymDictionarySchema.parse(created.body);
      const del = await jsonRequest('DELETE', `${base(chatbotId)}/homonyms/${parsed.id}`);
      expect(del.status).toBe(204);
    });
  });

  // ================================================================================================
  // 컨텍스트(멀티턴·슬롯필링) — FR-8-1~7, AC-8
  // ================================================================================================
  describe('컨텍스트(멀티턴·슬롯필링)', () => {
    it('AC-8-11: 슬롯 0개로 저장하면 400을 반환한다', async () => {
      const { id: chatbotId } = await createChatbot();
      const res = await jsonRequest('POST', `${base(chatbotId)}/contexts`, { name: '빈컨텍스트', slots: [] });
      expect(res.status).toBe(400);
    });

    it('FR-8-5: 존재하지 않는 keywordId를 KEYWORD 슬롯에 지정하면 404를 반환한다', async () => {
      const { id: chatbotId } = await createChatbot();
      const res = await jsonRequest('POST', `${base(chatbotId)}/contexts`, {
        name: '없는키워드컨텍스트',
        slots: [
          {
            name: 'menu',
            label: '메뉴',
            prompt: '메뉴를 선택해 주세요.',
            type: 'KEYWORD',
            keywordId: '00000000-0000-0000-0000-000000000000',
          },
        ],
      });
      expect(res.status).toBe(404);
      expect(ApiErrorSchema.parse(res.body).code).toBe('INVALID_REFERENCE');
    });

    it('AC-8-9: 노드가 CONTEXT_FORM으로 참조 중인 컨텍스트를 삭제하면 409 CONTEXT_IN_USE를 반환한다', async () => {
      const { id: chatbotId } = await createChatbot();
      const ctx = await jsonRequest<{ id: string }>('POST', `${base(chatbotId)}/contexts`, {
        name: '커피주문',
        slots: [{ name: 'menu', label: '메뉴', prompt: '메뉴를 선택해 주세요.', type: 'TEXT' }],
      });
      await jsonRequest('POST', `${base(chatbotId)}/dialog-nodes`, {
        name: '커피주문_시작',
        contextVariableId: ctx.body.id,
        outputs: [{ type: 'CONTEXT_FORM', payload: { contextVariableId: ctx.body.id } }],
      });
      const del = await jsonRequest('DELETE', `${base(chatbotId)}/contexts/${ctx.body.id}`);
      expect(del.status).toBe(409);
      expect(ApiErrorSchema.parse(del.body).code).toBe('CONTEXT_IN_USE');
    });
  });

  // ================================================================================================
  // 대화 그래프(노드) — FR-5-1~11, AC-5
  // ================================================================================================
  describe('대화 노드', () => {
    it('AC-5-2: 인풋 조건 없는 NORMAL 노드는 400을 반환한다', async () => {
      const { id: chatbotId } = await createChatbot();
      const res = await jsonRequest('POST', `${base(chatbotId)}/dialog-nodes`, {
        name: '조건없음노드',
        outputs: [{ type: 'TEXT', payload: { text: 'hi' } }],
      });
      expect(res.status).toBe(400);
    });

    it('AC-5-3: START 노드가 이미 있으면 추가 지정 시 409 START_NODE_EXISTS를 반환한다', async () => {
      const { id: chatbotId } = await createChatbot();
      const first = await jsonRequest('POST', `${base(chatbotId)}/dialog-nodes`, {
        name: '시작노드1',
        nodeType: 'START',
        outputs: [{ type: 'TEXT', payload: { text: '안녕하세요' } }],
      });
      expect(first.status).toBe(201);
      const second = await jsonRequest('POST', `${base(chatbotId)}/dialog-nodes`, {
        name: '시작노드2',
        nodeType: 'START',
        outputs: [{ type: 'TEXT', payload: { text: '반가워요' } }],
      });
      expect(second.status).toBe(409);
      expect(ApiErrorSchema.parse(second.body).code).toBe('START_NODE_EXISTS');
    });

    it('AC-5-4: 존재하지 않는 intentId로 조건을 지정하면 404와 문제 ID가 details에 포함된다', async () => {
      const { id: chatbotId } = await createChatbot();
      const badId = '00000000-0000-0000-0000-000000000000';
      const res = await jsonRequest('POST', `${base(chatbotId)}/dialog-nodes`, {
        name: '깨진참조노드',
        intentIds: [badId],
        outputs: [{ type: 'TEXT', payload: { text: 'hi' } }],
      });
      expect(res.status).toBe(404);
      const err = ApiErrorSchema.parse(res.body);
      expect(err.code).toBe('INVALID_REFERENCE');
      expect(err.details?.some((d) => d.message === badId)).toBe(true);
    });

    it('AC-5-5: IMAGE 아웃풋에 altText가 없으면 400을 반환한다', async () => {
      const { id: chatbotId } = await createChatbot();
      const intent = await jsonRequest<{ intent: { id: string } }>('POST', `${base(chatbotId)}/intents`, { name: '이미지조건' });
      const res = await jsonRequest('POST', `${base(chatbotId)}/dialog-nodes`, {
        name: '이미지노드',
        intentIds: [intent.body.intent.id],
        outputs: [{ type: 'IMAGE', payload: { imageUrl: 'https://example.com/a.png' } }],
      });
      expect(res.status).toBe(400);
    });

    it('AC-5-6: LINK 아웃풋의 url에 javascript: 스킴을 쓰면 400을 반환한다', async () => {
      const { id: chatbotId } = await createChatbot();
      const intent = await jsonRequest<{ intent: { id: string } }>('POST', `${base(chatbotId)}/intents`, { name: '링크조건' });
      const res = await jsonRequest('POST', `${base(chatbotId)}/dialog-nodes`, {
        name: '링크노드',
        intentIds: [intent.body.intent.id],
        outputs: [{ type: 'LINK', payload: { label: '이동', url: 'javascript:alert(1)' } }],
      });
      expect(res.status).toBe(400);
    });

    it('AC-5-7: SURVEY(미지원 아웃풋)를 포함한 노드는 201로 저장된다(실행만 제외)', async () => {
      const { id: chatbotId } = await createChatbot();
      const intent = await jsonRequest<{ intent: { id: string } }>('POST', `${base(chatbotId)}/intents`, { name: '설문조건' });
      const res = await jsonRequest('POST', `${base(chatbotId)}/dialog-nodes`, {
        name: '설문노드',
        intentIds: [intent.body.intent.id],
        outputs: [{ type: 'SURVEY', payload: { surveyId: 'post-satisfaction' } }],
      });
      expect(res.status).toBe(201);
    });

    it('AC-5-9/5-10: DIALOG_MOVE 순환과 빈 아웃풋 노드가 설계 점검에서 검출된다', async () => {
      const { id: chatbotId } = await createChatbot();
      const nodeA = await jsonRequest<{ id: string }>('POST', `${base(chatbotId)}/dialog-nodes`, {
        name: '순환노드A',
        nodeType: 'START',
        outputs: [{ type: 'TEXT', payload: { text: 'A' } }],
      });
      const nodeB = await jsonRequest<{ id: string }>('POST', `${base(chatbotId)}/dialog-nodes`, {
        name: '순환노드B',
        nodeType: 'FALLBACK',
        outputs: [{ type: 'DIALOG_MOVE', payload: { targetNodeId: nodeA.body.id } }],
      });
      await jsonRequest('PATCH', `${base(chatbotId)}/dialog-nodes/${nodeA.body.id}`, {
        outputs: [
          { type: 'TEXT', payload: { text: 'A' } },
          { type: 'DIALOG_MOVE', payload: { targetNodeId: nodeB.body.id } },
        ],
      });
      // 빈 아웃풋 노드(enabled=false로만 저장 가능, FR-5-6)
      await jsonRequest('POST', `${base(chatbotId)}/dialog-nodes`, {
        name: '빈아웃풋노드',
        enabled: false,
        intentIds: [],
        keywordIds: [],
        nodeType: 'NORMAL',
        outputs: [],
      }).catch(() => undefined);
      const emptyOutputIntent = await jsonRequest<{ intent: { id: string } }>('POST', `${base(chatbotId)}/intents`, { name: '빈아웃풋조건' });
      const emptyOutputNode = await jsonRequest('POST', `${base(chatbotId)}/dialog-nodes`, {
        name: '빈아웃풋노드2',
        enabled: false,
        intentIds: [emptyOutputIntent.body.intent.id],
        outputs: [],
      });
      expect(emptyOutputNode.status).toBe(201);

      const report = await jsonRequest('POST', `${base(chatbotId)}/dialog-nodes/validate`);
      expect(report.status).toBe(200);
      const parsed = DesignValidationReportSchema.parse(report.body);
      expect(parsed.issues.some((i) => i.code === 'MOVE_CYCLE')).toBe(true);
      expect(parsed.issues.some((i) => i.code === 'EMPTY_OUTPUT')).toBe(true);
    });

    it('AC-5-11: 다른 노드가 DIALOG_MOVE로 참조하는 노드를 삭제하면 409 NODE_IN_USE를 반환한다', async () => {
      const { id: chatbotId } = await createChatbot();
      const target = await jsonRequest<{ id: string }>('POST', `${base(chatbotId)}/dialog-nodes`, {
        name: '이동대상노드',
        nodeType: 'FALLBACK',
        outputs: [{ type: 'TEXT', payload: { text: 'fallback' } }],
      });
      await jsonRequest('POST', `${base(chatbotId)}/dialog-nodes`, {
        name: '이동출발노드',
        nodeType: 'START',
        outputs: [{ type: 'DIALOG_MOVE', payload: { targetNodeId: target.body.id } }],
      });
      const del = await jsonRequest('DELETE', `${base(chatbotId)}/dialog-nodes/${target.body.id}`);
      expect(del.status).toBe(409);
      expect(ApiErrorSchema.parse(del.body).code).toBe('NODE_IN_USE');
    });

    it('AC-5-12: 노드를 복사하면 "(사본)" 이름으로 enabled=false 노드가 생성되고 원본은 그대로다', async () => {
      const { id: chatbotId } = await createChatbot();
      const intent = await jsonRequest<{ intent: { id: string } }>('POST', `${base(chatbotId)}/intents`, { name: '복사조건' });
      const original = await jsonRequest<{ id: string; enabled: boolean }>('POST', `${base(chatbotId)}/dialog-nodes`, {
        name: '원본노드',
        intentIds: [intent.body.intent.id],
        outputs: [{ type: 'TEXT', payload: { text: 'ok' } }],
      });
      const copy = await jsonRequest<{ name: string; enabled: boolean }>('POST', `${base(chatbotId)}/dialog-nodes/${original.body.id}/copy`, {});
      expect(copy.status).toBe(201);
      expect(copy.body.name).toBe('원본노드 (사본)');
      expect(copy.body.enabled).toBe(false);

      const originalAfter = await jsonRequest<{ enabled: boolean }>('GET', `${base(chatbotId)}/dialog-nodes/${original.body.id}`);
      expect(originalAfter.body.enabled).toBe(true);
    });

    it('H3: nodeType 다중 필터(csv)를 서버가 처리해 지정한 타입만 반환한다', async () => {
      const { id: chatbotId } = await createChatbot();
      await jsonRequest('POST', `${base(chatbotId)}/dialog-nodes`, {
        name: '필터START',
        nodeType: 'START',
        outputs: [{ type: 'TEXT', payload: { text: 'start' } }],
      });
      await jsonRequest('POST', `${base(chatbotId)}/dialog-nodes`, {
        name: '필터FALLBACK',
        nodeType: 'FALLBACK',
        outputs: [{ type: 'TEXT', payload: { text: 'fallback' } }],
      });
      const intent = await jsonRequest<{ intent: { id: string } }>('POST', `${base(chatbotId)}/intents`, { name: '필터조건' });
      await jsonRequest('POST', `${base(chatbotId)}/dialog-nodes`, {
        name: '필터NORMAL',
        intentIds: [intent.body.intent.id],
        outputs: [{ type: 'TEXT', payload: { text: 'normal' } }],
      });

      const filtered = await jsonRequest<{ items: Array<{ nodeType: string }>; total: number }>(
        'GET',
        `${base(chatbotId)}/dialog-nodes?nodeType=START,FALLBACK&pageSize=20`,
      );
      expect(filtered.status).toBe(200);
      expect(filtered.body.total).toBe(2);
      expect(filtered.body.items.every((n) => n.nodeType === 'START' || n.nodeType === 'FALLBACK')).toBe(true);
    });

    it('FR-5-19: 흐름 요약(flow) 엔드포인트가 트리를 반환한다', async () => {
      const { id: chatbotId } = await createChatbot();
      await jsonRequest('POST', `${base(chatbotId)}/dialog-nodes`, {
        name: '흐름시작',
        nodeType: 'START',
        outputs: [{ type: 'TEXT', payload: { text: 'hi' } }],
      });
      const flow = await jsonRequest('GET', `${base(chatbotId)}/dialog-nodes/flow`);
      expect(flow.status).toBe(200);
      FlowTreeSchema.parse(flow.body);
    });
  });

  // ================================================================================================
  // FAQ — FR-9-1~12, AC-9
  // ================================================================================================
  describe('FAQ', () => {
    it('AC-9-1: category 필터가 해당 항목만 반환하고 counts를 함께 준다', async () => {
      const { id: chatbotId } = await createChatbot();
      await jsonRequest('POST', `${base(chatbotId)}/faqs`, { category: 'FAQ', question: '영업시간?', answer: '9-6시' });
      await jsonRequest('POST', `${base(chatbotId)}/faqs`, { category: 'SMALL_TALK', question: '안녕', answer: '안녕하세요' });
      const res = await jsonRequest<{ items: Array<{ category: string }>; counts: Record<string, number> }>(
        'GET',
        `${base(chatbotId)}/faqs?category=SMALL_TALK`,
      );
      expect(res.body.items.every((f) => f.category === 'SMALL_TALK')).toBe(true);
      expect(res.body.counts.FAQ).toBe(1);
      expect(res.body.counts.SMALL_TALK).toBe(1);
    });

    it('AC-9-2: 동일 질문을 다시 등록하면 409 DUPLICATE_FAQ를 반환한다', async () => {
      const { id: chatbotId } = await createChatbot();
      await jsonRequest('POST', `${base(chatbotId)}/faqs`, { category: 'FAQ', question: '영업시간 알려주세요', answer: '9-6시' });
      const dup = await jsonRequest('POST', `${base(chatbotId)}/faqs`, { category: 'FAQ', question: '영업시간 알려주세요', answer: '9-6시' });
      expect(dup.status).toBe(409);
      expect(ApiErrorSchema.parse(dup.body).code).toBe('DUPLICATE_FAQ');
    });

    it('AC-9-4: 대체 질문으로 매칭하면 원본 FAQ의 답변을 찾을 수 있다(목록에 altQuestions 포함)', async () => {
      const { id: chatbotId } = await createChatbot();
      const res = await jsonRequest<{ altQuestions: string[] }>('POST', `${base(chatbotId)}/faqs`, {
        category: 'FAQ',
        question: '영업시간이 어떻게 되나요?',
        answer: '9-6시',
        altQuestions: ['영업시간 알려주세요', '몇시까지 하나요'],
      });
      expect(res.body.altQuestions).toEqual(['영업시간 알려주세요', '몇시까지 하나요']);
    });

    it('AC-9-8: mode=public 조회는 answer 없이 {id, question}만 반환한다', async () => {
      const { id: chatbotId } = await createChatbot();
      await jsonRequest('POST', `${base(chatbotId)}/faqs`, { category: 'FAQ', question: '영업시간이 어떻게 되나요?', answer: '9-6시' });
      const res = await jsonRequest<Array<Record<string, unknown>>>('GET', `${base(chatbotId)}/faqs/suggest?q=영업시간&mode=public`);
      expect(res.status).toBe(200);
      for (const item of res.body) {
        expect(item.answer).toBeUndefined();
        expect(item).toHaveProperty('id');
        expect(item).toHaveProperty('question');
      }
    });

    it('AC-9-7: answer에 <script>를 저장해도 그대로 문자열로 보관된다(렌더링 이스케이프는 프런트 책임)', async () => {
      const { id: chatbotId } = await createChatbot();
      const res = await jsonRequest<{ answer: string }>('POST', `${base(chatbotId)}/faqs`, {
        category: 'FAQ',
        question: 'XSS 테스트 질문',
        answer: '<script>alert(1)</script>',
      });
      expect(res.status).toBe(201);
      expect(res.body.answer).toBe('<script>alert(1)</script>');
    });
  });

  // ================================================================================================
  // 대량 업로드 — FR-6-19~30, M2(그룹 스킵) 통합 검증
  // ================================================================================================
  describe('대량 업로드', () => {
    it('AC-6B-2/6B-3: 검증(dry-run)은 저장하지 않고, SKIP_INVALID+MERGE 커밋만 실제로 반영한다', async () => {
      const { id: chatbotId } = await createChatbot();
      const content = csv(
        ['의도명', '예문', '설명'],
        [
          ['업로드의도', '예문1', ''],
          ['업로드의도', '예문2', ''],
          ['', '이름없음행', ''], // EMPTY_NAME 오류 유발
        ],
      );
      const validate = await uploadCsv(`${base(chatbotId)}/intents/import/validate`, 'intents.csv', content);
      expect(validate.status).toBe(200);
      const validated = ImportValidateResultSchema.parse(validate.body);
      expect(validated.newItems).toBe(1);
      expect(validated.errors.length).toBe(1);

      const listBefore = await jsonRequest<{ total: number }>('GET', `${base(chatbotId)}/intents`);
      expect(listBefore.body.total).toBe(0); // dry-run은 저장하지 않는다

      const commit = await jsonRequest(
        'POST',
        `${base(chatbotId)}/intents/import/commit`,
        { importToken: validated.importToken, mergePolicy: 'MERGE', errorPolicy: 'SKIP_INVALID' },
      );
      expect(commit.status).toBe(200);
      const committed = ImportCommitResultSchema.parse(commit.body);
      expect(committed.createdItems).toBe(1);
      expect(committed.skippedRows).toBe(1);

      const listAfter = await jsonRequest<{ total: number }>('GET', `${base(chatbotId)}/intents`);
      expect(listAfter.body.total).toBe(1);
    });

    it('AC-6B-4: ABORT_ON_ERROR 정책은 오류가 있으면 전체를 취소하고 한 건도 반영하지 않는다', async () => {
      const { id: chatbotId } = await createChatbot();
      const content = csv(
        ['의도명', '예문', '설명'],
        [
          ['업로드의도2', '예문1', ''],
          ['', '이름없음행', ''],
        ],
      );
      const validate = await uploadCsv(`${base(chatbotId)}/intents/import/validate`, 'intents.csv', content);
      const validated = ImportValidateResultSchema.parse(validate.body);
      const commit = await jsonRequest(
        'POST',
        `${base(chatbotId)}/intents/import/commit`,
        { importToken: validated.importToken, mergePolicy: 'MERGE', errorPolicy: 'ABORT_ON_ERROR' },
      );
      expect(commit.status).toBe(400);
      const listAfter = await jsonRequest<{ total: number }>('GET', `${base(chatbotId)}/intents`);
      expect(listAfter.body.total).toBe(0);
    });

    it('AC-6B-6: 만료된 importToken으로 커밋하면 400 IMPORT_TOKEN_EXPIRED를 반환한다', async () => {
      const { id: chatbotId } = await createChatbot();
      const commit = await jsonRequest('POST', `${base(chatbotId)}/intents/import/commit`, {
        importToken: 'nonexistent-token',
        mergePolicy: 'MERGE',
        errorPolicy: 'SKIP_INVALID',
      });
      expect(commit.status).toBe(400);
      expect(ApiErrorSchema.parse(commit.body).code).toBe('IMPORT_TOKEN_EXPIRED');
    });

    /**
     * M2 통합 검증 — `import-planner.spec.ts`(순수 함수)가 이미 커버한 "묶음 전체 스킵" 규칙이
     * 실제 HTTP 검증→커밋 왕복에서도 사용자가 본 예고(errors[])와 실제 커밋 결과가 일치하는지 확인한다.
     * 이 케이스는 frontend-implementer가 자체 보고한 미검증 항목(M2 수정)에 대한 회귀 방지 시험이다.
     */
    it('M2: 키워드 동의어 충돌 시 검증 리포트의 그룹 전체 스킵 예고와 실제 커밋 결과가 일치한다', async () => {
      const { id: chatbotId } = await createChatbot();
      await jsonRequest('POST', `${base(chatbotId)}/keywords`, { name: '커피', synonyms: [] });

      const content = csv(
        ['키워드명', '동의어', '설명'],
        [
          ['음료', '커피', ''], // 기존 키워드 '커피'와 충돌
          ['음료', '주스', ''], // 그 자체로는 충돌 없음 — 같은 묶음이라 함께 스킵되어야 함(M2)
        ],
      );
      const validate = await uploadCsv(`${base(chatbotId)}/keywords/import/validate`, 'keywords.csv', content);
      expect(validate.status).toBe(200);
      const validated = ImportValidateResultSchema.parse(validate.body);
      // 검증 리포트가 두 행 모두 SYNONYM_CONFLICT로 예고해야 한다(리뷰 발견 버그 수정분).
      expect(validated.errors.filter((e) => e.code === 'SYNONYM_CONFLICT')).toHaveLength(2);
      // planNameValueImport 자체는 충돌 여부를 모르므로 newItems=1(음료 묶음)로 집계된다 — 실제 반영 차단은
      // importCommit의 conflictTerms 스킵 로직 책임이다(아래 skippedRows/createdItems 검증이 핵심).

      const commit = await jsonRequest(
        'POST',
        `${base(chatbotId)}/keywords/import/commit`,
        { importToken: validated.importToken, mergePolicy: 'MERGE', errorPolicy: 'SKIP_INVALID' },
      );
      expect(commit.status).toBe(200);
      const committed = ImportCommitResultSchema.parse(commit.body);
      // 예고(errors.length=2)와 실제 커밋 결과(createdItems=0, skippedRows=2)가 정확히 일치해야 한다.
      expect(committed.createdItems).toBe(0);
      expect(committed.skippedRows).toBe(2);

      const listAfter = await jsonRequest<{ total: number }>('GET', `${base(chatbotId)}/keywords`);
      expect(listAfter.body.total).toBe(1); // 기존 '커피' 키워드만 존재, '음료'는 생성되지 않음
    });

    it('EX-I-4: 데이터 행이 없는 파일(헤더만)은 400을 반환한다', async () => {
      const { id: chatbotId } = await createChatbot();
      const content = csv(['의도명', '예문', '설명'], []);
      const res = await uploadCsv(`${base(chatbotId)}/intents/import/validate`, 'empty.csv', content);
      expect(res.status).toBe(400);
    });

    it('EX-I-1: 헤더가 템플릿과 다르면 400을 반환한다', async () => {
      const { id: chatbotId } = await createChatbot();
      const content = csv(['이상한헤더1', '이상한헤더2'], [['a', 'b']]);
      const res = await uploadCsv(`${base(chatbotId)}/intents/import/validate`, 'bad-header.csv', content);
      expect(res.status).toBe(400);
    });
  });

  // ================================================================================================
  // 공통/횡단 — AC-C
  // ================================================================================================
  describe('공통/횡단', () => {
    it('AC-C-2: ARCHIVED 챗봇에 쓰기 요청은 전부 409 CHATBOT_ARCHIVED를 반환하고 조회는 허용한다', async () => {
      const { id: chatbotId } = await createChatbot();
      await archiveChatbot(chatbotId);

      const create = await jsonRequest('POST', `${base(chatbotId)}/intents`, { name: '보관후생성시도' });
      expect(create.status).toBe(409);
      expect(ApiErrorSchema.parse(create.body).code).toBe('CHATBOT_ARCHIVED');

      const list = await jsonRequest('GET', `${base(chatbotId)}/intents`);
      expect(list.status).toBe(200);
    });

    it('AC-C-3 / NFR-S10: 다른 챗봇의 의도 ID로 노드 조건을 저장하면 404를 반환한다(존재 비노출)', async () => {
      const { id: chatbotA } = await createChatbot();
      const { id: chatbotB } = await createChatbot();
      const intentInA = await jsonRequest<{ intent: { id: string } }>('POST', `${base(chatbotA)}/intents`, { name: 'A소속의도' });

      const res = await jsonRequest('POST', `${base(chatbotB)}/dialog-nodes`, {
        name: '교차참조노드',
        intentIds: [intentInA.body.intent.id],
        outputs: [{ type: 'TEXT', payload: { text: 'hi' } }],
      });
      expect(res.status).toBe(404);
    });

    it('AC-C-7: 이모지가 포함된 예문이 저장·조회에서 깨지지 않는다', async () => {
      const { id: chatbotId } = await createChatbot();
      const res = await jsonRequest<{ intent: { examples: string[] } }>('POST', `${base(chatbotId)}/intents`, {
        name: '이모지의도',
        examples: ['배송 조회 🚚', '환불 문의 😢'],
      });
      expect(res.status).toBe(201);
      expect(res.body.intent.examples).toEqual(['배송 조회 🚚', '환불 문의 😢']);

      const get = await jsonRequest<{ examples: string[] }>('GET', `${base(chatbotId)}/intents/${(res.body as unknown as { intent: { id: string } }).intent.id}`);
      expect(get.body.examples).toEqual(['배송 조회 🚚', '환불 문의 😢']);
    });

    it('AC-5-1: 새 챗봇 생성 직후 상태는 DRAFT이며 대화설계 쓰기가 가능하다(전제 확인)', async () => {
      const { id: chatbotId } = await createChatbot();
      const chatbotRes = await jsonRequest('GET', `${baseUrl}/chatbots/${chatbotId}`);
      const chatbot = ChatbotSchema.parse(chatbotRes.body);
      expect(chatbot.status).toBe('DRAFT');
      const intentRes = await jsonRequest('POST', `${base(chatbotId)}/intents`, { name: '전제확인의도' });
      expect(intentRes.status).toBe(201);
    });
  });
});
