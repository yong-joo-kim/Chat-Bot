import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import type { ZodTypeAny } from 'zod';
import {
  Permission,
  AuditAction,
  PublicChatbotConfigSchema,
  PublicMessageRequestSchema,
  PublicHandoffStateSchema,
  PublicMessageResponseSchema,
  PendingAnswerPollResponseSchema,
  HandoffPollQuerySchema,
  HandoffPollMessageSchema,
  HandoffPollResponseSchema,
} from '@chat-bot/shared-types';

/**
 * 토픽 시스템(No.22) 정적 검사(topic-system-설계.md §17, T-1~T-16) — 기존 `asset-write-sealing.spec.ts`
 * ·`version-sealing.spec.ts`와 같은 형식(스캔 루트 지정 · 자기 자신 제외 · 스캔 대상 0건 아님 가드 ·
 * 주석 줄 제외 · 역검증 픽스처 포함).
 */

const REPO_ROOT = resolve(__dirname, '../../../../..');
const SELF_ABSOLUTE = resolve(__dirname, 'topic-sealing.spec.ts');

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
    if (entry === 'node_modules' || entry === 'dist') continue;
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) walk(fullPath, extensions, out);
    else if (extensions.some((ext) => entry.endsWith(ext))) out.push(fullPath);
  }
}

function toRepoRelative(absolutePath: string): string {
  return absolutePath.replace(/\\/g, '/').replace(REPO_ROOT.replace(/\\/g, '/') + '/', '');
}

function collectApiSourceFiles(): string[] {
  const files: string[] = [];
  walk(join(REPO_ROOT, 'apps/api/src'), ['.ts'], files);
  return files.filter((f) => f !== SELF_ABSOLUTE && !f.endsWith('.spec.ts'));
}

function collectEngineSourceFiles(): string[] {
  const files: string[] = [];
  walk(join(REPO_ROOT, 'packages/dialogue-engine/src'), ['.ts'], files);
  return files;
}

function stripComments(content: string): string {
  return content
    .split('\n')
    .map((line) => (isCommentLine(line) ? '' : line))
    .join('\n');
}

function nonCommentOccurrences(content: string, pattern: RegExp): number {
  let count = 0;
  for (const line of content.split('\n')) {
    if (isCommentLine(line)) continue;
    const matches = line.match(pattern);
    if (matches) count += matches.length;
  }
  return count;
}

/** `xxx.$transaction(async (tx) => { ... })` 블록 바디 추출(version-sealing.spec.ts V-10과 같은 방식). */
function extractTxTransactionCallbackBodies(rawContent: string): string[] {
  const content = stripComments(rawContent);
  const bodies: string[] = [];
  let searchFrom = 0;
  for (;;) {
    const markerIdx = content.indexOf('$transaction', searchFrom);
    if (markerIdx === -1) break;
    const arrowIdx = content.indexOf('=>', markerIdx);
    if (arrowIdx === -1) {
      searchFrom = markerIdx + '$transaction'.length;
      continue;
    }
    const header = content.slice(markerIdx, arrowIdx);
    if (!/\(\s*tx\b/.test(header)) {
      searchFrom = arrowIdx + 2;
      continue;
    }
    let i = arrowIdx + 2;
    while (i < content.length && /\s/.test(content[i])) i += 1;
    if (content[i] !== '{') {
      searchFrom = arrowIdx + 2;
      continue;
    }
    const braceStart = i;
    let depth = 0;
    let j = braceStart;
    for (; j < content.length; j += 1) {
      if (content[j] === '{') depth += 1;
      else if (content[j] === '}') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    bodies.push(content.slice(braceStart, j + 1));
    searchFrom = j + 1;
  }
  return bodies;
}

/**
 * (런타임, T-13) zod 스키마를 재귀 순회해 모든 객체 키(필드명) 집합을 모은다 — `ZodEffects`
 * (`.superRefine`/`.refine`)·`ZodOptional`·`ZodNullable`·`ZodDefault`·`ZodArray`·`ZodUnion`·
 * `ZodDiscriminatedUnion`·`ZodRecord`·`ZodLazy`·`ZodIntersection`을 모두 통과한다. 순환 참조 방어를
 * 위해 방문한 스키마 `_def`를 추적한다.
 */
function collectZodKeys(schema: ZodTypeAny, keys: Set<string>, visited: WeakSet<object> = new WeakSet()): Set<string> {
  if (visited.has(schema._def)) return keys;
  visited.add(schema._def);

  const def = schema._def as { typeName: string };
  switch (def.typeName) {
    case 'ZodObject': {
      const shape = (schema as z.ZodObject<z.ZodRawShape>).shape;
      for (const [key, value] of Object.entries(shape)) {
        keys.add(key);
        collectZodKeys(value as ZodTypeAny, keys, visited);
      }
      return keys;
    }
    case 'ZodArray':
      return collectZodKeys((schema as z.ZodArray<ZodTypeAny>).element, keys, visited);
    case 'ZodOptional':
    case 'ZodNullable':
      return collectZodKeys((schema as z.ZodOptional<ZodTypeAny>).unwrap(), keys, visited);
    case 'ZodDefault':
      return collectZodKeys((schema._def as { innerType: ZodTypeAny }).innerType, keys, visited);
    case 'ZodEffects':
      return collectZodKeys((schema._def as { schema: ZodTypeAny }).schema, keys, visited);
    case 'ZodUnion':
    case 'ZodDiscriminatedUnion': {
      const options = (schema._def as { options: ZodTypeAny[] }).options;
      for (const opt of options) collectZodKeys(opt, keys, visited);
      return keys;
    }
    case 'ZodIntersection': {
      const d = schema._def as { left: ZodTypeAny; right: ZodTypeAny };
      collectZodKeys(d.left, keys, visited);
      collectZodKeys(d.right, keys, visited);
      return keys;
    }
    case 'ZodRecord':
      return collectZodKeys((schema._def as { valueType: ZodTypeAny }).valueType, keys, visited);
    case 'ZodLazy':
      return collectZodKeys((schema._def as { getter: () => ZodTypeAny }).getter(), keys, visited);
    // [보강 — 코드리뷰 2회차 Low] T-13 스캐너가 놓치던 래퍼 4종. 하나라도 없으면 그 아래 경로의
    // topic 키가 조용히 스캔에서 빠질 수 있다(시험 코드만 수정 — 제품 코드 무변경).
    case 'ZodPipeline': {
      const d = schema._def as { in: ZodTypeAny; out: ZodTypeAny };
      collectZodKeys(d.in, keys, visited);
      collectZodKeys(d.out, keys, visited);
      return keys;
    }
    case 'ZodBranded':
      return collectZodKeys((schema._def as { type: ZodTypeAny }).type, keys, visited);
    case 'ZodCatch':
      return collectZodKeys((schema._def as { innerType: ZodTypeAny }).innerType, keys, visited);
    case 'ZodReadonly':
      return collectZodKeys((schema._def as { innerType: ZodTypeAny }).innerType, keys, visited);
    default:
      return keys; // leaf(string/number/boolean/enum/literal/date/unknown/any 등)
  }
}

describe('토픽 시스템(No.22) 정적 검사 — topic-system-설계.md §17', () => {
  const apiFiles = collectApiSourceFiles();
  const apiFileContents = apiFiles.map((f) => ({ f: toRepoRelative(f), content: readFileSync(f, 'utf8') }));
  const engineFiles = collectEngineSourceFiles();
  const engineFileContents = engineFiles.map((f) => ({ f: toRepoRelative(f), content: readFileSync(f, 'utf8') }));

  it('스캔 대상 파일이 존재한다(회귀 방지)', () => {
    expect(apiFiles.length).toBeGreaterThan(50);
    expect(engineFiles.length).toBeGreaterThan(5);
  });

  describe('T-1: packages/dialogue-engine/src에 topic 심볼 0건(FR-0-129, 엔진 수정 0)', () => {
    it.each(engineFileContents.map(({ f }) => f))('%s에 topic(대소문자 무관) 심볼이 없다', (file) => {
      const entry = engineFileContents.find((e) => e.f === file)!;
      expect(nonCommentOccurrences(entry.content, /topic/gi)).toBe(0);
    });

    it('역검증 — 헬퍼가 실제로 topic 심볼을 검출한다', () => {
      expect(nonCommentOccurrences('const topicId = 1;', /topic/gi)).toBeGreaterThan(0);
      expect(nonCommentOccurrences('// topicId 주석은 제외', /topic/gi)).toBe(0);
    });
  });

  describe('T-2: excludeInactiveTopics 식별자는 dialogue-bundle.service.ts 1개 파일에만 있다', () => {
    const pattern = /excludeInactiveTopics/;
    it('등장 파일이 정확히 1개(dialogue-common/dialogue-bundle.service.ts)다', () => {
      const offenders = apiFileContents.filter(({ content }) => pattern.test(content)).map(({ f }) => f);
      expect(offenders).toEqual(['apps/api/src/dialogue-common/dialogue-bundle.service.ts']);
    });

    it('그 파일 안에서 excludeInactiveTopics: true 리터럴은 getCached 메서드 블록에만 있다', () => {
      const file = apiFileContents.find(({ f }) => f.endsWith('dialogue-common/dialogue-bundle.service.ts'))!;
      const content = stripComments(file.content);
      const getCachedStart = content.indexOf('async getCached(');
      const getCachedUnfilteredStart = content.indexOf('async getCachedUnfiltered(');
      expect(getCachedStart).toBeGreaterThanOrEqual(0);
      expect(getCachedUnfilteredStart).toBeGreaterThan(getCachedStart);
      const getCachedBody = content.slice(getCachedStart, getCachedUnfilteredStart);
      const restOfFile = content.slice(getCachedUnfilteredStart);
      expect(getCachedBody.includes('excludeInactiveTopics: true')).toBe(true);
      expect(restOfFile.includes('excludeInactiveTopics: true')).toBe(false);
    });
  });

  describe('T-3: versions/**·asset-transfer/**·topics/**·dialog-nodes/**에 getCached(·getCachedUnfiltered( 0건', () => {
    const targetDirs = ['/src/versions/', '/src/asset-transfer/', '/src/topics/', '/src/dialog-nodes/'];
    const targetFiles = apiFileContents.filter(({ f }) => targetDirs.some((d) => f.includes(d)));

    it('스캔 대상 파일이 존재한다', () => {
      expect(targetFiles.length).toBeGreaterThan(5);
    });

    it.each(targetFiles.map(({ f }) => f))('%s에 getCached(·getCachedUnfiltered( 호출이 없다', (file) => {
      const entry = targetFiles.find((e) => e.f === file)!;
      expect(nonCommentOccurrences(entry.content, /\.getCached\(/g)).toBe(0);
      expect(nonCommentOccurrences(entry.content, /\.getCachedUnfiltered\(/g)).toBe(0);
    });
  });

  describe('T-4: getCachedUnfiltered( 호출 파일은 simulation/simulation.service.ts 1개뿐', () => {
    it('등장 파일이 정확히 1개다', () => {
      const offenders = apiFileContents.filter(({ content }) => /\.getCachedUnfiltered\(/.test(content)).map(({ f }) => f);
      expect(offenders).toEqual(['apps/api/src/simulation/simulation.service.ts']);
    });
  });

  describe('T-5: asset-transfer/**의 Prisma 쓰기 호출은 create·createMany와 조회만', () => {
    const transferFiles = apiFileContents.filter(({ f }) => f.includes('/src/asset-transfer/'));
    const forbiddenPattern = /(?:prisma|tx)\.\w+\.(update|updateMany|upsert|delete|deleteMany)\(|\$executeRaw|\$queryRaw/;

    it('스캔 대상 파일이 존재한다', () => {
      expect(transferFiles.length).toBeGreaterThan(2);
    });

    it.each(transferFiles.map(({ f }) => f))('%s에 update·upsert·delete·원시 SQL이 없다', (file) => {
      const entry = transferFiles.find((e) => e.f === file)!;
      expect(nonCommentOccurrences(entry.content, forbiddenPattern)).toBe(0);
    });

    // ⚠ 아래 역검증은 실제 자산 모델명(intent/keyword)을 쓰지 않는다 — asset-write-sealing.spec.ts의
    // S-1 스캔이 원문(주석 포함) 그대로 이 파일을 훑어 오탐지하는 것을 막기 위해서다(가짜 모델명 사용).
    it('역검증 — 헬퍼가 update 호출을 실제로 검출한다', () => {
      expect(nonCommentOccurrences('await tx.sampleModel.update({ where: { id }, data: {} });', forbiddenPattern)).toBeGreaterThan(0);
    });
  });

  describe('T-6: topics/topic-split.service.ts에 원본을 바꾸는 쓰기 호출이 없다', () => {
    it('update(·updateMany(·delete(·deleteMany(·upsert( 이 없다', () => {
      const file = apiFileContents.find(({ f }) => f.endsWith('topics/topic-split.service.ts'))!;
      expect(file).toBeDefined();
      const pattern = /\.(update|updateMany|delete|deleteMany|upsert)\(/;
      expect(nonCommentOccurrences(file.content, pattern)).toBe(0);
    });
  });

  describe('T-7: 자산 6모델 updateMany 중 data에 topicId가 있는 호출은 topic-assignment.service.ts뿐', () => {
    const modelUpdateManyPattern = /(?:prisma|tx)\.(intent|keyword|homonymDictionary|contextVariable|dialogNode|faqEntry)\.updateMany\(/g;

    /** `updateMany(` 뒤 중괄호 균형을 맞춰 인자 블록 전체를 추출한다(중첩 객체 대응). */
    function extractBalancedArgs(content: string, openParenIdx: number): string {
      let depth = 0;
      let i = openParenIdx;
      for (; i < content.length; i += 1) {
        if (content[i] === '(') depth += 1;
        else if (content[i] === ')') {
          depth -= 1;
          if (depth === 0) break;
        }
      }
      return content.slice(openParenIdx, i + 1);
    }

    function findUpdateManyCallsWithTopicId(content: string): string[] {
      const stripped = stripComments(content);
      const found: string[] = [];
      for (const m of stripped.matchAll(modelUpdateManyPattern)) {
        const openParenIdx = m.index! + m[0].length - 1;
        const block = extractBalancedArgs(stripped, openParenIdx);
        if (/topicId/.test(block)) found.push(block);
      }
      return found;
    }

    it.each(apiFileContents.filter(({ content }) => findUpdateManyCallsWithTopicId(content).length > 0).map(({ f }) => f))(
      '%s는 topics/topic-assignment.service.ts여야 한다',
      (file) => {
        expect(file.endsWith('topics/topic-assignment.service.ts')).toBe(true);
      },
    );

    it('그 파일의 모든 topicId 포함 updateMany data 객체 키가 {topicId, updatedAt} 부분집합이다', () => {
      const file = apiFileContents.find(({ f }) => f.endsWith('topics/topic-assignment.service.ts'))!;
      const blocks = findUpdateManyCallsWithTopicId(file.content);
      expect(blocks.length).toBeGreaterThan(0);
      for (const block of blocks) {
        const dataMatch = block.match(/data:\s*\{([^}]*)\}/);
        expect(dataMatch).not.toBeNull();
        // 단축 프로퍼티(`{ topicId, updatedAt }`)와 `key: value` 형태를 모두 인식한다.
        const keys = dataMatch![1]
          .split(',')
          .map((part) => part.trim().split(':')[0].trim())
          .filter((k) => k.length > 0);
        expect(keys.length).toBeGreaterThan(0);
        for (const key of keys) expect(['topicId', 'updatedAt']).toContain(key);
      }
    });

    // ⚠ 아래 역검증도 가짜 모델명을 쓴다(위 T-5 역검증과 같은 이유 — 오탐지 회피).
    it('역검증 — 헬퍼가 중첩 객체가 있어도 topicId를 실제로 검출한다', () => {
      const sample = `await tx.sampleModel.updateMany({ where: { id: { in: ids } }, data: { topicId, updatedAt } });`;
      const genericPattern = /(?:prisma|tx)\.(\w+)\.updateMany\(/g;
      const stripped = sample;
      const found: string[] = [];
      for (const m of stripped.matchAll(genericPattern)) {
        const openParenIdx = m.index! + m[0].length - 1;
        const block = extractBalancedArgs(stripped, openParenIdx);
        if (/topicId/.test(block)) found.push(block);
      }
      expect(found.length).toBe(1);
    });
  });

  describe('T-8: topic.(create|createMany|update|updateMany|delete|deleteMany|upsert) 호출 파일은 topics.service.ts·asset-transfer.loader.ts뿐', () => {
    const pattern = /(?:prisma|tx)\.topic\.(create|createMany|update|updateMany|delete|deleteMany|upsert)\(/;
    it.each(apiFileContents.filter(({ content }) => pattern.test(content)).map(({ f }) => f))('%s는 허용 목록에 있다', (file) => {
      expect(file.endsWith('topics/topics.service.ts') || file.endsWith('asset-transfer/asset-transfer.loader.ts')).toBe(true);
    });
  });

  describe('T-9: @Public() 총 7 · topics/**·asset-transfer/**에 0건', () => {
    it('topics/**·asset-transfer/**에 @Public( 심볼이 없다', () => {
      const targetFiles = apiFileContents.filter(({ f }) => f.includes('/src/topics/') || f.includes('/src/asset-transfer/'));
      expect(targetFiles.length).toBeGreaterThan(5);
      for (const { content } of targetFiles) {
        expect(nonCommentOccurrences(content, /@Public\(/g)).toBe(0);
      }
    });
  });

  describe('T-10: Permission 17종 불변 · topic: 접두 권한 문자열 0 · AuditAction 14종 불변', () => {
    it('Permission.options.length === 17', () => {
      expect(Permission.options.length).toBe(17);
    });
    it('topic: 접두 권한 문자열이 없다', () => {
      expect(Permission.options.some((p) => p.startsWith('topic:'))).toBe(false);
    });
    it('AuditAction.options.length === 14', () => {
      expect(AuditAction.options.length).toBe(14);
    });
  });

  describe('T-11: schema.prisma 계약(FK·인덱스)', () => {
    const schema = readFileSync(join(REPO_ROOT, 'apps/api/prisma/schema.prisma'), 'utf8');

    it('Topic.chatbot 관계는 onDelete: Restrict다', () => {
      const topicModel = schema.slice(schema.indexOf('model Topic {'), schema.indexOf('model Topic {') + schema.slice(schema.indexOf('model Topic {')).indexOf('\n}'));
      expect(topicModel).toMatch(/chatbot\s+Chatbot\s+@relation\([^)]*onDelete:\s*Restrict/);
    });

    it.each(['Intent', 'Keyword', 'HomonymDictionary', 'ContextVariable', 'DialogNode', 'FaqEntry'])(
      '%s 모델에 topicId String? + onDelete: Restrict + @@index([topicId])가 있다',
      (modelName) => {
        const startIdx = schema.indexOf(`model ${modelName} {`);
        expect(startIdx).toBeGreaterThanOrEqual(0);
        const endIdx = startIdx + schema.slice(startIdx).indexOf('\n}');
        const body = schema.slice(startIdx, endIdx);
        expect(body).toMatch(/topicId\s+String\?/);
        expect(body).toMatch(/topic\s+Topic\?\s+@relation\([^)]*onDelete:\s*Restrict/);
        expect(body).toMatch(/@@index\(\[topicId\]\)/);
      },
    );

    it('ConversationLog.topicId는 @relation 없음 · 어떤 @@index에도 topicId가 없다', () => {
      const startIdx = schema.indexOf('model ConversationLog {');
      const endIdx = startIdx + schema.slice(startIdx).indexOf('\n}');
      const body = schema.slice(startIdx, endIdx);
      expect(body).toMatch(/topicId\s+String\?/);
      const topicIdLine = body.split('\n').find((l) => /^\s*topicId\s+String\?/.test(l))!;
      expect(topicIdLine).not.toMatch(/@relation/);
      const indexLines = body.split('\n').filter((l) => l.includes('@@index('));
      for (const line of indexLines) expect(line).not.toContain('topicId');
    });
  });

  describe('T-12: conversation-log.service.ts의 create.data에 topicId 키가 있다', () => {
    it('topicId: 가 존재한다', () => {
      const file = apiFileContents.find(({ f }) => f.endsWith('conversation/conversation-log.service.ts'))!;
      expect(file).toBeDefined();
      expect(nonCommentOccurrences(file.content, /topicId:\s*params\.topicId/g)).toBeGreaterThan(0);
    });
  });

  describe('T-13: 공개 응답·위젯 스키마(Public*·*Poll*) 재귀 키 집합에 topic 부분 문자열 0건(NFR-TPS1)', () => {
    const PUBLIC_AND_POLL_SCHEMAS: Array<[string, ZodTypeAny]> = [
      ['PublicChatbotConfigSchema', PublicChatbotConfigSchema],
      ['PublicMessageRequestSchema', PublicMessageRequestSchema],
      ['PublicHandoffStateSchema', PublicHandoffStateSchema],
      ['PublicMessageResponseSchema', PublicMessageResponseSchema],
      ['PendingAnswerPollResponseSchema', PendingAnswerPollResponseSchema],
      ['HandoffPollQuerySchema', HandoffPollQuerySchema],
      ['HandoffPollMessageSchema', HandoffPollMessageSchema],
      ['HandoffPollResponseSchema', HandoffPollResponseSchema],
    ];

    it('스캔 대상 스키마가 존재한다(회귀 방지)', () => {
      expect(PUBLIC_AND_POLL_SCHEMAS.length).toBeGreaterThan(0);
    });

    it.each(PUBLIC_AND_POLL_SCHEMAS)('%s의 재귀 키 집합에 topic(대소문자 무관) 부분 문자열이 없다', (name, schema) => {
      const keys = collectZodKeys(schema, new Set());
      const offending = [...keys].filter((k) => /topic/i.test(k));
      expect(offending).toEqual([]);
    });

    it('역검증 — 헬퍼가 중첩 객체·배열·옵셔널 안의 topic 키를 실제로 검출한다', () => {
      const fixture = z.object({
        outer: z.array(
          z.object({
            topicId: z.string().uuid().optional(),
          }),
        ),
      });
      const keys = collectZodKeys(fixture, new Set());
      expect([...keys].some((k) => /topic/i.test(k))).toBe(true);
    });

    it('역검증 — 판별 유니온(discriminated union) 분기 안의 topic 키도 검출한다', () => {
      const fixture = z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('A'), value: z.string() }),
        z.object({ kind: z.literal('B'), topicName: z.string() }),
      ]);
      const keys = collectZodKeys(fixture, new Set());
      expect([...keys].some((k) => /topic/i.test(k))).toBe(true);
    });

    // [보강 — 코드리뷰 2회차 Low] ZodPipeline·ZodBranded·ZodCatch·ZodReadonly 래퍼 안의 topic 키도
    // 스캐너가 검출하는지 역검증한다(collectZodKeys 스위치 보강분).
    it('역검증 — ZodPipeline(.transform 뒤 .pipe) 안의 topic 키를 검출한다', () => {
      const fixture = z.object({ topicId: z.string() }).pipe(z.object({ topicId: z.string() }));
      const keys = collectZodKeys(fixture, new Set());
      expect([...keys].some((k) => /topic/i.test(k))).toBe(true);
    });

    it('역검증 — ZodBranded 안의 topic 키를 검출한다', () => {
      const fixture = z.object({ topicId: z.string() }).brand<'TopicBrand'>();
      const keys = collectZodKeys(fixture, new Set());
      expect([...keys].some((k) => /topic/i.test(k))).toBe(true);
    });

    it('역검증 — ZodCatch(.catch()) 안의 topic 키를 검출한다', () => {
      const fixture = z.object({ topicId: z.string() }).catch({ topicId: '' });
      const keys = collectZodKeys(fixture, new Set());
      expect([...keys].some((k) => /topic/i.test(k))).toBe(true);
    });

    it('역검증 — ZodReadonly(.readonly()) 안의 topic 키를 검출한다', () => {
      const fixture = z.object({ topicId: z.string() }).readonly();
      const keys = collectZodKeys(fixture, new Set());
      expect([...keys].some((k) => /topic/i.test(k))).toBe(true);
    });

    // [보강 — 코드리뷰 2회차 Low] conversation.ts에 Public*·*Poll* 스키마가 새로 추가되면
    // PUBLIC_AND_POLL_SCHEMAS 목록도 함께 갱신해야 한다 — 소스의 export 개수와 이 목록 길이가
    // 다르면 실패해 "새 공개/폴링 스키마가 스캔에서 빠졌다"를 조용히 지나치지 않게 한다.
    it('가드 — conversation.ts의 export const (Public*|*Poll*)Schema 개수와 PUBLIC_AND_POLL_SCHEMAS.length가 같다', () => {
      const conversationSource = readFileSync(join(REPO_ROOT, 'packages/shared-types/src/conversation.ts'), 'utf8');
      const matches = conversationSource.match(/export const (Public\w+|\w*Poll\w*)Schema/g) ?? [];
      const exportedNames = new Set(matches.map((m) => m.replace(/^export const /, '')));
      expect(exportedNames.size).toBe(PUBLIC_AND_POLL_SCHEMAS.length);
      const listedNames = new Set(PUBLIC_AND_POLL_SCHEMAS.map(([name]) => name));
      expect([...exportedNames].sort()).toEqual([...listedNames].sort());
    });

    it('역검증 — 가드 정규식이 실제로 신규 Public*Schema 정의를 잡아낸다', () => {
      const fixture = 'export const PublicNewThingSchema = z.object({});\nexport const HandoffPollQuerySchema = z.object({});';
      const matches = fixture.match(/export const (Public\w+|\w*Poll\w*)Schema/g) ?? [];
      expect(matches.length).toBe(2);
    });
  });

  describe('T-14: topics/**·asset-transfer/**의 $transaction(async (tx) => 콜백 안 Promise.all 0', () => {
    const targetFiles = apiFileContents.filter(({ f }) => f.includes('/src/topics/') || f.includes('/src/asset-transfer/'));

    it.each(targetFiles.map(({ f }) => f))('%s의 tx 콜백 본문에 Promise.all(이 없다', (file) => {
      const entry = targetFiles.find((e) => e.f === file)!;
      const bodies = extractTxTransactionCallbackBodies(entry.content);
      for (const body of bodies) expect(body.includes('Promise.all(')).toBe(false);
    });

    it('역검증 — 헬퍼가 실제로 tx 콜백 안의 Promise.all을 검출한다', () => {
      const bodies = extractTxTransactionCallbackBodies(`
        await this.prisma.$transaction(async (tx) => {
          const [a, b] = await Promise.all([tx.intent.count({}), tx.keyword.count({})]);
        });
      `);
      expect(bodies.length).toBeGreaterThan(0);
      expect(bodies[0].includes('Promise.all(')).toBe(true);
    });
  });

  describe('T-15: asset-transfer/**·versions/**는 서로의 복원/이관 코드를 import하지 않는다', () => {
    it('asset-transfer/**에 versions/restore·VersionRestoreApplier import가 없다', () => {
      const targetFiles = apiFileContents.filter(({ f }) => f.includes('/src/asset-transfer/'));
      for (const { content } of targetFiles) {
        expect(content.includes('versions/restore')).toBe(false);
        expect(content.includes('VersionRestoreApplier')).toBe(false);
      }
    });
    it('versions/**에 asset-transfer import가 없다', () => {
      const targetFiles = apiFileContents.filter(({ f }) => f.includes('/src/versions/'));
      for (const { content } of targetFiles) {
        expect(content.includes('asset-transfer')).toBe(false);
      }
    });
  });

  describe('T-16: dialogue-bundle.service.ts의 topicId 매핑은 ?? undefined 정확히 6회 · ?? null 0회', () => {
    it('topicId: row.topicId ?? undefined 가 정확히 6회 등장한다', () => {
      const file = apiFileContents.find(({ f }) => f.endsWith('dialogue-common/dialogue-bundle.service.ts'))!;
      const count = nonCommentOccurrences(file.content, /topicId:\s*row\.topicId\s*\?\?\s*undefined/g);
      expect(count).toBe(6);
    });
    it('topicId: row.topicId ?? null 은 0회다', () => {
      const file = apiFileContents.find(({ f }) => f.endsWith('dialogue-common/dialogue-bundle.service.ts'))!;
      const count = nonCommentOccurrences(file.content, /topicId:\s*row\.topicId\s*\?\?\s*null/g);
      expect(count).toBe(0);
    });
  });
});
