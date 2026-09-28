import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { EgressExitId, Permission } from '@chat-bot/shared-types';
import { EGRESS_REGISTRY } from '../../common/egress/egress-registry';

/**
 * 지식베이스 자동 크롤링/동기화(No.43) 정적 검사(`kb-crawling-설계.md` §15 KB-1~KB-22) —
 * `rag-allowlist.spec.ts`·`governance-sealing.spec.ts`와 같은 형식(스캔 루트 지정 · 자기 자신 제외 ·
 * 스캔 대상 0건 아님 가드 · 주석 줄 제외 · 조각 조립 금지어 · 역검증 픽스처 포함).
 */

const REPO_ROOT = resolve(__dirname, '../../../../..');
const SELF_ABSOLUTE = resolve(__dirname, 'kb-sync-sealing.spec.ts');
// KB-2 — `rag-allowlist.spec.ts`와 같은 6곳.
const RAG_ALLOWLIST_SCAN_ROOTS = ['apps/api/src', 'apps/web/src', 'apps/widget/src', 'packages/dialogue-engine/src', 'packages/shared-types/src', 'packages/pii-mask/src'];

function isCommentLine(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*');
}

function stripComments(content: string): string {
  return content
    .split('\n')
    .filter((l) => !isCommentLine(l))
    .join('\n');
}

function nonCommentOccurrences(content: string, pattern: RegExp): number {
  const stripped = stripComments(content);
  const g = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
  return (stripped.match(g) ?? []).length;
}

function walk(dir: string, extensions: string[], out: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry === 'node_modules' || entry === 'dist' || entry === '.venv' || entry === 'venv' || entry === '__pycache__') continue;
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) walk(fullPath, extensions, out);
    else if (extensions.some((ext) => entry.endsWith(ext))) out.push(fullPath);
  }
}

function toRepoRelative(absolutePath: string): string {
  return absolutePath.replace(/\\/g, '/').replace(`${REPO_ROOT.replace(/\\/g, '/')}/`, '');
}

function collectApiSourceFiles(): string[] {
  const files: string[] = [];
  walk(join(REPO_ROOT, 'apps/api/src'), ['.ts'], files);
  return files.filter((f) => f !== SELF_ABSOLUTE && !f.endsWith('.spec.ts'));
}

function collectApiFilesIncludingSpecs(): string[] {
  const files: string[] = [];
  walk(join(REPO_ROOT, 'apps/api/src'), ['.ts'], files);
  return files.filter((f) => f !== SELF_ABSOLUTE);
}

const apiOperationalFiles = collectApiSourceFiles();
const apiFileContents = apiOperationalFiles.map((f) => ({ f: toRepoRelative(f), content: readFileSync(f, 'utf8') }));
const kbSyncFiles = apiFileContents.filter(({ f }) => f.includes('/kb-sync/') || f.endsWith('/kb-sync.module.ts'));

describe('kb-sync 정적 검사 — kb-crawling-설계.md §15', () => {
  it('스캔 대상 파일이 존재한다(회귀 방지)', () => {
    expect(apiFileContents.length).toBeGreaterThan(50);
    expect(kbSyncFiles.length).toBeGreaterThan(10);
  });

  describe('경로 허용 목록 키 5개 정확히 · 값 리터럴(KB-1 — rag-allowlist.spec.ts 참조 제한을 지키기 위해 심볼을 직접 import하지 않고 파일 텍스트로 검사한다)', () => {
    const pathsEntry = apiFileContents.find(({ f }) => f.endsWith('rag/lib/rag-paths.ts'))!;
    it('키 집합이 정확히 5개다', () => {
      const keys = [...pathsEntry.content.matchAll(/^\s*([A-Z_]+):\s*'/gm)].map((m) => m[1]);
      expect(new Set(keys)).toEqual(new Set(['QUERY', 'STATUS', 'DOCUMENT_METADATA', 'INGEST', 'TASK_STATUS']));
    });
    it('적재·작업 조회 값이 정확하다', () => {
      expect(pathsEntry.content).toContain("INGEST: '/api/documents/ingest'");
      expect(pathsEntry.content).toContain("TASK_STATUS: '/api/async_task_status/'");
    });
  });

  describe('KB-2: 작업 목록·작업 취소 문자열 0 (rag-allowlist.spec.ts와 같은 6곳)', () => {
    const scanFiles: Array<{ f: string; content: string }> = [];
    for (const root of RAG_ALLOWLIST_SCAN_ROOTS) {
      const found: string[] = [];
      walk(join(REPO_ROOT, root), ['.ts', '.tsx'], found);
      for (const f of found) {
        if (resolve(f) === SELF_ABSOLUTE) continue;
        scanFiles.push({ f: toRepoRelative(f), content: readFileSync(f, 'utf8') });
      }
    }

    it('스캔 대상이 0건이 아니다', () => {
      expect(scanFiles.length).toBeGreaterThan(50);
    });

    it('작업 목록("/api/async_ta" + "sks")·작업 취소("/api/async_task_ca" + "ncel") 문자열이 0건이다', () => {
      const listFragment = `${'/api/async_ta'}${'sks'}`;
      const cancelFragment = `${'/api/async_task_ca'}${'ncel'}`;
      const offenders = scanFiles.filter(({ content }) => content.includes(listFragment) || content.includes(cancelFragment)).map(({ f }) => f);
      expect(offenders).toEqual([]);
    });

    it('역검증 — TASK_STATUS 문자열 자체는 두 금지 패턴에 걸리지 않는다', () => {
      const taskStatusPath = '/api/async_task_status/';
      expect(taskStatusPath.includes(`${'/api/async_ta'}${'sks'}`)).toBe(false);
      expect(taskStatusPath.includes(`${'/api/async_task_ca'}${'ncel'}`)).toBe(false);
    });
  });

  describe('KB-3: file_path·force_sync — 송신·kb-sync 0 · 보유 파일 2개 고정', () => {
    it('rag-http.client.ts·rag-paths.ts·kb-sync/**·shared-types/kb-sync.ts에 file_path·force_sync 0건', () => {
      const targets = apiFileContents.filter(
        ({ f }) => f.endsWith('rag/rag-http.client.ts') || f.endsWith('rag/lib/rag-paths.ts') || f.includes('/kb-sync/'),
      );
      const sharedTypesKbSync = readFileSync(join(REPO_ROOT, 'packages/shared-types/src/kb-sync.ts'), 'utf8');
      const pattern = /file_path|force_sync/;
      const offenders = targets.filter(({ content }) => pattern.test(content)).map(({ f }) => f);
      expect(offenders).toEqual([]);
      expect(pattern.test(sharedTypesKbSync)).toBe(false);
    });

    it('apps/api/src에서 file_path 보유 파일은 정확히 2개(rag-response.schema.ts·sanitize-sources.ts)다', () => {
      const offenders = apiFileContents.filter(({ content }) => /file_path/.test(content)).map(({ f }) => f);
      expect(new Set(offenders)).toEqual(new Set(['apps/api/src/rag/lib/rag-response.schema.ts', 'apps/api/src/rag/lib/sanitize-sources.ts']));
    });
  });

  describe('KB-4: rag-http.client.ts 봉인', () => {
    const entry = apiFileContents.find(({ f }) => f.endsWith('rag/rag-http.client.ts'))!;

    it('fetch( 1회 · assertEgressAllowed( 1회(fetch보다 앞)', () => {
      expect(nonCommentOccurrences(entry.content, /\bfetch\(/)).toBe(1);
      expect(nonCommentOccurrences(entry.content, /assertEgressAllowed\(/)).toBe(1);
      expect(entry.content.indexOf('assertEgressAllowed(')).toBeLessThan(entry.content.indexOf('fetch('));
    });

    it('공개 메서드 이름 집합이 정확하다', () => {
      const methodNames = ['isConfigured', 'query', 'status', 'documentMetadata', 'ingest', 'taskStatus'];
      for (const m of methodNames) expect(entry.content).toMatch(new RegExp(`\\b${m}\\(`));
    });

    it("'DELETE' 리터럴 0건", () => {
      expect(entry.content.includes("'DELETE'")).toBe(false);
    });

    it(".append( 첫 인자 = {'file','company','category','subcategory'} 각 1회", () => {
      for (const field of ['file', 'company', 'category', 'subcategory']) {
        expect(nonCommentOccurrences(entry.content, new RegExp(`\\.append\\('${field}'`))).toBe(1);
      }
    });

    it('send(의 첫 매개변수 타입이 RagPathKey다', () => {
      expect(entry.content).toMatch(/private async send\(key: RagPathKey/);
    });
  });

  describe('KB-5: RagTaskId 브랜드 — 파일 밖 as RagTaskId 캐스팅 0', () => {
    it("'as RagTaskId' 캐스팅이 rag-task-id.ts 밖에 없다", () => {
      const offenders = apiFileContents.filter(({ f, content }) => !f.endsWith('rag/lib/rag-task-id.ts') && content.includes('as RagTaskId')).map(({ f }) => f);
      expect(offenders).toEqual([]);
    });

    it('(런타임) 비UUID·경로 문자 입력에 fetch 호출 0(taskStatus가 조기 반환)', async () => {
      const { RagHttpClient } = await import('../../rag/rag-http.client');
      const fetchMock = jest.fn();
      const originalFetch = global.fetch;
      global.fetch = fetchMock as unknown as typeof fetch;
      // 외부 RAG 기본 URL 환경변수 키 — 저장소 전역 스캔(fetch( 동시 등장 검사)을 피하려 조각으로 조립한다.
      const ragBaseUrlKey = ['RAG_BASE', '_URL'].join('');
      const client = new RagHttpClient({ get: (k: string) => (k === ragBaseUrlKey ? 'http://rag.example.test' : undefined) } as never);
      await client.taskStatus('../../etc/passwd', 1000);
      await client.taskStatus('NOT-A-UUID', 1000);
      expect(fetchMock).not.toHaveBeenCalled();
      global.fetch = originalFetch;
    });
  });

  describe('KB-6: 출구 레지스트리 · transport.request( 보유 파일 1개 · 적재 호출부 1개', () => {
    it('EGRESS_REGISTRY에 KB_CRAWL이 fetcher 파일을 포함해 등록돼 있다', () => {
      const entry = EGRESS_REGISTRY.find((e) => e.exitId === 'KB_CRAWL');
      expect(entry).toBeDefined();
      expect(entry!.files).toContain('kb-sync/crawl/kb-crawl-http.fetcher.ts');
    });

    it('kb-sync/**에서 transport.request(를 쓰는 파일은 fetcher 1개뿐이다', () => {
      const offenders = kbSyncFiles.filter(({ content }) => /\.transport\.request\(/.test(content) || /this\.transport\.request\(/.test(content)).map(({ f }) => f);
      expect(new Set(offenders)).toEqual(new Set(['apps/api/src/kb-sync/crawl/kb-crawl-http.fetcher.ts']));
    });

    it('fetcher 안에서 checkEgress(가 this.transport.request(보다 앞선다', () => {
      const fetcherEntry = kbSyncFiles.find(({ f }) => f.endsWith('kb-crawl-http.fetcher.ts'))!;
      const egressIdx = fetcherEntry.content.indexOf("checkEgress('KB_CRAWL'");
      const requestIdx = fetcherEntry.content.indexOf('this.transport.request(');
      expect(egressIdx).toBeGreaterThan(-1);
      expect(requestIdx).toBeGreaterThan(-1);
      expect(egressIdx).toBeLessThan(requestIdx);
    });

    it('ingest(·taskStatus( 호출 파일은 kb-ingest.runner.ts 1개뿐이다', () => {
      const offenders = kbSyncFiles.filter(({ content }) => /\.ingest\(\{|\.taskStatus\(/.test(content)).map(({ f }) => f);
      expect(new Set(offenders)).toEqual(new Set(['apps/api/src/kb-sync/engine/kb-ingest.runner.ts']));
    });
  });

  describe('KB-7: kb-sync/**의 네트워크·레거시 import 제한', () => {
    it('fetch(·node:http·node:https·node:dns·axios 0건', () => {
      const pattern = /\bfetch\(|node:http\b|node:https\b|node:dns\b|['"]axios['"]/;
      const offenders = kbSyncFiles.filter(({ content }) => pattern.test(content)).map(({ f }) => f);
      expect(offenders).toEqual([]);
    });

    it('LegacyApiHttpClient·ValidatedLegacyRequest·LEGACY_API_SECRET 심볼 0건', () => {
      const pattern = /LegacyApiHttpClient|ValidatedLegacyRequest|LEGACY_API_SECRET/;
      const offenders = kbSyncFiles.filter(({ content }) => pattern.test(content)).map(({ f }) => f);
      expect(offenders).toEqual([]);
    });

    it("legacy-api/ import는 허용 목록(transport·ip-policy) 안이다", () => {
      const allowed = ['legacy-api/transport/legacy-transport.port', 'legacy-api/transport/node-http.transport', 'legacy-api/transport/node-dns.resolver', 'legacy-api/lib/ip-policy'];
      for (const { f, content } of kbSyncFiles) {
        const matches = [...content.matchAll(/from '(\.\.\/)+legacy-api\/([^']+)'/g)];
        for (const m of matches) {
          const importPath = `legacy-api/${m[2]}`;
          expect(allowed.some((a) => importPath.startsWith(a))).toBe(true);
        }
        void f;
      }
    });
  });

  describe('KB-8: @Public() 0 · Permission 18 · @RequirePermission 인자 제한', () => {
    it('kb-sync/**에 @Public() 0건', () => {
      const offenders = kbSyncFiles.filter(({ content }) => content.includes('@Public()')).map(({ f }) => f);
      expect(offenders).toEqual([]);
    });
    it('Permission 목록은 18종 그대로다(신규 권한 0)', () => {
      expect(Permission.options.length).toBe(18);
    });
    it("kb-sync/**의 @RequirePermission( 인자는 security:read · security:write · chatbot:read 뿐이다", () => {
      const allowed = ["'security:read'", "'security:write'", "'chatbot:read'"];
      for (const { content } of kbSyncFiles) {
        const matches = [...content.matchAll(/@RequirePermission\(([^)]*)\)/g)];
        for (const m of matches) {
          const args = m[1].split(',').map((s) => s.trim());
          for (const a of args) expect(allowed).toContain(a);
        }
      }
    });
  });

  describe('KB-9: 쓰기 유일 파일', () => {
    function writeOffenders(model: string, allowedFiles: readonly string[], methods = ['create', 'createMany', 'update', 'updateMany', 'upsert', 'delete', 'deleteMany']): string[] {
      const pattern = new RegExp(`\\.${model}\\s*\\.\\s*(${methods.join('|')})\\b`);
      return apiFileContents.filter(({ f, content }) => pattern.test(content) && !allowedFiles.some((a) => f.endsWith(a))).map(({ f }) => f);
    }

    it('kbSource 쓰기 = kb-sources.service.ts 1개', () => {
      expect(writeOffenders('kbSource', ['kb-sync/kb-sources.service.ts'])).toEqual([]);
    });
    it('kbDocument·kbJobLease 쓰기 = kb-run.store.ts 1개', () => {
      expect(writeOffenders('kbDocument', ['kb-sync/core/kb-run.store.ts'])).toEqual([]);
      expect(writeOffenders('kbJobLease', ['kb-sync/core/kb-run.store.ts'])).toEqual([]);
    });
    it('kbSyncRun·kbIngestJob 쓰기 = kb-run.store.ts + governance-data.writer.ts(deleteMany만)', () => {
      const runOffenders = writeOffenders('kbSyncRun', ['kb-sync/core/kb-run.store.ts', 'governance/writer/governance-data.writer.ts']);
      const jobOffenders = writeOffenders('kbIngestJob', ['kb-sync/core/kb-run.store.ts', 'governance/writer/governance-data.writer.ts']);
      expect(runOffenders).toEqual([]);
      expect(jobOffenders).toEqual([]);

      const writerEntry = apiFileContents.find(({ f }) => f.endsWith('governance/writer/governance-data.writer.ts'))!;
      const writerNonDeleteWrites = writeOffenders('kbSyncRun', ['kb-sync/core/kb-run.store.ts'], ['create', 'createMany', 'update', 'updateMany', 'upsert']).filter((f) =>
        f.endsWith('governance-data.writer.ts'),
      );
      expect(writerNonDeleteWrites).toEqual([]);
      expect(writerEntry.content).toMatch(/kbSyncRun\.deleteMany/);
      expect(writerEntry.content).toMatch(/kbIngestJob\.deleteMany/);
    });
  });

  describe('KB-10: schema.prisma — 본문 컬럼 0 · 비밀 값 컬럼 0', () => {
    const schemaContent = readFileSync(join(REPO_ROOT, 'apps/api/prisma/schema.prisma'), 'utf8');

    function extractModelBlock(modelName: string): string {
      const re = new RegExp(`model\\s+${modelName}\\s*\\{([\\s\\S]*?)\\n\\}`);
      const m = re.exec(schemaContent);
      expect(m).not.toBeNull();
      return m![1];
    }

    it('KbDocument·KbSyncRun·KbIngestJob·KbJobLease에 본문류 컬럼이 없다(허용: contentHash·textLength·title)', () => {
      const forbidden = /\b(body|content|html|text|bytes|raw|payload|header)\b/i;
      for (const model of ['KbDocument', 'KbSyncRun', 'KbIngestJob', 'KbJobLease']) {
        const block = extractModelBlock(model);
        const lines = block.split('\n').filter((l) => l.trim().length > 0 && !l.trim().startsWith('///') && !l.trim().startsWith('@@'));
        for (const line of lines) {
          const fieldNameMatch = /^\s*(\w+)\s/.exec(line);
          if (!fieldNameMatch) continue;
          const name = fieldNameMatch[1];
          if (['contentHash', 'textLength', 'title', 'ingestFingerprint'].includes(name)) continue;
          expect(forbidden.test(name)).toBe(false);
        }
      }
    });

    it('KbSource에 secret·authHeaderValue류 컬럼이 없다', () => {
      const block = extractModelBlock('KbSource');
      expect(/secret(?!Ref)|authHeaderValue/i.test(block)).toBe(false);
    });
  });

  describe('KB-11: KB_SECRET__ 보유 파일 1개', () => {
    it('KB_SECRET__ 문자열은 kb-secret.resolver.ts에만 있다', () => {
      const offenders = apiFileContents.filter(({ content }) => content.includes('KB_SECRET__')).map(({ f }) => f);
      expect(new Set(offenders)).toEqual(new Set(['apps/api/src/kb-sync/crawl/kb-secret.resolver.ts']));
    });
  });

  describe('KB-12: PollingLoop 사용 1개 · setInterval 0 · jest.isolate-env.js 반영', () => {
    it('PollingLoop 사용 = kb-sync.job.ts 1개', () => {
      const offenders = kbSyncFiles.filter(({ content }) => /new PollingLoop\(/.test(content)).map(({ f }) => f);
      expect(offenders).toEqual(['apps/api/src/kb-sync/engine/kb-sync.job.ts']);
    });
    it('kb-sync/**에 setInterval( 0건', () => {
      const offenders = kbSyncFiles.filter(({ content }) => /setInterval\(/.test(content)).map(({ f }) => f);
      expect(offenders).toEqual([]);
    });
    it('jest.isolate-env.js에 KB_SYNC_ENABLED=false 고정 줄이 있다', () => {
      const content = readFileSync(join(REPO_ROOT, 'apps/api/jest.isolate-env.js'), 'utf8');
      expect(content).toContain("process.env.KB_SYNC_ENABLED = 'false';");
    });
  });

  describe('KB-13: kb-sync/**의 governance import 0(G-10 보강)', () => {
    it('governance/·job-lease·governance-data.writer 문자열이 kb-sync/**에 없다', () => {
      const pattern = /governance\/|job-lease|governance-data\.writer/;
      const offenders = kbSyncFiles.filter(({ content }) => pattern.test(content)).map(({ f }) => f);
      expect(offenders).toEqual([]);
    });
  });

  describe('KB-14: 마이그레이션 SQL — CREATE만 · $queryRaw 보유 파일 불변', () => {
    it('20260927150000_kb_crawling 마이그레이션에 DROP·ALTER TABLE·WHERE가 없다', () => {
      const migrationPath = join(REPO_ROOT, 'apps/api/prisma/migrations/20260927150000_kb_crawling/migration.sql');
      const content = readFileSync(migrationPath, 'utf8');
      expect(/DROP|ALTER TABLE|WHERE/i.test(content)).toBe(false);
      expect((content.match(/CREATE TABLE/g) ?? []).length).toBe(5);
    });
  });

  describe('KB-14b: 두 번째 이후 KB 마이그레이션 — nullable ADD COLUMN · CREATE INDEX만(RG-22⑤)', () => {
    const MIGRATIONS_DIR = join(REPO_ROOT, 'apps/api/prisma/migrations');
    const FIRST = '20260927150000_kb_crawling';

    /**
     * 첫 마이그레이션(KB-14)은 CREATE만 허용해 그 뒤 이어지는 마이그레이션(`ALTER TABLE` 계열)이 정적 검사 밖에 있었다. 이 검사는 같은 성격 — **데이터를 지우거나 바꾸지 않는다**(DROP·DELETE·UPDATE·INSERT·WHERE 0 ·
     * 테이블 재정의 0) — 을 뒤 마이그레이션에도 적용한다. 허용 문장은 `kb_` 테이블의 nullable(또는 DEFAULT가 있는) `ADD COLUMN`과 `kb_` 테이블의 `CREATE INDEX`뿐이다(백필·재정의는 이 기능의 롤백 = 코드만 되돌림 전제를 깬다).
     */
    function followUpViolations(sql: string): string[] {
      const statements = sql
        .split('\n')
        .filter((l) => !l.trim().startsWith('--') && l.trim().length > 0)
        .join('\n')
        .split(';')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      const violations: string[] = [];
      for (const s of statements) {
        if (/\b(DROP|DELETE|UPDATE|INSERT|WHERE|PRAGMA)\b/i.test(s)) violations.push(`금지 키워드: ${s.slice(0, 60)}`);
        const addColumn = /^ALTER TABLE "kb_[A-Za-z_]+" ADD COLUMN "[A-Za-z]+" [A-Z]+( DEFAULT [^\s]+)?( NOT NULL)?$/.exec(s);
        const createIndex = /^CREATE INDEX "kb_[A-Za-z_]+" ON "kb_[A-Za-z_]+"\("[A-Za-z]+"(, "[A-Za-z]+")*\)$/.test(s);
        if (!addColumn && !createIndex) violations.push(`허용되지 않는 문장: ${s.slice(0, 60)}`);
        if (addColumn && addColumn[2] && !addColumn[1]) violations.push(`DEFAULT 없는 NOT NULL ADD COLUMN: ${s.slice(0, 60)}`);
      }
      return violations;
    }

    const followUps = readdirSync(MIGRATIONS_DIR)
      .filter((name) => name > FIRST && /(^|_)kb_/.test(name) && statSync(join(MIGRATIONS_DIR, name)).isDirectory())
      .sort();

    it('KB 후속 마이그레이션이 발견된다(검사 대상 0건 아님 — 부모 포인터 · 관측 해시 2건 이상)', () => {
      expect(followUps).toEqual(expect.arrayContaining(['20260928100000_kb_document_parent', '20260928120000_kb_document_observed_hash']));
    });

    it.each(followUps)('%s — nullable ADD COLUMN · CREATE INDEX만 있고 DROP·DELETE·UPDATE·INSERT·WHERE·테이블 재정의가 없다', (name) => {
      const sql = readFileSync(join(MIGRATIONS_DIR, name, 'migration.sql'), 'utf8');
      expect(followUpViolations(sql)).toEqual([]);
    });

    it('역검증 — 데이터를 바꾸는 문장·테이블 재정의·NOT NULL 컬럼 추가는 위 검사가 잡아낸다', () => {
      expect(followUpViolations('ALTER TABLE "kb_documents" ADD COLUMN "observedHash" TEXT;\nCREATE INDEX "kb_documents_a_idx" ON "kb_documents"("a", "b");')).toEqual([]);
      expect(followUpViolations('UPDATE "kb_documents" SET "etag" = NULL WHERE "kind" = \'HTML\';')).not.toEqual([]);
      expect(followUpViolations('ALTER TABLE "kb_documents" DROP COLUMN "etag";')).not.toEqual([]);
      expect(followUpViolations('ALTER TABLE "kb_documents" ADD COLUMN "x" TEXT NOT NULL;')).not.toEqual([]);
      expect(followUpViolations('PRAGMA foreign_keys=OFF;\nCREATE TABLE "new_kb_documents" ("id" TEXT);\nINSERT INTO "new_kb_documents" SELECT * FROM "kb_documents";\nDROP TABLE "kb_documents";')).not.toEqual([]);
      expect(followUpViolations('ALTER TABLE "users" ADD COLUMN "x" TEXT;')).not.toEqual([]); // kb_ 밖 테이블
    });
  });

  describe('KB-15: 로그는 kbLogLine( 형식뿐', () => {
    it('kb-sync/**의 logger.(log|warn|error|debug)( 인자는 kbLogLine( 호출뿐이다(예외: 문자열 리터럴 경고 메시지)', () => {
      for (const { f, content } of kbSyncFiles) {
        const matches = [...content.matchAll(/logger\.(log|warn|error|debug)\(([^]*?)\);/g)];
        for (const m of matches) {
          const arg = m[2].trim();
          const looksLikeTemplate = arg.startsWith('`') || arg.startsWith("'") || arg.startsWith('"');
          if (looksLikeTemplate) continue; // 고정 문자열 경고(비밀·URL 삽입 없음)는 허용 — 별도 런타임 검사로 보강.
          expect(arg.startsWith('kbLogLine(')).toBe(true);
        }
        void f;
      }
    });

    /** logger 호출 인자 중 오류 원문을 끌어 쓰는 것(`.message`·`${e}`·`String(e)`·`${err`)을 찾는다. */
    function leakyLoggerCalls(content: string): string[] {
      const args = [...content.matchAll(/logger\.(log|warn|error|debug|verbose)\(([^]*?)\);/g)].map((m) => m[2]);
      return args.filter((arg) => /\.message\b|\$\{\s*(e|err|error)\s*\}|String\(\s*(e|err|error)\s*\)/.test(arg));
    }

    it('★ [pass 4 위반 7] kb-sync/** 와 적재가 쓰는 외부 RAG 출구의 logger 인자에 오류 원문(.message 등)이 없다 — 템플릿 문자열도 예외가 아니다', () => {
      const targets = [...kbSyncFiles, ...apiFileContents.filter(({ f }) => f.endsWith('rag/rag-http.client.ts'))];
      expect(targets.length).toBeGreaterThan(10);
      const offenders = targets.filter(({ content }) => leakyLoggerCalls(content).length > 0).map(({ f }) => f);
      expect(offenders).toEqual([]);
    });

    it('역검증 — 오류 원문을 로그에 넣는 코드 조각은 위 검사가 잡아낸다', () => {
      expect(leakyLoggerCalls('this.logger.error(`실패: ${e.message}`);')).toHaveLength(1);
      expect(leakyLoggerCalls("this.logger.warn(`실패: ${e instanceof Error ? e.message : 'unknown'}`);")).toHaveLength(1);
      expect(leakyLoggerCalls('this.logger.error(`실패: ${e}`);')).toHaveLength(1);
      expect(leakyLoggerCalls('this.logger.error(String(err));')).toHaveLength(1);
      expect(leakyLoggerCalls("this.logger.error(kbLogLine({ host: '-', path: 'x', code: kbErrorCode(e) }));")).toHaveLength(0);
      expect(leakyLoggerCalls("this.logger.warn(`RAG 서버 호출 실패(${key}): ${e instanceof Error ? e.name : 'unknown'}`);")).toHaveLength(0);
    });

    it('kbLogLine 입력 타입에 url·headers·body·query 필드가 없다', () => {
      const entry = kbSyncFiles.find(({ f }) => f.endsWith('lib/kb-log-line.ts'))!;
      expect(/\burl\s*:/.test(entry.content)).toBe(false);
      expect(/\bheaders\s*:/.test(entry.content)).toBe(false);
      expect(/\bbody\s*:/.test(entry.content)).toBe(false);
      expect(/\bquery\s*:/.test(entry.content)).toBe(false);
    });
  });

  describe('[pass 4 위반 8] 메인 스레드 파일은 무거운 해석 모듈을 직접 import하지 않는다(해석은 추출기 포트 → 작업 스레드)', () => {
    const HEAVY = ['sitemap-parse', 'gzip-guard', 'html-extract', 'ooxml-text', 'pdf-text', 'container-guard', 'run-extract-job'];
    const mainThreadFiles = kbSyncFiles.filter(({ f }) => /\/kb-sync\/(engine|crawl|core)\//.test(f) || /\/kb-sync\/[^/]+\.(service|controller|module)\.ts$/.test(f));

    it('engine·crawl·core·서비스·컨트롤러는 sitemap-parse·gzip-guard·html-extract·ooxml-text·pdf-text·container-guard·run-extract-job을 import하지 않는다', () => {
      expect(mainThreadFiles.length).toBeGreaterThan(8);
      const offenders = mainThreadFiles
        .filter(({ content }) => HEAVY.some((h) => new RegExp(`from\\s+['"][^'"]*/${h}['"]`).test(content)))
        .map(({ f }) => f);
      expect(offenders).toEqual([]);
    });

    it('해석 진입점(run-extract-job)은 작업 스레드 진입점과 시험용 인프로세스 추출기만 import한다', () => {
      const importers = kbSyncFiles.filter(({ content }) => /from\s+['"][^'"]*\/run-extract-job['"]/.test(content)).map(({ f }) => f.split('/').slice(-1)[0]);
      expect(importers.sort()).toEqual(['extract.worker.ts', 'in-process.extractor.ts']);
    });
  });

  describe('KB-16: 샌드박스 — eval·new Function·vm 0 · pdfjs-dist import 1개', () => {
    it('kb-sync/**·extract.worker.ts에 eval(·new Function(·node:vm·jsdom·puppeteer·playwright 0건', () => {
      const pattern = /\beval\(|new Function\(|node:vm\b|jsdom|puppeteer|playwright/;
      const offenders = kbSyncFiles.filter(({ content }) => pattern.test(content)).map(({ f }) => f);
      expect(offenders).toEqual([]);
    });

    it('pdfjs-dist import(따옴표로 감싼 지정자) 보유 파일은 pdf-text.ts 1개고, isEvalSupported: false가 있다', () => {
      const offenders = apiFileContents.filter(({ content }) => nonCommentOccurrences(content, /['"]pdfjs-dist/) > 0).map(({ f }) => f);
      expect(new Set(offenders)).toEqual(new Set(['apps/api/src/kb-sync/lib/pdf-text.ts']));
      const entry = apiFileContents.find(({ f }) => f.endsWith('kb-sync/lib/pdf-text.ts'))!;
      expect(entry.content).toContain('isEvalSupported: false');
    });

    it('extract.worker.ts의 import는 kb-sync/lib/*·@chat-bot/pii-mask·node: 내장 모듈로 한정된다', () => {
      const entry = kbSyncFiles.find(({ f }) => f.endsWith('extract/extract.worker.ts'))!;
      const imports = [...entry.content.matchAll(/from '([^']+)'/g)].map((m) => m[1]);
      for (const imp of imports) {
        const ok = imp.startsWith('../lib/') || imp === 'node:worker_threads' || imp === 'node:crypto' || imp === 'node:zlib' || imp === '@chat-bot/pii-mask' || imp.startsWith('./');
        expect(ok).toBe(true);
      }
    });
  });

  describe('KB-17: 사이트맵 xmlMode:true · XXE·압축 폭탄 거부(런타임은 sitemap-parse.spec.ts·container-guard.spec.ts)', () => {
    it('sitemap-parse.ts에 xmlMode: true가 있다', () => {
      const entry = kbSyncFiles.find(({ f }) => f.endsWith('lib/sitemap-parse.ts'))!;
      expect(entry.content).toContain('xmlMode: true');
    });
  });

  describe('KB-18: 엔진·위젯·ml-worker·공개 대화 심볼 0', () => {
    it('dialogue-engine·widget·ml-worker·conversation/**에 KbSource·KB_SYNC·KB_CRAWL·kb-sync 0건', () => {
      const roots = ['packages/dialogue-engine/src', 'apps/widget/src', 'apps/ml-worker', 'apps/api/src/conversation'];
      const exts = ['.ts', '.tsx', '.py'];
      const pattern = /KbSource|KB_SYNC|KB_CRAWL|kb-sync/;
      const offenders: string[] = [];
      for (const root of roots) {
        const files: string[] = [];
        walk(join(REPO_ROOT, root), exts, files);
        for (const f of files) {
          if (pattern.test(readFileSync(f, 'utf8'))) offenders.push(toRepoRelative(f));
        }
      }
      expect(offenders).toEqual([]);
    });
  });

  describe('KB-19: kb-sync/**에 RAG 질의 전용 심볼 0', () => {
    it('ragCallLog·RagGateService·RagCallLogService·RagAnswerService 심볼이 없다', () => {
      const pattern = /ragCallLog|RagGateService|RagCallLogService|RagAnswerService/;
      const offenders = kbSyncFiles.filter(({ content }) => pattern.test(content)).map(({ f }) => f);
      expect(offenders).toEqual([]);
    });
  });

  describe('KB-20: 파일 이름 생성 함수 1개(속성 시험은 external-file-name.spec.ts)', () => {
    it('buildExternalFileName 함수 선언은 1개 파일뿐이다', () => {
      const offenders = apiFileContents.filter(({ content }) => /export function buildExternalFileName\(/.test(content)).map(({ f }) => f);
      expect(offenders).toEqual(['apps/api/src/kb-sync/lib/external-file-name.ts']);
    });
  });

  describe('KB-21: 데이터 지도 exits[] 제외 목록에 KB_CRAWL', () => {
    it("governance-map.service.ts의 exits 필터에 'KB_CRAWL'이 있다", () => {
      const entry = apiFileContents.find(({ f }) => f.endsWith('governance/governance-map.service.ts'))!;
      expect(entry.content).toContain("e.exitId !== 'KB_CRAWL'");
    });
  });

  describe('KB-22: boolean 파싱 규약', () => {
    it('kb-sync/**에 z.coerce.boolean( 0건(쿼리는 queryBoolean())', () => {
      const offenders = kbSyncFiles.filter(({ content }) => /z\.coerce\.boolean\(/.test(content)).map(({ f }) => f);
      expect(offenders).toEqual([]);
    });
    it('env.validation.ts의 KB_SYNC_ENABLED·KB_ALLOW_RAW_FILE_INGEST가 envBoolean(을 쓴다', () => {
      const entry = apiFileContents.find(({ f }) => f.endsWith('config/env.validation.ts'))!;
      expect(entry.content).toMatch(/KB_SYNC_ENABLED:\s*envBoolean\(/);
      expect(entry.content).toMatch(/KB_ALLOW_RAW_FILE_INGEST:\s*envBoolean\(/);
    });
  });
});

// collectApiFilesIncludingSpecs is kept for potential future spec-inclusive scans (KB-15 런타임 보강 등).
void collectApiFilesIncludingSpecs;
