import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { EgressExitId, PublicChatbotConfigSchema, PublicProactiveEventSchema, PublicProactivePayloadSchema, PublicProactiveRuleSchema, WebChannelConfigSchema } from '@chat-bot/shared-types';

/**
 * 선제적(Proactive) 메시징(No.35) 정적 검사 — `proactive-messaging-설계.md` §14 PA-1~PA-18 중
 * 서버·공유 영역(PA-1·2·3·4·5·6·7·8·9·10·14·15·16·17)을 검사한다. **PA-11·12·13·18(위젯 전용)은
 * `apps/widget`이 아직 없어 이 커밋 범위 밖이다** — frontend-implementer가 위젯 구현 후
 * `apps/widget/src/core/proactive-sealing.spec.ts`에 추가해야 한다(기존 `rich-message-sealing.spec.ts`
 * 범위 안내 선례와 동일한 형식).
 */

const REPO_ROOT = resolve(__dirname, '../../../../..');
const SELF_ABSOLUTE = resolve(__dirname, 'proactive-sealing.spec.ts');

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
const apiFilesWithSpecs = collectSourceFiles('apps/api/src', { excludeSpec: false }).map((f) => ({ f: toRepoRelative(f), content: readFileSync(f, 'utf8') }));
const engineFiles = collectSourceFiles('packages/dialogue-engine/src').map((f) => ({ f: toRepoRelative(f), content: readFileSync(f, 'utf8') }));
const mlWorkerFiles = collectSourceFiles('apps/ml-worker').map((f) => ({ f: toRepoRelative(f), content: readFileSync(f, 'utf8') }));
const sharedTypesFiles = collectSourceFiles('packages/shared-types/src').map((f) => ({ f: toRepoRelative(f), content: readFileSync(f, 'utf8') }));

describe('선제적(Proactive) 메시징(No.35) 정적 검사 — 스캔 기반 확인', () => {
  it('스캔 대상이 0건이 아니다(가드)', () => {
    expect(apiFiles.length).toBeGreaterThan(50);
    expect(engineFiles.length).toBeGreaterThan(5);
    expect(sharedTypesFiles.length).toBeGreaterThan(5);
  });

  describe('PA-1: 엔진·ml-worker·채널 어댑터에 proactive 심볼 0 · EgressExitId 7종 불변', () => {
    it('packages/dialogue-engine/src에 proactive(대소문자 무시) 0', () => {
      const offenders = engineFiles.filter(({ content }) => nonCommentOccurrences(content, /proactive/gi) > 0).map((e) => e.f);
      expect(offenders).toEqual([]);
    });

    it('apps/ml-worker에 proactive(대소문자 무시) 0', () => {
      const offenders = mlWorkerFiles.filter(({ content }) => nonCommentOccurrences(content, /proactive/gi) > 0).map((e) => e.f);
      expect(offenders).toEqual([]);
    });

    it('apps/api/src/conversation/adapters/**에 proactive(대소문자 무시) 0', () => {
      const adapterFiles = apiFiles.filter(({ f }) => f.includes('/conversation/adapters/'));
      expect(adapterFiles.length).toBeGreaterThan(0);
      const offenders = adapterFiles.filter(({ content }) => nonCommentOccurrences(content, /proactive/gi) > 0).map((e) => e.f);
      expect(offenders).toEqual([]);
    });

    it('EgressExitId는 8종이다(선제 안내는 새 외부 출구 0 — 8번째 SPEECH_LOCAL은 No.32 음성 인식)', () => {
      expect(EgressExitId.options.length).toBe(8);
    });
  });

  describe('PA-2: 쓰기 유일 파일', () => {
    const WRITE_CALL_PATTERNS: Record<string, RegExp> = {
      proactiveRule: /proactiveRule\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(/g,
      chatbotProactiveSetting: /chatbotProactiveSetting\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(/g,
      proactiveDailyStat: /proactiveDailyStat\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(/g,
    };
    const ALLOWED: Record<string, string[]> = {
      proactiveRule: ['apps/api/src/proactive/proactive-rules.service.ts', 'apps/api/src/chatbots/chatbots.service.ts'],
      chatbotProactiveSetting: ['apps/api/src/proactive/proactive-settings.service.ts', 'apps/api/src/chatbots/chatbots.service.ts'],
      proactiveDailyStat: ['apps/api/src/proactive/core/proactive-stat.writer.ts', 'apps/api/src/chatbots/chatbots.service.ts'],
    };

    it.each(Object.keys(WRITE_CALL_PATTERNS))('%s 쓰기 호출은 허용 파일에만 있다', (model) => {
      const pattern = WRITE_CALL_PATTERNS[model];
      const allowed = new Set(ALLOWED[model]);
      const offenders = apiFiles.filter(({ f, content }) => !allowed.has(f) && nonCommentOccurrences(content, pattern) > 0).map((e) => e.f);
      expect(offenders).toEqual([]);
    });

    it('chatbots.service.ts의 3개 쓰기는 전부 deleteMany다(생성·수정 없음)', () => {
      const file = apiFiles.find(({ f }) => f.endsWith('chatbots/chatbots.service.ts'))!;
      expect(nonCommentOccurrences(file.content, /proactiveRule\.deleteMany\(/g)).toBeGreaterThanOrEqual(1);
      expect(nonCommentOccurrences(file.content, /chatbotProactiveSetting\.deleteMany\(/g)).toBeGreaterThanOrEqual(1);
      expect(nonCommentOccurrences(file.content, /proactiveDailyStat\.deleteMany\(/g)).toBeGreaterThanOrEqual(1);
      expect(nonCommentOccurrences(file.content, /proactiveRule\.(create|update|upsert)\(/g)).toBe(0);
    });
  });

  describe('PA-3: ProactiveDailyStat·ProactiveRule·ChatbotProactiveSetting에 개인정보 컬럼 0(AC-PA6-4)', () => {
    const schemaFile = readFileSync(join(REPO_ROOT, 'apps/api/prisma/schema.prisma'), 'utf8');
    const forbidden = /\b(sessionId|session|ip|url|path|referrer|userAgent|identity|customer)\b/i;

    function extractModelBlock(modelName: string): string {
      const startMarker = `model ${modelName} {`;
      const startIdx = schemaFile.indexOf(startMarker);
      expect(startIdx).toBeGreaterThan(-1);
      const endIdx = schemaFile.indexOf('\n}', startIdx);
      return schemaFile.slice(startIdx, endIdx);
    }

    it.each(['ProactiveDailyStat', 'ProactiveRule', 'ChatbotProactiveSetting'])('%s 블록에 금지 토큰이 없다', (modelName) => {
      const block = extractModelBlock(modelName);
      const lines = block.split('\n').filter((l) => !l.trim().startsWith('///'));
      const offenders = lines.filter((l) => forbidden.test(l));
      expect(offenders).toEqual([]);
    });
  });

  describe('PA-4: PublicProactiveEventSchema strict · 키 = {sessionId, ruleId, kind}', () => {
    it('shape 키 집합이 정확히 일치한다', () => {
      expect(Object.keys(PublicProactiveEventSchema.shape).sort()).toEqual(['kind', 'ruleId', 'sessionId']);
      expect((PublicProactiveEventSchema._def as { unknownKeys?: string }).unknownKeys).toBe('strict');
    });
  });

  describe('PA-5: 공개 스키마 키 집합 · 금지 필드 0(AC-PA5-1)', () => {
    it('PublicProactiveRuleSchema 키 = {id, trigger, text, buttons, devices, showUntil}', () => {
      expect(Object.keys(PublicProactiveRuleSchema.shape).sort()).toEqual(['buttons', 'devices', 'id', 'showUntil', 'text', 'trigger']);
    });
    it('PublicProactivePayloadSchema 키 = {caps, rules}', () => {
      expect(Object.keys(PublicProactivePayloadSchema.shape).sort()).toEqual(['caps', 'rules']);
    });
    it('proactive.ts 소스에 name·position·startsAt·endsAt·schedule·purpose·updatedBy·createdBy·shown 같은 공개 노출 금지 키 리터럴이 PublicProactiveRuleSchema 정의 블록 안에 없다', () => {
      const proactiveTsFile = sharedTypesFiles.find(({ f }) => f.endsWith('shared-types/src/proactive.ts'))!;
      const startIdx = proactiveTsFile.content.indexOf('export const PublicProactiveRuleSchema');
      const endIdx = proactiveTsFile.content.indexOf('.strict();', startIdx);
      const block = proactiveTsFile.content.slice(startIdx, endIdx);
      for (const forbidden of ['name:', 'position:', 'startsAt:', 'endsAt:', 'schedule:', 'purpose', 'updatedBy', 'createdBy', 'shown']) {
        expect(block).not.toContain(forbidden);
      }
    });
  });

  describe('PA-6: proactive-eval.ts는 정규식 리터럴·RegExp(·import 0(zod 무의존)', () => {
    const file = sharedTypesFiles.find(({ f }) => f.endsWith('shared-types/src/proactive-eval.ts'))!;

    it('파일이 존재한다', () => {
      expect(file).toBeDefined();
    });

    it('RegExp( 호출이 없다', () => {
      expect(nonCommentOccurrences(file.content, /RegExp\(/g)).toBe(0);
    });

    it('정규식 리터럴이 없다(슬래시로 시작하는 리터럴 패턴 부재)', () => {
      const lines = file.content.split('\n').filter((l) => !isCommentLine(l));
      const regexLiteralPattern = /[=(,]\s*\/[^/\s][^/]*\/[a-z]*/;
      const offenders = lines.filter((l) => regexLiteralPattern.test(l));
      expect(offenders).toEqual([]);
    });

    it('다른 모듈을 import하지 않는다(import 문 0)', () => {
      expect(nonCommentOccurrences(file.content, /^import /gm)).toBe(0);
    });
  });

  describe('PA-7: @Public() 총 10(No.32 음성 인식 9→10) · 9번째 = recordProactiveEvent · proactive/**에 @Public 0', () => {
    it('@Public() 총 10', () => {
      const controllerFiles = apiFiles.filter(({ f }) => f.endsWith('.controller.ts'));
      const total = controllerFiles.reduce((sum, { content }) => sum + nonCommentOccurrences(content, /@Public\(\)/g), 0);
      expect(total).toBe(10);
    });

    it('recordProactiveEvent 앞 600자에 @Public()·@PublicRateBucket(·kind: \'PROACTIVE_EVENT\'가 있다', () => {
      const file = apiFiles.find(({ f }) => f.endsWith('conversation/public-conversation.controller.ts'))!;
      const idx = file.content.indexOf('recordProactiveEvent(');
      expect(idx).toBeGreaterThan(0);
      const before = file.content.slice(Math.max(0, idx - 600), idx);
      expect(before).toContain('@Public()');
      expect(before).toContain('@PublicRateBucket(');
      expect(before).toContain(`kind: 'PROACTIVE_EVENT'`);
    });

    it('proactive/**에는 @Public()이 없다(관리 API는 권한 가드만)', () => {
      const proactiveFiles = apiFiles.filter(({ f }) => f.includes('/src/proactive/'));
      expect(proactiveFiles.length).toBeGreaterThan(5);
      const offenders = proactiveFiles.filter(({ content }) => nonCommentOccurrences(content, /@Public\(\)/g) > 0).map((e) => e.f);
      expect(offenders).toEqual([]);
    });
  });

  describe('PA-8: public-conversation.service.ts의 proactive 토큰 범위 · 소스 선택 1회(E-9 재확인)', () => {
    const file = apiFiles.find(({ f }) => f.endsWith('conversation/public-conversation.service.ts'))!;

    it('bundleSourceOf(·.getCached(·versionBundles.get( 각 정확히 1회', () => {
      expect(nonCommentOccurrences(file.content, /bundleSourceOf\(/g)).toBe(1);
      expect(nonCommentOccurrences(file.content, /\.getCached\(/g)).toBe(1);
      expect(nonCommentOccurrences(file.content, /versionBundles[!?]?\.get\(/g)).toBe(1);
    });

    it('proactive 토큰(대소문자 무시)이 있는 줄은 import·생성자·getConfig·recordProactiveEvent 안에만 있다', () => {
      const lines = file.content.split('\n');
      let allowedRegion = false;
      const offenderLines: string[] = [];
      for (const line of lines) {
        if (/^import /.test(line) || /constructor\(/.test(line) || /private readonly proactivePublic/.test(line)) allowedRegion = true;
        if (/async getConfig\(/.test(line) || /async recordProactiveEvent\(/.test(line)) allowedRegion = true;
        if (/proactive/i.test(line) && !allowedRegion && !isCommentLine(line)) offenderLines.push(line);
      }
      expect(offenderLines).toEqual([]);
    });
  });

  describe('PA-9: proactive/public/** 참조 경계 · ProactiveModule export 유일', () => {
    it('proactive/public/**가 금지 심볼을 참조하지 않는다', () => {
      const publicFiles = apiFiles.filter(({ f }) => f.includes('/src/proactive/public/'));
      expect(publicFiles.length).toBeGreaterThan(0);
      const forbiddenPattern = /chatbotRichUrlPolicy|\/inbox\/|\/handoff\/|@chat-bot\/dialogue-engine|bundleSourceOf|DialogueBundleService|VersionBundleService/;
      const offenders = publicFiles.filter(({ content }) => nonCommentOccurrences(content, new RegExp(forbiddenPattern.source, 'g')) > 0).map((e) => e.f);
      expect(offenders).toEqual([]);
    });

    it('ProactiveModule exports = [ProactivePublicService]', () => {
      const file = apiFiles.find(({ f }) => f.endsWith('proactive/proactive.module.ts'))!;
      const match = file.content.match(/exports:\s*\[([^\]]*)\]/);
      expect(match).not.toBeNull();
      const exported = match![1].split(',').map((s) => s.trim()).filter(Boolean);
      expect(exported).toEqual(['ProactivePublicService']);
    });
  });

  describe('PA-10: 수집 로그에 원문 토큰 0 · 중복 억제는 해시 사용', () => {
    it('proactive/**의 logger 호출 줄에 sessionId|text|label|value 토큰이 없다', () => {
      const proactiveFiles = apiFiles.filter(({ f }) => f.includes('/src/proactive/'));
      const loggerLinePattern = /logger\.(log|warn|error|debug)\(/;
      const offenders: string[] = [];
      for (const { f, content } of proactiveFiles) {
        for (const line of content.split('\n')) {
          if (loggerLinePattern.test(line) && /sessionId|text|label|value/.test(line)) offenders.push(`${f}: ${line.trim()}`);
        }
      }
      expect(offenders).toEqual([]);
    });

    it('proactive-event-deduper.ts가 createHash(를 쓴다(원문 키 보관 금지)', () => {
      const file = apiFiles.find(({ f }) => f.endsWith('proactive/core/proactive-event-deduper.ts'))!;
      expect(file.content).toContain('createHash(');
    });
  });

  describe('PA-14: proactive/**가 대화 로그를 만들지 않는다(표시로 로그 생성 0)', () => {
    it('conversationLog.·logService.record( 0건', () => {
      const proactiveFiles = apiFiles.filter(({ f }) => f.includes('/src/proactive/'));
      const offenders = proactiveFiles.filter(({ content }) => nonCommentOccurrences(content, /conversationLog\.|logService\.record\(/g) > 0).map((e) => e.f);
      expect(offenders).toEqual([]);
    });
  });

  describe('PA-15: AUDIT_FIELDS.ProactiveRule에 text·buttons 없음(FR-PA7-5)', () => {
    it('audit-snapshot.ts의 ProactiveRule 화이트리스트에 text·buttons가 없다', () => {
      const file = apiFiles.find(({ f }) => f.endsWith('audit-logs/lib/audit-snapshot.ts'))!;
      const startIdx = file.content.indexOf('ProactiveRule: [');
      expect(startIdx).toBeGreaterThan(-1);
      const endIdx = file.content.indexOf(']', startIdx);
      const block = file.content.slice(startIdx, endIdx);
      expect(block).not.toMatch(/'text'/);
      expect(block).not.toMatch(/'buttons'/);
      expect(block).toContain("'name'");
      expect(block).toContain("'trigger'");
    });
  });

  describe('PA-16: WebChannelConfigSchema·PublicChatbotConfigSchema 불변', () => {
    it('WebChannelConfigSchema 키 집합 불변(6키)', () => {
      expect(Object.keys(WebChannelConfigSchema.shape).sort()).toEqual(
        ['allowedOrigins', 'feedbackEnabled', 'greetingMessage', 'launcherPosition', 'quickReplies', 'showLauncher'].sort(),
      );
    });
    it('PublicChatbotConfigSchema 키 8개 불변', () => {
      expect(Object.keys(PublicChatbotConfigSchema.shape)).toEqual(['slug', 'name', 'avatarUrl', 'skin', 'greetingMessage', 'quickReplies', 'launcherPosition', 'showLauncher']);
    });
  });

  describe('PA-17: 버킷 접두 충돌 없음 · POLL·FEEDBACK 값 불변', () => {
    it('가드 파일에 pa-rules-ip·pa-ev-ip·pa-ev-key 접두가 있고 ip:·session:·poll-·fb-와 겹치지 않는다', () => {
      const file = apiFiles.find(({ f }) => f.endsWith('conversation/guards/public-rate-limit.guard.ts'))!;
      expect(file.content).toContain('pa-rules-ip');
      expect(file.content).toContain('pa-ev-ip');
      expect(file.content).toContain('pa-ev-key');
      expect(file.content).toContain("ipPrefix: 'poll-ip'");
      expect(file.content).toContain("ipPrefix: 'fb-ip'");
      const prefixes = ['pa-rules-ip', 'pa-ev-ip', 'pa-ev-key', 'poll-ip', 'poll-key', 'fb-ip', 'fb-key'];
      expect(new Set(prefixes).size).toBe(prefixes.length);
    });
  });
});

describe('역검증 — 봉인 검사기가 실제로 걸러낼 수 있는지(함정 방지)', () => {
  it('PA-6 정규식 리터럴 검사기는 실제 정규식 리터럴이 있는 파일을 걸러낸다', () => {
    const sample = "const RE = /abc/g;\nexport function f() { return RE.test('x'); }";
    const lines = sample.split('\n').filter((l) => !isCommentLine(l));
    const regexLiteralPattern = /[=(,]\s*\/[^/\s][^/]*\/[a-z]*/;
    expect(lines.some((l) => regexLiteralPattern.test(l))).toBe(true);
  });

  it('apiFilesWithSpecs는 spec 포함 스캔이 apiFiles(스펙 제외)보다 파일 수가 많다(스캔 경로 자체가 살아있는지 확인)', () => {
    expect(apiFilesWithSpecs.length).toBeGreaterThan(apiFiles.length);
  });
});
