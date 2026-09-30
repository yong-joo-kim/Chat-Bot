import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import * as http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { VersioningType } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import ExcelJS from 'exceljs';
import { AllExceptionsFilter } from '../../common/all-exceptions.filter';
import type { PrismaService } from '../../prisma/prisma.service';
import { loginAs, seedTestUsers } from './auth.helper';
import { safeCleanupTmpDir } from './tmp-dir.helper';

/**
 * 발화 묶음 분석(No.21) 통합 시험 공용 하네스 — 실제 Nest 앱 + SQLite(`prisma migrate deploy`) + **설계된 벡터를
 * 돌려주는 가짜 임베딩 서버**(FixtureEmbeddingProvider 역할, 설계서 §20.1). GPU·Python·Ollama 없이 돈다.
 *
 * 선택 기능(이름 제안·거버넌스 모드·기능 끔)을 켜는 spec은 `startHarness({ env })`로 값을 넘긴다 — 이 함수가 앱
 * 모듈을 **동적 import**하므로 `ConfigModule` 스냅샷에 반영된다(CLAUDE.md 규약).
 */

const API_ROOT = join(__dirname, '..', '..', '..');

export interface ApiResponse<T = unknown> {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: T;
  raw: Buffer;
}

/* ───────────── 시험 데이터: 의도 4개 × 8문장(합성 — 실제 고객 문장 0) ───────────── */

export const TOPICS = ['환불', '배송', '로그인', '결제'] as const;

const TEMPLATES = [
  '{t} 신청은 어떻게 하나요',
  '{t} 가능한 기간이 궁금합니다',
  '{t} 처리는 얼마나 걸리나요',
  '{t} 관련해서 문의드립니다',
  '{t} 진행 상태를 확인하고 싶어요',
  '{t} 방법을 알려주세요',
  '{t} 규정이 어떻게 되나요',
  '{t} 요청했는데 답이 없어요',
];

/** 주제별 8문장(서로 다른 문장). */
export function topicSentences(topic: (typeof TOPICS)[number]): string[] {
  return TEMPLATES.map((t) => t.replace('{t}', topic));
}

export function allTopicSentences(): string[] {
  return TOPICS.flatMap((t) => topicSentences(t));
}

/** 어느 주제와도 무관한 문장(대조에서 "답하지 못함"). */
export const UNRELATED_SENTENCES = ['오늘 점심 메뉴 추천해 주세요', '주말에 비가 올까요', '가장 가까운 놀이공원이 어디인가요', '요즘 볼만한 영화가 있을까요', '강아지 산책 시간은 언제가 좋을까요', '커피 원두 보관 방법이 궁금해요'];

/* ───────────── 가짜 임베딩 서버 ───────────── */

const DIM = 8;

function hash32(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * 문장 → 설계된 벡터: 주제 키워드가 있으면 그 축(0~3)에 1 + 작은 해시 잡음, 없으면 4~7축을 해시로 채운다.
 * 같은 문장 = 같은 벡터(결정론). L2 정규화.
 */
export function fixtureVector(text: string): number[] {
  const v = new Array<number>(DIM).fill(0);
  const axis = TOPICS.findIndex((t) => text.includes(t));
  let h = hash32(text);
  const noise = () => {
    h = Math.imul(h ^ (h >>> 15), 2246822519) >>> 0;
    return ((h % 1000) / 1000 - 0.5) * 0.1; // ±0.05
  };
  if (axis >= 0) {
    v[axis] = 1;
    for (let i = 0; i < DIM; i += 1) if (i !== axis) v[i] = noise();
  } else {
    for (let i = 0; i < DIM; i += 1) v[i] = i >= 4 ? 0.5 + noise() : noise();
  }
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / norm);
}

export interface FixtureEmbeddingServer {
  url: string;
  modelId: string;
  /** `/embed` 요청에 실려 온 텍스트 전부(기록 — 마스킹 검증용). */
  received: string[];
  embedCalls: () => number;
  /** 다음 `/embed` 호출부터 실패(HTTP 500)하게 한다. */
  setFailing: (failing: boolean) => void;
  /** 응답의 modelId를 바꾼다(모델 변경 시나리오). */
  setModelId: (modelId: string) => void;
  /** 요청마다 인위적으로 지연(ms). */
  setDelayMs: (ms: number) => void;
  close: () => Promise<void>;
}

export function startFixtureEmbeddingServer(initialModelId = 'fixture-embedding-v1'): Promise<FixtureEmbeddingServer> {
  return new Promise((resolve) => {
    let modelId = initialModelId;
    let failing = false;
    let delayMs = 0;
    let calls = 0;
    const received: string[] = [];
    const server = http.createServer((req, res) => {
      if (req.method === 'GET' && req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', modelId: initialModelId, dimension: DIM, warmedUp: true }));
        return;
      }
      if (req.method === 'POST' && req.url === '/embed') {
        let raw = '';
        req.on('data', (c) => (raw += c));
        req.on('end', () => {
          calls += 1;
          const respond = () => {
            if (failing) {
              res.writeHead(500);
              res.end();
              return;
            }
            let texts: string[] = [];
            try {
              texts = (JSON.parse(raw) as { texts?: string[] }).texts ?? [];
            } catch {
              texts = [];
            }
            received.push(...texts);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ modelId, dimension: DIM, vectors: texts.map(fixtureVector) }));
          };
          if (delayMs > 0) setTimeout(respond, delayMs);
          else respond();
        });
        return;
      }
      res.writeHead(404);
      res.end();
    });
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      resolve({
        url: `http://127.0.0.1:${port}`,
        modelId: initialModelId,
        received,
        embedCalls: () => calls,
        setFailing: (f) => {
          failing = f;
        },
        setModelId: (m) => {
          modelId = m;
        },
        setDelayMs: (ms) => {
          delayMs = ms;
        },
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

/* ───────────── 가짜 ml-worker(이름 제안 `/cluster-label`) ───────────── */

export type ClusterLabelMode = 'OK' | 'HTTP_ERROR' | 'ENGLISH' | 'EMPTY' | 'LONG' | 'HANG' | 'ALTERNATE';

export interface FakeLabelServer {
  url: string;
  requests: Array<{ keywords: string[]; samples: string[]; locale: string }>;
  setMode: (m: ClusterLabelMode) => void;
  close: () => Promise<void>;
}

export function startFakeLabelServer(): Promise<FakeLabelServer> {
  return new Promise((resolve) => {
    let mode: ClusterLabelMode = 'OK';
    const requests: FakeLabelServer['requests'] = [];
    const server = http.createServer((req, res) => {
      if (req.method === 'POST' && req.url === '/cluster-label') {
        let raw = '';
        req.on('data', (c) => (raw += c));
        req.on('end', () => {
          const body = JSON.parse(raw) as { keywords: string[]; samples: string[]; locale: string };
          requests.push(body);
          if (mode === 'HANG') return; // 응답 없음(시간 초과)
          if (mode === 'HTTP_ERROR') {
            res.writeHead(500);
            res.end();
            return;
          }
          // ALTERNATE — 홀수 번째 요청은 정상, 짝수 번째는 영문(부분 성공 시나리오)
          const effective = mode === 'ALTERNATE' ? (requests.length % 2 === 1 ? 'OK' : 'ENGLISH') : mode;
          const label =
            effective === 'ENGLISH' ? 'Refund inquiry' : effective === 'EMPTY' ? null : effective === 'LONG' ? '가'.repeat(60) : `${body.keywords[0] ?? '기타'} 안내 문의`;
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ modelId: 'fake-generator', label }));
        });
        return;
      }
      res.writeHead(404);
      res.end();
    });
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      resolve({
        url: `http://127.0.0.1:${port}`,
        requests,
        setMode: (m) => {
          mode = m;
        },
        close: () => new Promise((r) => (server.closeAllConnections?.(), server.close(() => r()))),
      });
    });
  });
}

/* ───────────── 파일 만들기 ───────────── */

function csvCell(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** 머리글 + 행(발화[, 발생 횟수[, 출처 메모]]) → CSV 버퍼(UTF-8 BOM). */
export function buildCsvFile(rows: Array<[string, string?, string?]>, header: string[] = ['발화', '발생 횟수', '출처 메모']): Buffer {
  const lines = [header, ...rows.map((r) => [r[0], r[1] ?? '', r[2] ?? ''])].map((cols) => cols.map(csvCell).join(','));
  return Buffer.from('﻿' + lines.join('\r\n') + '\r\n', 'utf-8');
}

/** 문장 목록 → CSV(머리글 포함). */
export function csvOf(sentences: string[]): Buffer {
  return buildCsvFile(sentences.map((s) => [s]));
}

export async function buildXlsxFile(rows: Array<[string, (string | number)?, string?]>, header: string[] = ['발화', '발생 횟수', '출처 메모']): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('발화');
  sheet.addRow(header);
  for (const r of rows) sheet.addRow([r[0], r[1] ?? '', r[2] ?? '']);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

/* ───────────── HTTP ───────────── */

export function request<T = unknown>(
  method: string,
  url: string,
  opts: { cookie?: string; json?: unknown; raw?: { contentType: string; body: Buffer } } = {},
): Promise<ApiResponse<T>> {
  return new Promise((resolve, reject) => {
    const payload = opts.raw ? opts.raw.body : opts.json !== undefined ? Buffer.from(JSON.stringify(opts.json)) : undefined;
    const contentType = opts.raw ? opts.raw.contentType : opts.json !== undefined ? 'application/json' : undefined;
    const { hostname, port, pathname, search } = new URL(url);
    const req = http.request(
      {
        method,
        hostname,
        port,
        path: pathname + search,
        headers: {
          ...(payload && contentType ? { 'Content-Type': contentType, 'Content-Length': payload.length } : {}),
          ...(opts.cookie ? { Cookie: opts.cookie } : {}),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks);
          const text = raw.toString('utf-8');
          let parsed: unknown = text;
          const type = String(res.headers['content-type'] ?? '');
          if (type.includes('json')) {
            try {
              parsed = text ? JSON.parse(text) : undefined;
            } catch {
              parsed = text;
            }
          }
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body: parsed as T, raw });
        });
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

/** multipart/form-data 본문(파일 1개 + 텍스트 필드). */
export function multipartBody(file: { name: string; content: Buffer; contentType?: string } | null, fields: Record<string, string> = {}): { contentType: string; body: Buffer } {
  const boundary = `----itest${randomUUID().replace(/-/g, '')}`;
  const parts: Buffer[] = [];
  for (const [k, v] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`, 'utf-8'));
  }
  if (file) {
    parts.push(
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: ${file.contentType ?? 'application/octet-stream'}\r\n\r\n`, 'utf-8'),
    );
    parts.push(file.content);
    parts.push(Buffer.from('\r\n', 'utf-8'));
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`, 'utf-8'));
  return { contentType: `multipart/form-data; boundary=${boundary}`, body: Buffer.concat(parts) };
}

/* ───────────── 앱 기동 ───────────── */

export interface Harness {
  app: NestExpressApplication;
  moduleRef: TestingModule;
  baseUrl: string;
  prisma: PrismaService;
  tmpDir: string;
  embedding: FixtureEmbeddingServer;
  cookies: { admin: string; editor: string; viewer: string };
  /** 관리자(기본) 쿠키로 요청. */
  api: <T = unknown>(method: string, path: string, opts?: { cookie?: string; json?: unknown; raw?: { contentType: string; body: Buffer } }) => Promise<ApiResponse<T>>;
  /** 그룹 + 챗봇을 만들고 chatbotId를 돌려준다. */
  createChatbot: (name?: string) => Promise<string>;
  /** 분석 요청(multipart). */
  startAnalysis: (chatbotId: string, file: { name: string; content: Buffer } | null, conditions?: Record<string, unknown> | string, opts?: { cookie?: string }) => Promise<ApiResponse<{ analysisId: string; status: string } & Record<string, unknown>>>;
  /** 분석이 종결 상태가 될 때까지 기다린다. */
  waitForTerminal: (chatbotId: string, analysisId: string, timeoutMs?: number) => Promise<Record<string, any>>;
  close: () => Promise<void>;
}

export interface StartHarnessOptions {
  /** 추가 환경변수(값이 `undefined`면 지운다). AppModule import 전에 설정된다. */
  env?: Record<string, string | undefined>;
  /** 가짜 임베딩 서버를 `EMBEDDING_BASE_URL`로 연결하지 않는다(임베딩 미설정 시나리오). */
  noEmbedding?: boolean;
  /** 이미 떠 있는 임베딩 서버를 재사용한다. */
  embedding?: FixtureEmbeddingServer;
}

export async function startHarness(options: StartHarnessOptions = {}): Promise<Harness> {
  const tmpDir = mkdtempSync(join(tmpdir(), 'chatbot-utterance-analysis-test-'));
  const dbPath = join(tmpDir, 'test.db').replace(/\\/g, '/');
  // 배경 재색인의 upsert 배치와 분석 결과 커밋이 SQLite 락으로 경합하지 않게 시험 DB에만 연결 1개로 직렬화한다.
  const databaseUrl = `file:${dbPath}?connection_limit=1&socket_timeout=60`;

  const embedding = options.embedding ?? (await startFixtureEmbeddingServer());

  process.env.DATABASE_URL = databaseUrl;
  process.env.DEPLOY_SCHEDULE_ENABLED = 'false';
  process.env.HANDOFF_SWEEPER_ENABLED = 'false';
  process.env.DATA_RETENTION_JOB_ENABLED = 'false';
  process.env.WIDGET_BASE_URL = process.env.WIDGET_BASE_URL ?? 'http://localhost:5174';
  process.env.PUBLIC_API_BASE_URL = process.env.PUBLIC_API_BASE_URL ?? 'http://localhost:3000/api/v1';
  process.env.EMBEDDING_BASE_URL = options.noEmbedding ? '' : embedding.url;
  process.env.EMBEDDING_TIMEOUT_MS = '5000';
  process.env.EMBEDDING_BATCH_TIMEOUT_MS = '15000';
  // 시험 속도 — 적응형 양보(배치 사이 쉬는 시간)를 0으로. 양보 계산 자체는 러너 단위 시험이 따로 본다.
  process.env.UTTERANCE_ANALYSIS_EMBED_PAUSE_MS = '0';
  process.env.UTTERANCE_ANALYSIS_EMBED_YIELD_RATIO = '0';
  for (const [k, v] of Object.entries(options.env ?? {})) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }

  try {
    execSync('pnpm exec prisma migrate deploy', { cwd: API_ROOT, env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: 'pipe' });
  } catch (e) {
    const err = e as { stdout?: Buffer; stderr?: Buffer };
    throw new Error(`prisma migrate deploy 실패:\n${err.stdout?.toString()}\n${err.stderr?.toString()}`);
  }

  const { AppModule } = await import('../../app.module');
  const { PrismaService: PrismaServiceClass } = await import('../../prisma/prisma.service');
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>();
  app.enableCors();
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.useGlobalFilters(new AllExceptionsFilter());
  const prisma = moduleRef.get(PrismaServiceClass);

  await app.listen(0);
  const server = app.getHttpServer() as http.Server;
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  const baseUrl = `http://127.0.0.1:${port}/api/v1`;

  await seedTestUsers(prisma);
  const cookies = {
    admin: await loginAs(baseUrl, 'ADMIN'),
    editor: await loginAs(baseUrl, 'EDITOR'),
    viewer: await loginAs(baseUrl, 'VIEWER'),
  };

  const api: Harness['api'] = (method, path, opts = {}) => request(method, `${baseUrl}${path}`, { cookie: cookies.admin, ...opts });

  const createChatbot = async (name = '군집 시험봇'): Promise<string> => {
    const g = await api<{ id: string }>('POST', '/chatbot-groups', { json: { name: `그룹-${randomUUID().slice(0, 8)}` } });
    const c = await api<{ id: string }>('POST', '/chatbots', { json: { groupId: g.body.id, name, slug: `ua-${randomUUID().slice(0, 12)}` } });
    if (c.status !== 201) throw new Error(`챗봇 생성 실패: ${c.status} ${JSON.stringify(c.body)}`);
    return c.body.id;
  };

  const startAnalysis: Harness['startAnalysis'] = (chatbotId, file, conditions, opts = {}) => {
    const fields: Record<string, string> = {};
    if (conditions !== undefined) fields.conditions = typeof conditions === 'string' ? conditions : JSON.stringify(conditions);
    const mp = multipartBody(file ? { name: file.name, content: file.content } : null, fields);
    return api('POST', `/chatbots/${chatbotId}/utterance-analyses`, { cookie: opts.cookie ?? cookies.admin, raw: mp });
  };

  const waitForTerminal: Harness['waitForTerminal'] = async (chatbotId, analysisId, timeoutMs = 60_000) => {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const res = await api<Record<string, any>>('GET', `/chatbots/${chatbotId}/utterance-analyses/${analysisId}`);
      if (['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(res.body.status as string)) return res.body;
      if (Date.now() > deadline) throw new Error(`분석 종결 대기 시간 초과: status=${String(res.body.status)} stage=${String(res.body.stage)} progress=${String(res.body.progress)}`);
      await new Promise((r) => setTimeout(r, 100));
    }
  };

  return {
    app,
    moduleRef,
    baseUrl,
    prisma,
    tmpDir,
    embedding,
    cookies,
    api,
    createChatbot,
    startAnalysis,
    waitForTerminal,
    close: async () => {
      await app.close();
      if (!options.embedding) await embedding.close();
      await safeCleanupTmpDir(tmpDir);
    },
  };
}
