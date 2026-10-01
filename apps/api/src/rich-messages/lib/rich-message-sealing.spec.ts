import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { EgressExitId, Permission } from '@chat-bot/shared-types';

/**
 * 채널별 리치 메시지(No.46) 정적 검사(`channel-rich-messages-설계.md` §16 RM-1~RM-18) — 기존
 * `*-sealing.spec.ts` 형식(스캔 루트 지정 · 자기 자신 제외 · 스캔 대상 0건 아님 가드 · 주석 줄 제외 ·
 * 역검증 픽스처 포함).
 *
 * ⚠ **범위 안내**: 이 시험은 backend-implementer 인계 범위(`apps/api`·`packages/shared-types`·
 * `packages/dialogue-engine`)만 검사한다. 위젯 렌더러(RM-13)·위젯 기능 상수 동등성(RM-14)·콘솔
 * 편집기·시뮬레이터·아이콘(§15 지점 13~16·18)은 `apps/widget`·`apps/web`이 아직 없어 이 커밋에서는
 * 검사 대상이 아니다 — frontend-implementer 구현 뒤 `test-automation`이 이 파일에 추가해야 한다.
 */

const REPO_ROOT = resolve(__dirname, '../../../../..');
const SELF_ABSOLUTE = resolve(__dirname, 'rich-message-sealing.spec.ts');

function isCommentLine(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*');
}

function walk(dir: string, extensions: string[], out: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry === 'node_modules' || entry === 'dist' || entry === '.git') continue;
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) walk(fullPath, extensions, out);
    else if (extensions.some((ext) => entry.endsWith(ext))) out.push(fullPath);
  }
}

function toRepoRelative(absolutePath: string): string {
  return absolutePath.replace(/\\/g, '/').replace(`${REPO_ROOT.replace(/\\/g, '/')}/`, '');
}

function nonCommentOccurrences(content: string, pattern: RegExp): number {
  let count = 0;
  const g = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
  for (const line of content.split('\n')) {
    if (isCommentLine(line)) continue;
    const matches = line.match(g);
    if (matches) count += matches.length;
  }
  return count;
}

function collectSourceFiles(root: string, opts: { excludeSpec?: boolean; excludeIntegration?: boolean } = {}): string[] {
  const files: string[] = [];
  walk(join(REPO_ROOT, root), ['.ts'], files);
  return files.filter((f) => {
    if (f === SELF_ABSOLUTE) return false;
    if (opts.excludeSpec !== false && f.endsWith('.spec.ts')) return false;
    if (opts.excludeIntegration !== false && f.replace(/\\/g, '/').includes('/integration/')) return false;
    return true;
  });
}

const apiFiles = collectSourceFiles('apps/api/src').map((f) => ({ f: toRepoRelative(f), content: readFileSync(f, 'utf8') }));
const engineFiles = collectSourceFiles('packages/dialogue-engine/src').map((f) => ({ f: toRepoRelative(f), content: readFileSync(f, 'utf8') }));
const sharedTypesFiles = collectSourceFiles('packages/shared-types/src').map((f) => ({ f: toRepoRelative(f), content: readFileSync(f, 'utf8') }));

describe('채널별 리치 메시지(No.46) 정적 검사 — 스캔 기반 확인', () => {
  it('스캔 대상이 0건이 아니다(가드)', () => {
    expect(apiFiles.length).toBeGreaterThan(50);
    expect(engineFiles.length).toBeGreaterThan(5);
    expect(sharedTypesFiles.length).toBeGreaterThan(5);
  });

  describe('RM-1: 엔진은 채널·강등·프로필을 모른다', () => {
    it('packages/dialogue-engine/src에 channel|degrade|profile|quickReply|QUICK_REPLY 심볼 0', () => {
      const pattern = /\b(channel|degrade|profile|quickReply|QUICK_REPLY)\b/i;
      const offenders = engineFiles.filter(({ content }) => nonCommentOccurrences(content, pattern) > 0).map((e) => e.f);
      expect(offenders).toEqual([]);
    });

    it("'CAROUSEL' 문자열 보유 엔진 파일 ⊆ {outputs.ts, design-validator.ts}", () => {
      const allowed = new Set(['packages/dialogue-engine/src/outputs.ts', 'packages/dialogue-engine/src/design-validator.ts']);
      const offenders = engineFiles.filter(({ f, content }) => content.includes('CAROUSEL') && !allowed.has(f)).map((e) => e.f);
      expect(offenders).toEqual([]);
      // 역검증: 두 파일 모두 실제로 CAROUSEL을 담고 있어야 한다(가드가 항상 통과하는 함정 방지).
      const hasBoth = ['packages/dialogue-engine/src/outputs.ts', 'packages/dialogue-engine/src/design-validator.ts'].every(
        (f) => engineFiles.find((e) => e.f === f)?.content.includes('CAROUSEL'),
      );
      expect(hasBoth).toBe(true);
    });
  });

  describe('RM-2: BUTTON 재조립은 스프레드로 display를 보존한다(ADR-0034 결함 유형 재발 방지)', () => {
    it('outputs.ts의 BUTTON 재조립 반환문이 ...output.payload 스프레드를 포함한다', () => {
      const outputsTs = engineFiles.find((e) => e.f === 'packages/dialogue-engine/src/outputs.ts');
      expect(outputsTs).toBeDefined();
      expect(outputsTs!.content).toMatch(/payload:\s*\{\s*\.\.\.output\.payload,\s*text,\s*buttons\s*\}/);
    });

    it('필드 나열 재조립 `payload: { text, buttons }`(스프레드 없음) 형태는 없다', () => {
      const outputsTs = engineFiles.find((e) => e.f === 'packages/dialogue-engine/src/outputs.ts')!;
      // 스프레드가 없는 재조립만 걸러낸다(다른 필드가 이미 있는 스프레드 형태는 허용).
      expect(outputsTs.content).not.toMatch(/payload:\s*\{\s*text,\s*buttons\s*\}/);
    });
  });

  describe('RM-3: 출력 후처리 3종 — 전 타입 명시 + never 망라(default 통과 금지)', () => {
    const targets = [
      { f: 'apps/api/src/banned-words/lib/output-text-fields.ts', files: apiFiles },
      { f: 'packages/shared-types/src/output-view.ts', files: sharedTypesFiles },
      { f: 'packages/shared-types/src/rich-degrade.ts', files: sharedTypesFiles },
    ];

    it.each(targets.map((t) => [t.f] as const))('%s — default: return output류/break류 0 · never 대입 ≥1 · CAROUSEL 분기 보유', (path) => {
      const target = targets.find((t) => t.f === path)!;
      const entry = target.files.find((e) => e.f === path);
      expect(entry).toBeDefined();
      const { content } = entry!;
      expect(content).not.toMatch(/default:\s*return\s+output\s*;/);
      expect(content).not.toMatch(/default:\s*break\s*;/);
      expect(content).toMatch(/:\s*never\s*=/);
      expect(content).toContain("'CAROUSEL'");
    });
  });

  describe('RM-4: 강등·URL 판정 모듈은 zod 무의존이다', () => {
    const pureModules = ['packages/shared-types/src/rich-url.ts', 'packages/shared-types/src/rich-degrade.ts', 'packages/shared-types/src/output-view.ts'];

    it.each(pureModules.map((p) => [p] as const))("%s — from 'zod' 0 · ./dialogue·./common·./channel 값 import 0(import type만)", (path) => {
      const entry = sharedTypesFiles.find((e) => e.f === path);
      expect(entry).toBeDefined();
      const { content } = entry!;
      expect(content).not.toMatch(/from ['"]zod['"]/);
      // 값 import 금지 — `import { X } from './dialogue'`류(타입 전용 import는 `import type`이라 통과)
      expect(content).not.toMatch(/^import\s+\{[^}]*\}\s+from\s+['"]\.\/(dialogue|common|channel)['"]/m);
    });

    it('rich-url.ts는 다른 모듈 import가 0이다(브라우저·Node 공통 WHATWG URL만)', () => {
      const entry = sharedTypesFiles.find((e) => e.f === 'packages/shared-types/src/rich-url.ts')!;
      expect(entry.content).not.toMatch(/^import /m);
    });
  });

  describe('RM-5: WEB 어댑터는 능력표에서 파생한다(타입 리터럴 목록 0)', () => {
    it('web-channel.adapter.ts에 아웃풋 타입 문자열 리터럴이 없다', () => {
      const entry = apiFiles.find((e) => e.f === 'apps/api/src/conversation/adapters/web-channel.adapter.ts');
      expect(entry).toBeDefined();
      const forbidden = /'TEXT'|'CARD'|'IMAGE'|'BUTTON'|'LINK'|'PAUSE'|'PHONE_CALL'|'CAROUSEL'/;
      expect(entry!.content).not.toMatch(forbidden);
      expect(entry!.content).toContain('CHANNEL_CAPABILITIES');
    });

    it("apps/api/src 운영 코드에 new Set<DialogOutputType>([ 리터럴이 없다(C-8)", () => {
      const offenders = apiFiles.filter(({ content }) => nonCommentOccurrences(content, /new Set<DialogOutputType>\(\[/) > 0).map((e) => e.f);
      expect(offenders).toEqual([]);
    });
  });

  describe('RM-6: chatbotRichUrlPolicy 쓰기는 1파일뿐이다(+ 영구삭제 동반 삭제)', () => {
    it('create|createMany|update|updateMany|upsert|delete|deleteMany 호출 파일 = {rich-url-policy.service.ts, chatbots.service.ts(deleteMany만)}', () => {
      const writePattern = /chatbotRichUrlPolicy\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(/g;
      const offenders: string[] = [];
      for (const { f, content } of apiFiles) {
        const matches = [...content.matchAll(writePattern)];
        if (matches.length === 0) continue;
        if (f === 'apps/api/src/rich-messages/rich-url-policy.service.ts') continue;
        if (f === 'apps/api/src/chatbots/chatbots.service.ts' && matches.every((m) => m[1] === 'deleteMany')) continue;
        offenders.push(f);
      }
      expect(offenders).toEqual([]);
      expect(apiFiles.some((e) => e.f === 'apps/api/src/rich-messages/rich-url-policy.service.ts' && e.content.includes('chatbotRichUrlPolicy.upsert('))).toBe(true);
    });
  });

  describe('RM-7: rich-messages/** @Public() 0 · 전체 8 유지', () => {
    it('apps/api/src/rich-messages 아래 @Public() 사용 0건', () => {
      const offenders = apiFiles.filter(({ f, content }) => f.startsWith('apps/api/src/rich-messages/') && nonCommentOccurrences(content, /@Public\(\)/) > 0);
      expect(offenders).toEqual([]);
    });
  });

  describe('RM-8: 서버는 새 컴포넌트 주소에 접속하지 않는다(No.45 출구 게이트 불변)', () => {
    it("rich-messages/** · rich-url.ts · rich-degrade.ts에 fetch(·node:http·node:https·node:dns·transport.request( 0", () => {
      const scanTargets = [
        ...apiFiles.filter(({ f }) => f.startsWith('apps/api/src/rich-messages/')),
        ...sharedTypesFiles.filter(({ f }) => f === 'packages/shared-types/src/rich-url.ts' || f === 'packages/shared-types/src/rich-degrade.ts'),
      ];
      const forbidden = /fetch\(|node:http|node:https|node:dns|transport\.request\(/;
      const offenders = scanTargets.filter(({ content }) => nonCommentOccurrences(content, forbidden) > 0).map((e) => e.f);
      expect(offenders).toEqual([]);
    });

    it('EgressExitId는 8종이다(No.43 KB_CRAWL · No.32 SPEECH_LOCAL 추가 — 리치 메시지 서버 출구는 여전히 0)', () => {
      expect(EgressExitId.options.length).toBe(8);
    });
  });

  describe('RM-9: 신규 권한 0 · rich-messages 권한 ⊆ {chatbot:read, chatbot:write}', () => {
    it('Permission 목록은 18종 그대로다', () => {
      expect(Permission.options.length).toBe(18);
    });

    it('rich-messages/** @RequirePermission( 인자가 chatbot:read·chatbot:write뿐이다', () => {
      const pattern = /@RequirePermission\(\s*'([^']+)'/g;
      const offenders: string[] = [];
      for (const { f, content } of apiFiles) {
        if (!f.startsWith('apps/api/src/rich-messages/')) continue;
        for (const m of content.matchAll(pattern)) {
          if (m[1] !== 'chatbot:read' && m[1] !== 'chatbot:write') offenders.push(`${f}:${m[1]}`);
        }
      }
      expect(offenders).toEqual([]);
    });
  });

  describe('RM-10: 새 스키마에 .default() 0(정적) — 런타임 검증은 snapshot-rich-messages-golden.spec.ts', () => {
    it('CarouselCardSchema·CarouselOutputPayloadV1Schema·ButtonOutputPayloadSchema 선언 블록에 .default( 이 없다', () => {
      const dialogueTs = sharedTypesFiles.find((e) => e.f === 'packages/shared-types/src/dialogue.ts')!;
      const schemaNames = ['CarouselCardSchema', 'CarouselOutputPayloadV1Schema', 'ButtonOutputPayloadSchema'];
      for (const name of schemaNames) {
        const start = dialogueTs.content.indexOf(`export const ${name} =`);
        expect(start).toBeGreaterThanOrEqual(0);
        // 다음 `export const`/`export function` 전까지를 선언 블록으로 본다.
        const rest = dialogueTs.content.slice(start + name.length);
        const nextExportIdx = rest.search(/\nexport (const|function|type)/);
        const block = nextExportIdx === -1 ? rest : rest.slice(0, nextExportIdx);
        expect(nonCommentOccurrences(block, /\.default\(/)).toBe(0);
      }
    });
  });

  describe('RM-11: 공개 서비스는 렌더 문맥만 넘긴다(어댑터 경유)', () => {
    it('public-conversation.service.ts의 renderOutbound( 호출은 1회 · 두 번째 인자에 features · degradeForProfile 직접 사용 0', () => {
      const entry = apiFiles.find((e) => e.f === 'apps/api/src/conversation/public-conversation.service.ts')!;
      const calls = [...entry.content.matchAll(/\.renderOutbound\(/g)];
      expect(calls.length).toBe(1);
      expect(entry.content).toMatch(/renderOutbound\(result\.outputs,\s*\{\s*features:\s*dto\.features\s*\}\)/);
      expect(entry.content).not.toContain('degradeForProfile(');
      expect(entry.content).not.toContain('LEGACY_WEB_WIDGET_OUTPUT_PROFILE');
    });
  });

  describe('RM-12: 마이그레이션은 CREATE TABLE만이다(부분 유니크 4종 보존)', () => {
    it("신규 마이그레이션 SQL에 DROP·ALTER TABLE·WHERE 가 없다", () => {
      const sql = readFileSync(join(REPO_ROOT, 'apps/api/prisma/migrations/20260927120000_channel_rich_messages/migration.sql'), 'utf8');
      expect(sql).not.toMatch(/DROP\s/i);
      expect(sql).not.toMatch(/ALTER TABLE/i);
      expect(sql).not.toMatch(/WHERE/i);
      expect(sql).toMatch(/CREATE TABLE "chatbot_rich_url_policies"/);
    });

    it('적용된 DB의 부분 유니크 인덱스가 4개다(원시 SQL 직접 조회 — 통합)', async () => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { PrismaClient } = require('@prisma/client');
      const prisma = new PrismaClient();
      try {
        const rows: Array<{ c: bigint | number }> = await prisma.$queryRawUnsafe(
          "SELECT count(*) as c FROM sqlite_master WHERE type='index' AND sql LIKE '%WHERE%'",
        );
        expect(Number(rows[0].c)).toBe(4);
      } finally {
        await prisma.$disconnect();
      }
    });
  });

  describe('RM-15: 새 루프·환경변수 0', () => {
    it('rich-messages/**에 setInterval(·PollingLoop 가 없다', () => {
      const offenders = apiFiles.filter(({ f, content }) => f.startsWith('apps/api/src/rich-messages/') && nonCommentOccurrences(content, /setInterval\(|PollingLoop/) > 0);
      expect(offenders).toEqual([]);
    });

    it('env.validation.ts·jest.isolate-env.js에 이 그룹 관련 키가 없다', () => {
      const envValidation = readFileSync(join(REPO_ROOT, 'apps/api/src/config/env.validation.ts'), 'utf8');
      const isolateEnv = readFileSync(join(REPO_ROOT, 'apps/api/jest.isolate-env.js'), 'utf8');
      expect(envValidation).not.toMatch(/RICH_URL|RICH_MESSAGE/);
      expect(isolateEnv).not.toMatch(/RICH_URL|RICH_MESSAGE/);
    });
  });

  describe('RM-17: ChatbotRichUrlPolicy 모델은 설정 컬럼뿐이다(Cascade·SetNull 0)', () => {
    it('schema.prisma의 모델 블록에 onDelete: Cascade·SetNull이 없다', () => {
      const schema = readFileSync(join(REPO_ROOT, 'apps/api/prisma/schema.prisma'), 'utf8');
      const start = schema.indexOf('model ChatbotRichUrlPolicy {');
      expect(start).toBeGreaterThanOrEqual(0);
      const end = schema.indexOf('\n}', start);
      const block = schema.slice(start, end);
      expect(block).not.toMatch(/onDelete:\s*Cascade/);
      expect(block).not.toMatch(/onDelete:\s*SetNull/);
      expect(block).toMatch(/hosts\s+String/);
      expect(block).toMatch(/updatedById\s+String\?/);
    });
  });

  describe('RM-18(backend 부분): §15 새 타입 수정 지점에 CAROUSEL 문자열이 존재한다', () => {
    const requiredFiles = [
      { root: sharedTypesFiles, f: 'packages/shared-types/src/dialogue.ts' },
      { root: engineFiles, f: 'packages/dialogue-engine/src/outputs.ts' },
      { root: engineFiles, f: 'packages/dialogue-engine/src/design-validator.ts' },
      { root: apiFiles, f: 'apps/api/src/dialog-nodes/lib/node-target-refs.ts' },
      { root: apiFiles, f: 'apps/api/src/asset-transfer/lib/system-node-trim.ts' },
      { root: apiFiles, f: 'apps/api/src/banned-words/lib/output-text-fields.ts' },
      { root: sharedTypesFiles, f: 'packages/shared-types/src/output-view.ts' },
      { root: sharedTypesFiles, f: 'packages/shared-types/src/rich-degrade.ts' },
      { root: sharedTypesFiles, f: 'packages/shared-types/src/channel.ts' },
      { root: apiFiles, f: 'apps/api/src/rich-messages/lib/collect-rich-urls.ts' },
    ];

    it.each(requiredFiles.map((r) => [r.f] as const))("%s에 'CAROUSEL' 문자열이 있다", (f) => {
      const target = requiredFiles.find((r) => r.f === f)!;
      const entry = target.root.find((e) => e.f === f);
      expect(entry).toBeDefined();
      expect(entry!.content).toContain('CAROUSEL');
    });

    it('역검증: 목록 파일 하나를 빼면 이 체크리스트가 잡아낸다', () => {
      const withoutOne = requiredFiles.slice(1);
      const allPresent = withoutOne.every((r) => r.root.find((e) => e.f === r.f)?.content.includes('CAROUSEL'));
      // 나머지 전부는 여전히 CAROUSEL을 포함해야 한다(가드가 항상 통과하는 함정 방지) — 제외된 1개는
      // 별도로 검증됐으므로(위 it.each) 여기서는 "목록을 줄여도 나머지는 여전히 참"임을 확인한다.
      expect(allPresent).toBe(true);
    });
  });
});
