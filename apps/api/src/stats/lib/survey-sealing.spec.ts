import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { CONVERSATION_STATE_VERSION, SURVEY_SESSION_STATE_KEYS, SurveySessionStateSchema } from '@chat-bot/shared-types';
import { SNAPSHOT_SCHEMA_VERSION, VersionAssetKind } from '@chat-bot/shared-types';

/**
 * 설문관리(No.27) 봉인 정적 검사(ADR-0035 §14 S-1~S-14) — `validation-sealing.spec.ts`·
 * `legacy-api-sealing.spec.ts`·`stats-retention-sealing.spec.ts`와 같은 형식.
 * 검사 대상: `apps/api/src/**\/*.ts`(`*.spec.ts`·`src/integration/**` 제외) +
 * `packages/dialogue-engine/src/**\/*.ts`(spec 제외) + `schema.prisma`.
 */

const REPO_ROOT = resolve(__dirname, '../../../../..');
const API_SRC = resolve(REPO_ROOT, 'apps/api/src');
const ENGINE_SRC = resolve(REPO_ROOT, 'packages/dialogue-engine/src');
const SELF_ABSOLUTE = resolve(__dirname, 'survey-sealing.spec.ts');

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

function collectApiSourceFiles(): string[] {
  const files: string[] = [];
  walk(API_SRC, ['.ts'], files);
  return files.filter((f) => {
    const norm = f.replace(/\\/g, '/');
    if (f === SELF_ABSOLUTE) return false;
    if (norm.endsWith('.spec.ts')) return false;
    if (norm.includes('/src/integration/')) return false;
    return true;
  });
}

function collectEngineSourceFiles(): string[] {
  const files: string[] = [];
  walk(ENGINE_SRC, ['.ts'], files);
  return files.filter((f) => !f.replace(/\\/g, '/').endsWith('.spec.ts'));
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

describe('설문관리(No.27) 봉인 정적 검사 — ADR-0035 §14', () => {
  const apiFiles = collectApiSourceFiles();
  const apiFileContents = apiFiles.map((f) => ({ f: f.replace(/\\/g, '/'), content: readFileSync(f, 'utf8') }));
  const engineFiles = collectEngineSourceFiles();
  const engineFileContents = engineFiles.map((f) => ({ f: f.replace(/\\/g, '/'), content: readFileSync(f, 'utf8') }));

  it('스캔 대상 파일이 존재한다(회귀 방지)', () => {
    expect(apiFiles.length).toBeGreaterThan(50);
    expect(engineFiles.length).toBeGreaterThan(10);
  });

  it('S-1) surveyResponse·surveyAnswer의 delete|deleteMany 호출과 원시 DELETE가 0건이다', () => {
    const writePattern = /\.(surveyResponse|surveyAnswer)\s*\.\s*(delete|deleteMany)\b/;
    const offenders = apiFileContents.filter(({ content }) => nonCommentOccurrences(content, writePattern) > 0).map(({ f }) => f);
    expect(offenders).toEqual([]);

    const rawPattern = /DELETE\s+FROM\s+"?(survey_responses|survey_answers)"?/i;
    const rawOffenders = apiFileContents.filter(({ content }) => rawPattern.test(content)).map(({ f }) => f);
    expect(rawOffenders).toEqual([]);
  });

  it('S-2) surveyResponse·surveyAnswer의 create|createMany|update|updateMany|upsert 호출 파일은 survey-response.service.ts 1개뿐이다', () => {
    const pattern = /\.(surveyResponse|surveyAnswer)\s*\.\s*(create|createMany|update|updateMany|upsert)\b/;
    const owners = [...new Set(apiFileContents.filter(({ content }) => pattern.test(content)).map(({ f }) => f))];
    expect(owners.length).toBe(1);
    expect(owners[0].endsWith('/survey-responses/survey-response.service.ts')).toBe(true);
  });

  it('S-3) schema.prisma의 SurveyResponse·SurveyAnswer에 Cascade|SetNull이 없고 Restrict가 있으며 금지 필드가 없다', () => {
    const schemaPath = resolve(REPO_ROOT, 'apps/api/prisma/schema.prisma');
    const content = readFileSync(schemaPath, 'utf8');
    const modelBlock = (name: string): string => {
      const start = content.indexOf(`model ${name} {`);
      expect(start).toBeGreaterThanOrEqual(0);
      const end = content.indexOf('\n}', start);
      return content.slice(start, end);
    };
    for (const name of ['SurveyResponse', 'SurveyAnswer']) {
      const block = modelBlock(name);
      expect(/onDelete:\s*(Cascade|SetNull)/.test(block)).toBe(false);
    }
    expect(/onDelete:\s*Restrict/.test(modelBlock('SurveyResponse'))).toBe(true);
    expect(/onDelete:\s*Restrict/.test(modelBlock('SurveyAnswer'))).toBe(true);

    const forbiddenFieldNames = ['ip', 'userAgent', 'cookie', 'raw', 'original'];
    for (const name of ['SurveyResponse', 'SurveyAnswer']) {
      const block = modelBlock(name);
      for (const field of forbiddenFieldNames) {
        expect(new RegExp(`^\\s*${field}\\s+`, 'm').test(block)).toBe(false);
      }
    }
  });

  it('S-4) 영구삭제 사전검사 counts에 surveys·surveyResponses가 있고 동반 삭제 트랜잭션에 survey* 삭제가 없다', () => {
    const chatbotsServicePath = resolve(API_SRC, 'chatbots/chatbots.service.ts');
    const content = readFileSync(chatbotsServicePath, 'utf8');

    const precheckStart = content.indexOf('const counts: Record<string, number> = {');
    const precheckEnd = content.indexOf('};', precheckStart);
    const precheckBlock = content.slice(precheckStart, precheckEnd);
    expect(/\bsurveys\b/.test(precheckBlock)).toBe(true);
    expect(/\bsurveyResponses\b/.test(precheckBlock)).toBe(true);

    const txStart = content.indexOf('await this.prisma.$transaction(async (tx) => {');
    const txEnd = content.indexOf('});', txStart);
    const txBlock = content.slice(txStart, txEnd);
    expect(/tx\.survey\s*\.\s*(delete|deleteMany)\b/.test(txBlock)).toBe(false);
    expect(/tx\.surveyResponse\s*\.\s*(delete|deleteMany)\b/.test(txBlock)).toBe(false);
    expect(/tx\.surveyAnswer\s*\.\s*(delete|deleteMany)\b/.test(txBlock)).toBe(false);
  });

  it('S-5) packages/dialogue-engine/src에 surveyResponse·SurveyResponseService·@prisma 심볼이 0건이다', () => {
    for (const { f, content } of engineFileContents) {
      expect({ f, hit: nonCommentOccurrences(content, /\bsurveyResponse\b/) }).toEqual({ f, hit: 0 });
      expect({ f, hit: nonCommentOccurrences(content, /\bSurveyResponseService\b/) }).toEqual({ f, hit: 0 });
      expect({ f, hit: nonCommentOccurrences(content, /@prisma/) }).toEqual({ f, hit: 0 });
    }
  });

  it('S-6) SurveyResponseService 참조 파일은 conversation/·survey-responses/**뿐이고 simulation/validation/versions/stats/deploy-schedules에는 survey-responses/ import가 0건이다', () => {
    const refPattern = /\bSurveyResponseService\b/;
    const owners = apiFileContents.filter(({ content }) => refPattern.test(content)).map(({ f }) => f);
    for (const f of owners) {
      const allowed =
        f.includes('/src/survey-responses/') ||
        f.endsWith('/conversation/public-conversation.service.ts') ||
        f.endsWith('/conversation/conversation.module.ts');
      expect({ f, allowed }).toEqual({ f, allowed: true });
    }

    const importPattern = /from\s+['"][^'"]*survey-responses\//;
    const forbiddenDirs = ['/src/simulation/', '/src/validation/', '/src/versions/', '/src/stats/', '/src/deploy-schedules/'];
    const offenders = apiFileContents.filter(({ f, content }) => forbiddenDirs.some((d) => f.includes(d)) && importPattern.test(content)).map(({ f }) => f);
    expect(offenders).toEqual([]);
  });

  it('S-9(런타임) CONVERSATION_STATE_VERSION===1이고 SurveySessionStateSchema 키 집합이 정확히 일치한다', () => {
    expect(CONVERSATION_STATE_VERSION).toBe(1);
    const shape = (SurveySessionStateSchema as unknown as { shape: Record<string, unknown> }).shape;
    expect(new Set(Object.keys(shape))).toEqual(new Set(SURVEY_SESSION_STATE_KEYS));
  });

  it('S-10) stats/surveys/**에 Prisma 쓰기 호출이 0건이다(R-8이 stats/** 전체를 이미 포함한다 — 명시 재확인)', () => {
    const statsSurveyFiles = apiFileContents.filter(({ f }) => f.includes('/src/stats/surveys/'));
    expect(statsSurveyFiles.length).toBeGreaterThan(0);
    const writePattern = /\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\(/;
    const offenders = statsSurveyFiles.filter(({ content }) => nonCommentOccurrences(content, writePattern) > 0).map(({ f }) => f);
    expect(offenders).toEqual([]);
  });

  it('S-11) survey-response.service.ts는 maskPlainText(가 maskPii(보다 먼저 나오고, surveyAnswer 쓰기 호출에 textValue를 싣는 파일은 이 파일뿐이다(S-2가 쓰기 파일 자체를 이미 봉인)', () => {
    const target = apiFileContents.find(({ f }) => f.endsWith('/survey-responses/survey-response.service.ts'));
    expect(target).toBeDefined();
    const maskPlainIdx = target!.content.indexOf('maskPlainText(');
    const maskPiiIdx = target!.content.indexOf('maskPii(');
    expect(maskPlainIdx).toBeGreaterThanOrEqual(0);
    expect(maskPiiIdx).toBeGreaterThanOrEqual(0);
    expect(maskPlainIdx).toBeLessThan(maskPiiIdx);
    // S-2가 surveyAnswer 쓰기 호출 파일을 이미 1개(이 파일)로 봉인한다 — `textValue`는
    // `lib/answer-rows.ts`(순수 빌더)가 만들고 이 파일이 그대로 `createMany`에 싣는다.
  });

  it('S-12) survey-responses/**·surveys/**·stats/surveys/**의 logger 호출 인자에 응답 값·sessionId·.message 식별자가 없다(휴리스틱)', () => {
    const targetDirs = ['/src/survey-responses/', '/src/surveys/', '/src/stats/surveys/'];
    const loggerCallRe = /logger\.(log|warn|error|debug)\(([^;]*?)\)/gs;
    const forbiddenIdentifierRe = /\b(text|value|textValue|sessionId)\b|\.message\b/;
    const offenders: string[] = [];
    for (const { f, content } of apiFileContents) {
      if (!targetDirs.some((d) => f.includes(d))) continue;
      const calls = [...content.matchAll(loggerCallRe)];
      for (const call of calls) {
        if (forbiddenIdentifierRe.test(call[2])) offenders.push(f);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('S-13) snapshot-envelope.ts에 surveys가 0건이고 SNAPSHOT_SCHEMA_VERSION===1·VersionAssetKind 8종이 불변이다', () => {
    const target = apiFileContents.find(({ f }) => f.endsWith('/versions/lib/snapshot-envelope.ts'));
    expect(target).toBeDefined();
    expect(nonCommentOccurrences(target!.content, /\bsurveys\b/)).toBe(0);
    expect(SNAPSHOT_SCHEMA_VERSION).toBe(1);
    expect(new Set(VersionAssetKind.options)).toEqual(
      new Set(['INTENT', 'KEYWORD', 'HOMONYM', 'CONTEXT', 'NODE', 'FAQ', 'ANSWER_SETTING', 'PROFILE']),
    );
  });

  it('S-14) survey.(create|update|updateMany|upsert|delete|deleteMany) 호출 파일은 surveys.service.ts 1개뿐이다', () => {
    const pattern = /\bsurvey\s*\.\s*(create|update|updateMany|upsert|delete|deleteMany)\b/;
    const owners = apiFileContents.filter(({ content }) => pattern.test(content)).map(({ f }) => f);
    for (const f of owners) {
      expect({ f, isOwner: f.endsWith('/surveys/surveys.service.ts') }).toEqual({ f, isOwner: true });
    }
  });
});
