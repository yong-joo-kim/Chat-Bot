import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import type { ZodTypeAny } from 'zod';
import { PublicFeedbackOfferSchema, PublicFeedbackRequestSchema, PublicFeedbackResponseSchema, PublicMessageResponseSchema } from '@chat-bot/shared-types';

/**
 * 피드백 기반 개선 루프(No.44) 정적 검사(feedback-loop-설계.md §17, F-1~F-16) — 기존
 * `topic-sealing.spec.ts`·`asset-write-sealing.spec.ts`와 같은 형식(스캔 루트 지정 · 자기 자신 제외 ·
 * 스캔 대상 0건 아님 가드 · 주석 줄 제외 · 역검증 픽스처 포함).
 */

const REPO_ROOT = resolve(__dirname, '../../../../..');
const SELF_ABSOLUTE = resolve(__dirname, 'feedback-sealing.spec.ts');

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

/** (런타임) zod 스키마를 재귀 순회해 모든 객체 키(필드명) 집합을 모은다(topic-sealing.spec.ts T-13 선례). */
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
    default:
      return keys;
  }
}

describe('피드백 기반 개선 루프(No.44) 정적 검사 — feedback-loop-설계.md §17', () => {
  const apiFiles = collectApiSourceFiles();
  const apiFileContents = apiFiles.map((f) => ({ f: toRepoRelative(f), content: readFileSync(f, 'utf8') }));
  const engineFiles = collectEngineSourceFiles();
  const engineFileContents = engineFiles.map((f) => ({ f: toRepoRelative(f), content: readFileSync(f, 'utf8') }));

  it('스캔 대상 파일이 존재한다(회귀 방지)', () => {
    expect(apiFiles.length).toBeGreaterThan(50);
    expect(engineFiles.length).toBeGreaterThan(5);
  });

  describe('F-1: messageFeedback 삭제 0건(FR-FB5-4, ADR-0033)', () => {
    const pattern = /messageFeedback\.(delete|deleteMany)\(/;
    it.each(apiFileContents.map(({ f }) => f))('%s에 messageFeedback.delete(·deleteMany(이 없다', (file) => {
      const entry = apiFileContents.find((e) => e.f === file)!;
      expect(nonCommentOccurrences(entry.content, pattern)).toBe(0);
    });

    it('원시 DELETE FROM "message_feedbacks" 0건', () => {
      for (const { content } of apiFileContents) {
        expect(nonCommentOccurrences(content, /DELETE FROM ["']message_feedbacks["']/i)).toBe(0);
      }
    });

    it('역검증 — 헬퍼가 실제로 delete 호출을 검출한다', () => {
      expect(nonCommentOccurrences('await this.prisma.messageFeedback.delete({ where: { id } });', pattern)).toBeGreaterThan(0);
    });
  });

  describe('F-2: messageFeedback 쓰기(create·update 등) 호출 파일은 feedback/message-feedback.service.ts 1개뿐(FR-0-141)', () => {
    const pattern = /messageFeedback\.(create|createMany|update|updateMany|upsert)\(/;
    it('등장 파일이 정확히 1개다', () => {
      const offenders = apiFileContents.filter(({ content }) => pattern.test(content)).map(({ f }) => f);
      expect(offenders).toEqual(['apps/api/src/feedback/message-feedback.service.ts']);
    });

    it('역검증 — 헬퍼가 실제로 create 호출을 검출한다', () => {
      expect(pattern.test('await this.prisma.messageFeedback.create({ data: {} });')).toBe(true);
    });
  });

  describe('F-3: MessageFeedback 필드 이름 허용 목록 · sessionId·ip·userAgent 부재(FR-FB5-2, NFR-FBS3)', () => {
    const ALLOWED_FIELDS = new Set([
      'id',
      'chatbotId',
      'chatbot',
      'conversationLogId',
      'rating',
      'changeCount',
      'groupId',
      'turnDayBucket',
      'turnCreatedAt',
      'channelType',
      'isAnswered',
      'answeredByRag',
      'apiNotice',
      'inputKind',
      'matchedIntentId',
      'matchedFaqId',
      'matchedNodeId',
      'topicId',
      'targetKind',
      'targetId',
      'queueOutcome',
      'queueSkipCode',
      'queuedAt',
      'queueItemId',
      'createdAt',
      'updatedAt',
    ]);

    function extractModelBlock(schema: string, modelName: string): string {
      const startIdx = schema.indexOf(`model ${modelName} {`);
      expect(startIdx).toBeGreaterThanOrEqual(0);
      const endIdx = startIdx + schema.slice(startIdx).indexOf('\n}');
      return schema.slice(startIdx, endIdx);
    }

    function extractFieldNames(modelBlock: string): string[] {
      const names: string[] = [];
      for (const rawLine of modelBlock.split('\n')) {
        const line = rawLine.trim();
        if (line.length === 0 || line.startsWith('///') || line.startsWith('//') || line.startsWith('model ') || line.startsWith('@@')) continue;
        const m = line.match(/^(\w+)\s+/);
        if (m) names.push(m[1]);
      }
      return names;
    }

    it('필드 이름 집합이 허용 목록과 정확히 같다', () => {
      const schema = readFileSync(join(REPO_ROOT, 'apps/api/prisma/schema.prisma'), 'utf8');
      const block = extractModelBlock(schema, 'MessageFeedback');
      const fields = extractFieldNames(block);
      expect(fields.length).toBeGreaterThan(0);
      for (const field of fields) expect(ALLOWED_FIELDS.has(field)).toBe(true);
      for (const allowed of ALLOWED_FIELDS) expect(fields).toContain(allowed);
    });

    it('sessionId·ip·userAgent 컬럼이 없다', () => {
      const schema = readFileSync(join(REPO_ROOT, 'apps/api/prisma/schema.prisma'), 'utf8');
      const block = extractModelBlock(schema, 'MessageFeedback');
      expect(block).not.toMatch(/^\s*sessionId\s/m);
      expect(block).not.toMatch(/^\s*ip\s/m);
      expect(block).not.toMatch(/^\s*userAgent\s/m);
    });
  });

  describe('F-4: MessageFeedback.chatbot 관계는 onDelete: Restrict(FR-FB10-1 ④)', () => {
    it('Restrict이고 Cascade·SetNull이 없다', () => {
      const schema = readFileSync(join(REPO_ROOT, 'apps/api/prisma/schema.prisma'), 'utf8');
      const startIdx = schema.indexOf('model MessageFeedback {');
      const endIdx = startIdx + schema.slice(startIdx).indexOf('\n}');
      const block = schema.slice(startIdx, endIdx);
      expect(block).toMatch(/chatbot\s+Chatbot\s+@relation\([^)]*onDelete:\s*Restrict/);
      expect(block).not.toMatch(/onDelete:\s*(Cascade|SetNull)/);
    });
  });

  describe('F-5: 영구삭제 사전검사에 messageFeedbacks 포함 · 삭제 트랜잭션 0건(FR-FB5-4)', () => {
    it('chatbots.service.ts에 messageFeedbacks 카운트·라벨이 있다', () => {
      const file = apiFileContents.find(({ f }) => f.endsWith('chatbots/chatbots.service.ts'))!;
      expect(file).toBeDefined();
      expect(file.content).toMatch(/messageFeedbacks/);
      expect(file.content).toMatch(/CHILD_COUNT_LABELS[\s\S]*messageFeedbacks:\s*'답변 평가'/);
    });

    it('chatbots.service.ts에 messageFeedback.delete·deleteMany가 없다', () => {
      const file = apiFileContents.find(({ f }) => f.endsWith('chatbots/chatbots.service.ts'))!;
      expect(nonCommentOccurrences(file.content, /messageFeedback\.(delete|deleteMany)\(/)).toBe(0);
    });
  });

  describe('F-6: @Public() 총 8 · submitFeedback 앞에 @Public()·@PublicRateBucket(·kind: \'FEEDBACK\'(FR-0-140)', () => {
    it('*.controller.ts 전체 @Public( 개수가 8이다', () => {
      const controllerFiles = apiFileContents.filter(({ f }) => f.endsWith('.controller.ts'));
      const total = controllerFiles.reduce((sum, { content }) => sum + nonCommentOccurrences(content, /@Public\(\)/g), 0);
      expect(total).toBe(8);
    });

    it('submitFeedback( 핸들러 앞에 @Public()·@PublicRateBucket(·kind: \'FEEDBACK\'가 있다', () => {
      const file = apiFileContents.find(({ f }) => f.endsWith('conversation/public-conversation.controller.ts'))!;
      const idx = file.content.indexOf('submitFeedback(');
      expect(idx).toBeGreaterThan(0);
      const before = file.content.slice(Math.max(0, idx - 600), idx);
      expect(before).toContain('@Public()');
      expect(before).toContain('@PublicRateBucket(');
      expect(before).toContain(`kind: 'FEEDBACK'`);
    });
  });

  describe('F-7: feedback/**·conversation/public-feedback.service.ts 의존 경계(FR-FB3-5, AC-FB3-8)', () => {
    const targetFiles = apiFileContents.filter(({ f }) => f.includes('/src/feedback/') || f.endsWith('conversation/public-feedback.service.ts'));
    const forbiddenImportPattern = /@chat-bot\/dialogue-engine|\/rag\/|\/handoff\/|\/embedding\/|\/survey-responses\/|\/dialogue-common\//;

    it('스캔 대상 파일이 존재한다', () => {
      expect(targetFiles.length).toBeGreaterThan(2);
    });

    it.each(targetFiles.map(({ f }) => f))('%s에 금지된 import가 없다', (file) => {
      const entry = targetFiles.find((e) => e.f === file)!;
      expect(nonCommentOccurrences(entry.content, forbiddenImportPattern)).toBe(0);
    });

    it.each(targetFiles.map(({ f }) => f))('%s에 DialogueBundleService·resolveTurn 심볼이 없다', (file) => {
      const entry = targetFiles.find((e) => e.f === file)!;
      expect(nonCommentOccurrences(entry.content, /\bDialogueBundleService\b|\bresolveTurn\b/g)).toBe(0);
    });

    it('역검증 — 헬퍼가 금지 import를 실제로 검출한다', () => {
      expect(nonCommentOccurrences("import { X } from '../rag/rag-gate.service';", forbiddenImportPattern)).toBeGreaterThan(0);
    });
  });

  describe('F-8: simulation|validation|versions|deploy-schedules|topics|asset-transfer/**에 feedback import·messageFeedback 토큰 0(FR-0-143, P-14)', () => {
    const targetDirs = ['/src/simulation/', '/src/validation/', '/src/versions/', '/src/deploy-schedules/', '/src/topics/', '/src/asset-transfer/'];
    const targetFiles = apiFileContents.filter(({ f }) => targetDirs.some((d) => f.includes(d)));

    it('스캔 대상 파일이 존재한다', () => {
      expect(targetFiles.length).toBeGreaterThan(5);
    });

    it.each(targetFiles.map(({ f }) => f))('%s에 feedback/ import·messageFeedback 토큰이 없다', (file) => {
      const entry = targetFiles.find((e) => e.f === file)!;
      expect(nonCommentOccurrences(entry.content, /\/feedback\//g)).toBe(0);
      expect(nonCommentOccurrences(entry.content, /\bmessageFeedback\b/g)).toBe(0);
    });
  });

  describe('F-9: unansweredQuestion 쓰기 호출 파일 집합 = 정확히 3개(FR-0-141 정정, §10.1)', () => {
    const pattern = /(?:prisma|tx)\.unansweredQuestion\.(create|createMany|update|updateMany|upsert)\(/;
    it('등장 파일이 정확히 3개다', () => {
      const offenders = apiFileContents.filter(({ content }) => pattern.test(content)).map(({ f }) => f);
      expect(new Set(offenders)).toEqual(
        new Set([
          'apps/api/src/learning/unanswered-collector.service.ts',
          'apps/api/src/learning/unanswered-questions.service.ts',
          'apps/api/src/learning/decomposed-resolve.service.ts',
        ]),
      );
    });
  });

  describe('F-10: conversationLog update* 0(R-10 재확인) · record()의 create.data에 feedbackOffered·inputKind 키 존재(FR-FB2-3)', () => {
    it('conversationLog.update·updateMany·upsert 호출이 0건이다', () => {
      const pattern = /conversationLog\.(update|updateMany|upsert)\(/;
      for (const { content } of apiFileContents) {
        expect(nonCommentOccurrences(content, pattern)).toBe(0);
      }
    });

    it('conversation-log.service.ts의 create.data에 feedbackOffered:·inputKind: 키가 있다', () => {
      const file = apiFileContents.find(({ f }) => f.endsWith('conversation/conversation-log.service.ts'))!;
      expect(nonCommentOccurrences(file.content, /feedbackOffered:/g)).toBeGreaterThan(0);
      expect(nonCommentOccurrences(file.content, /inputKind:\s*params\.inputKind/g)).toBeGreaterThan(0);
    });
  });

  describe('F-11: 공개 평가 스키마 키 집합 정확 일치(FR-FB3-3, NFR-FBS2)', () => {
    it('PublicFeedbackResponseSchema 키 = {rating}', () => {
      const keys = collectZodKeys(PublicFeedbackResponseSchema, new Set());
      expect(keys).toEqual(new Set(['rating']));
    });
    it('PublicFeedbackRequestSchema 키 = {sessionId, rating}', () => {
      const keys = collectZodKeys(PublicFeedbackRequestSchema, new Set());
      expect(keys).toEqual(new Set(['sessionId', 'rating']));
    });
    it('PublicFeedbackOfferSchema 키 = {rateable}', () => {
      const keys = collectZodKeys(PublicFeedbackOfferSchema, new Set());
      expect(keys).toEqual(new Set(['rateable']));
    });
    it('PublicMessageResponseSchema.feedback은 선택(optional) 필드다', () => {
      const shape = PublicMessageResponseSchema.shape;
      expect(shape.feedback._def.typeName).toBe('ZodOptional');
    });
  });

  describe('F-12: packages/dialogue-engine/src에 feedback 심볼(대소문자 무관) 0건(FR-0-138)', () => {
    it.each(engineFileContents.map(({ f }) => f))('%s에 feedback 심볼이 없다', (file) => {
      const entry = engineFileContents.find((e) => e.f === file)!;
      expect(nonCommentOccurrences(entry.content, /feedback/gi)).toBe(0);
    });

    it('역검증 — 헬퍼가 실제로 feedback 심볼을 검출한다', () => {
      expect(nonCommentOccurrences('const feedbackOffered = true;', /feedback/gi)).toBeGreaterThan(0);
      expect(nonCommentOccurrences('// feedback 관련 주석은 제외', /feedback/gi)).toBe(0);
    });
  });

  describe('F-13: feedback/**·conversation/public-feedback.service.ts의 logger 호출 줄에 원문·세션 키 0(FR-0-142, NFR-FBS4)', () => {
    const targetFiles = apiFileContents.filter(({ f }) => f.includes('/src/feedback/') || f.endsWith('conversation/public-feedback.service.ts'));
    const forbiddenTokens = ['userMessage', 'botResponse', 'questionText', 'sessionId'];

    it.each(targetFiles.map(({ f }) => f))('%s의 logger 호출 줄에 금지 토큰이 없다', (file) => {
      const entry = targetFiles.find((e) => e.f === file)!;
      const loggerLines = entry.content.split('\n').filter((line) => !isCommentLine(line) && /\b(this\.)?logger\.|(?<!\/\/.*)Logger\(/.test(line));
      for (const line of loggerLines) {
        for (const token of forbiddenTokens) expect(line.includes(token)).toBe(false);
      }
    });
  });

  describe('F-14: stats/feedback/** Prisma 쓰기 0 · $queryRaw 0(R-7 보유 파일 4 불변)', () => {
    const targetFiles = apiFileContents.filter(({ f }) => f.includes('/src/stats/feedback/'));
    const writePattern = /(?:prisma|tx)\.\w+\.(create|createMany|update|updateMany|delete|deleteMany|upsert)\(|\$executeRaw|\$queryRaw/;

    it('스캔 대상 파일이 존재한다', () => {
      expect(targetFiles.length).toBeGreaterThan(0);
    });

    it.each(targetFiles.map(({ f }) => f))('%s에 Prisma 쓰기·원시 SQL이 없다', (file) => {
      const entry = targetFiles.find((e) => e.f === file)!;
      expect(nonCommentOccurrences(entry.content, writePattern)).toBe(0);
    });
  });

  describe('F-15: collectNegativeFeedback( 호출 파일은 feedback/message-feedback.service.ts 1개뿐(FR-FB6-2)', () => {
    it('등장 파일이 정확히 1개다', () => {
      const offenders = apiFileContents.filter(({ content }) => /collectNegativeFeedback\(/.test(content)).map(({ f }) => f);
      // 정의부(learning/unanswered-collector.service.ts)는 `async collectNegativeFeedback(` 선언이라
      // 호출 패턴(`.collectNegativeFeedback(`)과 다르다 — 여기서는 "호출" 표현만 검사한다.
      const callSites = apiFileContents.filter(({ content }) => /\.collectNegativeFeedback\(/.test(content)).map(({ f }) => f);
      expect(callSites).toEqual(['apps/api/src/feedback/message-feedback.service.ts']);
      expect(offenders.length).toBeGreaterThanOrEqual(callSites.length);
    });
  });

  describe('F-16: 위젯 평가 막대에 sessionStorage·localStorage 0(FR-FB9-7)', () => {
    const widgetFiles = ['apps/widget/src/core/feedback.ts', 'apps/widget/src/ui/feedback-bar.ts'];
    it.each(widgetFiles)('%s — 존재하면 sessionStorage·localStorage가 없다(위젯 미구현 시 통과)', (relPath) => {
      const absPath = join(REPO_ROOT, relPath);
      if (!existsSync(absPath)) return; // 위젯 구현은 frontend-implementer 단계 — 파일 부재는 위반이 아니다.
      const content = readFileSync(absPath, 'utf8');
      expect(nonCommentOccurrences(content, /sessionStorage|localStorage/g)).toBe(0);
    });
  });
});
