import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { ApiConditionOutputPayloadV2Schema, ConversationStateSchema, CONVERSATION_STATE_VERSION } from '@chat-bot/shared-types';

/**
 * [No.26] 정적 검사 — `docs/02-spec/legacy-api-integration-설계.md` §13 L-1~L-14.
 * ⚠ 검사기 자신이 탐지어를 포함하면 안 되므로 조각으로 조립한다(rag-allowlist.spec.ts 방식).
 */

const REPO_ROOT = resolve(__dirname, '../../../../..');
const SELF_ABSOLUTE = resolve(__dirname, 'legacy-api-sealing.spec.ts');

interface FileEntry {
  path: string;
  relative: string;
  content: string;
}

function walk(dir: string, extensions: string[], out: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry === 'node_modules' || entry === 'dist') continue;
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      walk(fullPath, extensions, out);
    } else if (extensions.some((ext) => entry.endsWith(ext))) {
      out.push(fullPath);
    }
  }
}

function collect(scanRoots: string[]): FileEntry[] {
  const files: string[] = [];
  for (const root of scanRoots) walk(join(REPO_ROOT, root), ['.ts', '.tsx'], files);
  return files
    .filter((f) => f !== SELF_ABSOLUTE)
    .filter((f) => !f.endsWith('.spec.ts'))
    .filter((f) => !f.includes(`${sep}integration${sep}`))
    .map((f) => ({ path: f, relative: f.slice(REPO_ROOT.length + 1).replace(/\\/g, '/'), content: readFileSync(f, 'utf8') }));
}

const apiFiles = collect(['apps/api/src']);
const engineFiles = collect(['packages/dialogue-engine/src']);
const allFiles = [...apiFiles, ...engineFiles];

function endsWithPath(relative: string, suffix: string): boolean {
  return relative.endsWith(suffix);
}

describe('레거시 API 연동(No.26) 정적 검사 — legacy-api-integration-설계.md §13', () => {
  it('스캔 대상 파일이 존재한다(회귀 방지)', () => {
    expect(apiFiles.length).toBeGreaterThan(50);
    expect(engineFiles.length).toBeGreaterThan(5);
  });

  it('L-1: LEGACY_API_SECRET__ 문자열 보유 파일은 legacy-api-secret.resolver.ts 1개다(FR-0-98)', () => {
    const needle = ['LEGACY_API_SECRET', '__'].join('');
    const offenders = allFiles.filter((f) => f.content.includes(needle) && !endsWithPath(f.relative, 'legacy-api/legacy-api-secret.resolver.ts'));
    expect(offenders.map((f) => f.relative)).toEqual([]);
  });

  it('L-2: node:http(s) import는 node-http.transport.ts 1개, node:dns import는 node-dns.resolver.ts 1개다', () => {
    const httpNeedles = ["from 'node:http'", "from 'node:https'", "from 'http'", "from 'https'"];
    const dnsNeedles = ["from 'node:dns'", "from 'dns'"];
    const httpOffenders = allFiles.filter(
      (f) => httpNeedles.some((n) => f.content.includes(n)) && !endsWithPath(f.relative, 'legacy-api/transport/node-http.transport.ts'),
    );
    const dnsOffenders = allFiles.filter(
      (f) => dnsNeedles.some((n) => f.content.includes(n)) && !endsWithPath(f.relative, 'legacy-api/transport/node-dns.resolver.ts'),
    );
    expect(httpOffenders.map((f) => f.relative)).toEqual([]);
    expect(dnsOffenders.map((f) => f.relative)).toEqual([]);
  });

  it('L-3: ValidatedLegacyRequest 브랜드 심볼 생성은 build-request.ts 1개다', () => {
    const needle = ['VALIDATED_LEGACY_REQUEST', '_BRAND: unique symbol'].join('');
    const offenders = allFiles.filter((f) => f.content.includes(needle) && !endsWithPath(f.relative, 'legacy-api/lib/build-request.ts'));
    expect(offenders.map((f) => f.relative)).toEqual([]);
  });

  it('L-4: LegacyApiHttpClient 생성자 주입은 legacy-api.service.ts 1개다', () => {
    const needle = 'LegacyApiHttpClient';
    const offenders = apiFiles.filter(
      (f) =>
        f.content.includes(needle) &&
        !endsWithPath(f.relative, 'legacy-api/legacy-api.service.ts') &&
        !endsWithPath(f.relative, 'legacy-api/legacy-api-http.client.ts') &&
        !endsWithPath(f.relative, 'legacy-api/legacy-api.module.ts'),
    );
    expect(offenders.map((f) => f.relative)).toEqual([]);
  });

  it('L-5: packages/dialogue-engine/src에 I/O·타이머·process.env·Nest·Prisma 심볼이 0건이다(FR-0-96)', () => {
    const needles = [
      'fetch(',
      "from 'node:",
      "'http'",
      "'https'",
      "'net'",
      "'dns'",
      "'undici'",
      'setTimeout(',
      'setInterval(',
      'process.env',
      '@nestjs',
      '@prisma',
    ];
    const offenders = engineFiles.filter((f) => needles.some((n) => f.content.includes(n)));
    expect(offenders.map((f) => f.relative)).toEqual([]);
  });

  it('L-6: validation/**·versions/**·deploy-schedules/**에 legacy-api/ import·LegacyApiService 참조가 0건이다(FR-0-102)', () => {
    const importRe = /from\s+['"][^'"]*legacy-api\//;
    const targets = apiFiles.filter(
      (f) => f.relative.includes('/validation/') || f.relative.includes('/versions/') || f.relative.includes('/deploy-schedules/'),
    );
    const offenders = targets.filter((f) => importRe.test(f.content) || f.content.includes('LegacyApiService'));
    expect(offenders.map((f) => f.relative)).toEqual([]);
  });

  it('L-7: apiCallLog.create 호출 파일은 api-call-log.service.ts 1개다(AC-L5-2)', () => {
    const needle = 'apiCallLog.create';
    const offenders = apiFiles.filter((f) => f.content.includes(needle) && !endsWithPath(f.relative, 'legacy-api/api-call-log.service.ts'));
    expect(offenders.map((f) => f.relative)).toEqual([]);
  });

  it('L-9(런타임): ApiConditionOutputPayloadV2Schema의 키 집합에 headers·url·bodyTemplate이 없다', () => {
    // `.superRefine()`이 ZodObject를 ZodEffects로 감싸므로 내부 스키마의 shape을 본다.
    const inner = (ApiConditionOutputPayloadV2Schema as unknown as { _def: { schema: { shape: Record<string, unknown> } } })._def.schema;
    const keys = Object.keys(inner.shape);
    expect(keys).not.toContain('headers');
    expect(keys).not.toContain('url');
    expect(keys).not.toContain('bodyTemplate');
  });

  it('L-10: apiConnection 쓰기 호출(create·update·updateMany·upsert·delete·deleteMany)은 api-connections.service.ts와 chatbots.service.ts(영구삭제)뿐이다', () => {
    const needles = ['apiConnection.create', 'apiConnection.update', 'apiConnection.upsert', 'apiConnection.delete'];
    const offenders = apiFiles.filter(
      (f) =>
        needles.some((n) => f.content.includes(n)) &&
        !endsWithPath(f.relative, 'api-connections/api-connections.service.ts') &&
        !endsWithPath(f.relative, 'chatbots/chatbots.service.ts'),
    );
    expect(offenders.map((f) => f.relative)).toEqual([]);
  });

  it('L-11: api-connections/catalog/**에 legacy-api/ import가 0건이다(카탈로그는 출구가 아니다)', () => {
    const importRe = /from\s+['"][^'"]*legacy-api\//;
    const offenders = apiFiles.filter((f) => f.relative.includes('/api-connections/catalog/') && importRe.test(f.content));
    expect(offenders.map((f) => f.relative)).toEqual([]);
  });

  it('L-12(런타임): CONVERSATION_STATE_VERSION===1이고 ConversationStateSchema 키 집합이 불변이다(FR-0-101)', () => {
    expect(CONVERSATION_STATE_VERSION).toBe(1);
    const shape = (ConversationStateSchema as unknown as { shape: Record<string, unknown> }).shape;
    expect(new Set(Object.keys(shape))).toEqual(new Set(['version', 'contextSession', 'pendingClarify']));
  });

  it('L-14(휴리스틱): legacy-api/**의 logger 호출 인자에 url·body·headers·.message 식별자가 없다', () => {
    const loggerCallRe = /logger\.(log|warn|error|debug)\(([^;]*?)\)/gs;
    const forbiddenIdentifierRe = /\b(url|body|headers)\b|\.message\b/;
    const offenders: string[] = [];
    for (const f of apiFiles) {
      if (!f.relative.startsWith('apps/api/src/legacy-api/')) continue;
      let match: RegExpExecArray | null;
      while ((match = loggerCallRe.exec(f.content))) {
        if (forbiddenIdentifierRe.test(match[2])) offenders.push(`${f.relative}: ${match[0].slice(0, 80)}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
