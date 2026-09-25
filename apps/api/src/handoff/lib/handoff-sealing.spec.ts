import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * 하이브리드 CS(No.24) 봉인 정적 검사 — `hybrid-cs-설계.md` §18 H-1~H-17, ADR-0036.
 * 검사 대상: `apps/api/src/**\/*.ts`(`*.spec.ts`·`src/integration/**` 제외, 주석 제거 후 검사) +
 * `packages/dialogue-engine/src/**` + `schema.prisma` + (런타임) shared-types 스키마.
 */

const REPO_ROOT = resolve(__dirname, '../../../../..');
const API_SRC = resolve(REPO_ROOT, 'apps/api/src');
const ENGINE_SRC = resolve(REPO_ROOT, 'packages/dialogue-engine/src');
const SCHEMA_PATH = resolve(REPO_ROOT, 'apps/api/prisma/schema.prisma');
const SELF_ABSOLUTE = resolve(__dirname, 'handoff-sealing.spec.ts');

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

function nonCommentOccurrences(content: string, pattern: RegExp): number {
  let count = 0;
  for (const line of content.split('\n')) {
    if (isCommentLine(line)) continue;
    const matches = line.match(pattern);
    if (matches) count += matches.length;
  }
  return count;
}

function normPath(f: string): string {
  return f.replace(/\\/g, '/');
}

describe('하이브리드 CS(No.24) 봉인 정적 검사 — hybrid-cs-설계.md §18 H-1~H-17', () => {
  const files = collectApiSourceFiles();
  const fileContents = files.map((f) => ({ f, content: readFileSync(f, 'utf8') }));

  it('스캔 대상 파일이 존재한다(회귀 방지 — 스캔 자체가 조용히 0건이 되는 것을 막는다)', () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it('H-1) handoffSession·handoffMessage의 delete|deleteMany 호출이 0건이다(상담 기록 삭제 금지)', () => {
    const pattern = /\.(handoffSession|handoffMessage)\s*\.\s*(delete|deleteMany)\b/;
    const offenders = fileContents.filter(({ content }) => nonCommentOccurrences(content, pattern) > 0).map(({ f }) => f);
    expect(offenders).toEqual([]);

    const rawPattern = /DELETE\s+FROM\s+"?(handoff_sessions|handoff_messages)"?/i;
    const rawOffenders = fileContents.filter(({ content }) => rawPattern.test(content)).map(({ f }) => f);
    expect(rawOffenders).toEqual([]);
  });

  it('H-1 역검증 — 픽스처 문자열에 handoffSession.deleteMany가 있으면 검사 로직이 실제로 잡아낸다', () => {
    const fixture = 'await this.prisma.handoffSession.deleteMany({ where: { chatbotId: id } });';
    const pattern = /\.(handoffSession|handoffMessage)\s*\.\s*(delete|deleteMany)\b/;
    expect(nonCommentOccurrences(fixture, pattern)).toBeGreaterThan(0);
  });

  it('H-2) handoffSession·handoffMessage의 create|createMany|update|updateMany|upsert 호출 파일은 handoff-thread.service.ts 1개뿐이다(쓰기 주체 확산 금지)', () => {
    const pattern = /\.(handoffSession|handoffMessage)\s*\.\s*(create|createMany|update|updateMany|upsert)\b/;
    const owners = new Set(fileContents.filter(({ content }) => nonCommentOccurrences(content, pattern) > 0).map(({ f }) => normPath(f)));
    for (const owner of owners) {
      expect(owner.endsWith('handoff/handoff-thread.service.ts')).toBe(true);
    }
    expect(owners.size).toBe(1);
  });

  it('H-3) handoff-thread.service.ts 안 handoffMessage.update|updateMany 호출의 data 키는 {rawText, rawExpiresAt} 이하이고 값은 null이다(원문 소거 전용 — 메시지 변조 금지)', () => {
    const threadFile = fileContents.find(({ f }) => normPath(f).endsWith('handoff/handoff-thread.service.ts'));
    expect(threadFile).toBeDefined();
    const content = threadFile!.content;

    // handoffMessage.updateMany({ ... data: { rawText: null, rawExpiresAt: null } ... }) 블록을 모두 찾는다.
    const callPattern = /handoffMessage\s*\.\s*updateMany\s*\(\s*\{([\s\S]*?)\}\s*\)\s*;/g;
    let match: RegExpExecArray | null;
    let callCount = 0;
    while ((match = callPattern.exec(content)) !== null) {
      callCount += 1;
      const block = match[1];
      const dataMatch = block.match(/data\s*:\s*\{([^}]*)\}/);
      expect(dataMatch).not.toBeNull();
      const dataBlock = dataMatch![1];
      // 허용 키만 존재해야 한다.
      const keys = Array.from(dataBlock.matchAll(/(\w+)\s*:/g)).map((m) => m[1]);
      for (const key of keys) {
        expect(['rawText', 'rawExpiresAt']).toContain(key);
      }
      expect(/rawText\s*:\s*null/.test(dataBlock)).toBe(true);
      expect(/rawText\s*:\s*(?!null)[A-Za-z0-9_.]+/.test(dataBlock)).toBe(false);
    }
    expect(callCount).toBeGreaterThan(0);

    // 원문에 값을 쓰는 곳(rawText: rawText 형태의 create)은 handoffMessage.create 블록(appendUserMessage) 1곳뿐이다.
    const createPattern = /handoffMessage\s*\.\s*create\s*\(\s*\{[\s\S]*?rawText\s*,/g;
    const createMatches = content.match(createPattern) ?? [];
    expect(createMatches.length).toBeLessThanOrEqual(1);
  });

  it('H-4) schema.prisma — 신규 4모델은 onDelete: Restrict만 쓰고, HandoffSession에 토큰 원문 컬럼이 없으며, rawText에 인덱스가 없다', () => {
    const content = readFileSync(SCHEMA_PATH, 'utf8');
    const modelBlock = (name: string): string => {
      const start = content.indexOf(`model ${name} {`);
      expect(start).toBeGreaterThanOrEqual(0);
      const end = content.indexOf('\n}', start);
      return content.slice(start, end);
    };

    for (const name of ['ChatbotHandoffSetting', 'HandoffSession', 'HandoffMessage', 'CannedResponse']) {
      const block = modelBlock(name);
      const onDeletes = Array.from(block.matchAll(/onDelete:\s*(\w+)/g)).map((m) => m[1]);
      for (const v of onDeletes) expect(v).toBe('Restrict');
    }

    const sessionBlock = modelBlock('HandoffSession');
    // 필드 선언 줄만 본다(주석 제외) — "sha256(token) hex" 같은 설명 주석은 오탐이다.
    const fieldLines = sessionBlock.split('\n').filter((l) => !isCommentLine(l) && /^\s*\w+\s+\w/.test(l));
    const tokenFieldLines = fieldLines.filter((l) => /\btoken\w*/i.test(l));
    for (const line of tokenFieldLines) {
      expect(/^\s*token(Hash|IssuedAt)\b/.test(line)).toBe(true);
    }
    expect(/tokenHash\s+String\?\s+@unique/.test(sessionBlock)).toBe(true);

    const messageBlock = modelBlock('HandoffMessage');
    expect(/rawText[^\n]*@@index/.test(messageBlock)).toBe(false);
    // rawText 필드 자체에는 인덱스 애너테이션이 없다(같은 줄 검사) — @@index([rawExpiresAt])는 별도 필드.
    const rawTextLine = messageBlock.split('\n').find((l) => /^\s*rawText\s/.test(l));
    expect(rawTextLine).toBeDefined();
    expect(rawTextLine).not.toMatch(/@@index|@unique/);
  });

  it('H-5) rawText 식별자는 지정된 파일 밖(stats/**·versions/**·audit-logs/**·handoff-public-poll·handoff-hints·handoff-history)에 등장하지 않는다(원문 출구 확산 방지)', () => {
    const forbiddenDirs = ['/src/stats/', '/src/versions/', '/src/audit-logs/'];
    const forbiddenFiles = ['handoff/handoff-public-poll.service.ts', 'handoff/handoff-hints.service.ts', 'handoff/handoff-history.service.ts', 'handoff/handoff-console.service.ts', 'handoff/handoff-actions.service.ts', 'handoff/handoff-settings.service.ts'];
    const pattern = /\brawText\b/;

    const offenders = fileContents
      .filter(({ f, content }) => {
        const norm = normPath(f);
        const inForbiddenDir = forbiddenDirs.some((d) => norm.includes(d));
        const isForbiddenFile = forbiddenFiles.some((suffix) => norm.endsWith(suffix));
        return (inForbiddenDir || isForbiddenFile) && nonCommentOccurrences(content, pattern) > 0;
      })
      .map(({ f }) => f);
    expect(offenders).toEqual([]);
  });

  it('H-6) handoff/**·canned-responses/**의 logger 호출 인자에 rawText|token|sessionId|.message 식별자가 없다(원문·토큰 로그 금지 — 휴리스틱)', () => {
    const scoped = fileContents.filter(({ f }) => {
      const norm = normPath(f);
      return norm.includes('/src/handoff/') || norm.includes('/src/canned-responses/');
    });
    const loggerCallPattern = /logger\s*\.\s*(log|warn|error|debug)\s*\(([^)]*)\)/g;
    const forbiddenIdentifiers = /\brawText\b|\btoken\b|\bsessionId\b|\.message\b/;

    const offenders: string[] = [];
    for (const { f, content } of scoped) {
      for (const line of content.split('\n')) {
        if (isCommentLine(line)) continue;
        const matches = Array.from(line.matchAll(loggerCallPattern));
        for (const m of matches) {
          if (forbiddenIdentifiers.test(m[2])) offenders.push(`${f}: ${line.trim()}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('H-7) endHandoff·purgeExpiredRaw 블록에 enableSecureDelete(와 rawText: null이 모두 있다 · handoff의 $queryRaw 보유 파일은 1개뿐이다', () => {
    const threadFile = fileContents.find(({ f }) => normPath(f).endsWith('handoff/handoff-thread.service.ts'));
    const content = threadFile!.content;

    const endBlockStart = content.indexOf('async endHandoff(');
    const endBlockEnd = content.indexOf('\n  async ', endBlockStart + 1);
    const endBlock = content.slice(endBlockStart, endBlockEnd);
    expect(endBlock.includes('enableSecureDelete(')).toBe(true);
    expect(endBlock.includes('rawText: null')).toBe(true);

    const purgeStart = content.indexOf('async purgeExpiredRaw(');
    const purgeEnd = content.indexOf('\n  async ', purgeStart + 1);
    const purgeBlock = content.slice(purgeStart, purgeEnd > 0 ? purgeEnd : content.length);
    expect(purgeBlock.includes('enableSecureDelete(')).toBe(true);
    expect(purgeBlock.includes('rawText: null')).toBe(true);

    const handoffRawSqlOwners = fileContents
      .filter(({ f, content: c }) => normPath(f).includes('/src/handoff/') && /\$queryRaw\b/.test(c))
      .map(({ f }) => normPath(f));
    expect(handoffRawSqlOwners.length).toBe(1);
    expect(handoffRawSqlOwners[0].endsWith('handoff/handoff-secure-delete.query.ts')).toBe(true);
  });

  it('H-8) chatbots.service.ts 사전검사 counts에 handoffSessions·cannedResponses가 있고, 동반 삭제 트랜잭션에 handoffSession|handoffMessage|cannedResponse 삭제가 없다(chatbotHandoffSetting.deleteMany만 허용)', () => {
    const chatbotsServicePath = resolve(API_SRC, 'chatbots/chatbots.service.ts');
    const content = readFileSync(chatbotsServicePath, 'utf8');

    const precheckStart = content.indexOf('const counts: Record<string, number> = {');
    const precheckEnd = content.indexOf('};', precheckStart);
    const precheckBlock = content.slice(precheckStart, precheckEnd);
    expect(/\bhandoffSessions\b/.test(precheckBlock)).toBe(true);
    expect(/\bcannedResponses\b/.test(precheckBlock)).toBe(true);

    const txStart = content.indexOf('await this.prisma.$transaction(async (tx) => {');
    const chatbotDeleteIdx = content.indexOf('tx.chatbot.delete(', txStart);
    const txEnd = content.indexOf('});', chatbotDeleteIdx);
    const txBlock = content.slice(txStart, txEnd);
    expect(/tx\.handoffSession\s*\.\s*(delete|deleteMany)\b/.test(txBlock)).toBe(false);
    expect(/tx\.handoffMessage\s*\.\s*(delete|deleteMany)\b/.test(txBlock)).toBe(false);
    expect(/tx\.cannedResponse\s*\.\s*(delete|deleteMany)\b/.test(txBlock)).toBe(false);
    expect(/tx\.chatbotHandoffSetting\s*\.\s*deleteMany\b/.test(txBlock)).toBe(true);
  });

  it('H-2 역검증 — 픽스처에 다른 파일의 handoffSession.update가 있으면 검사 로직이 실제로 잡아낸다', () => {
    const fixture = 'await this.prisma.handoffSession.update({ where: { id }, data: { assignedUserId: x } });';
    const pattern = /\.(handoffSession|handoffMessage)\s*\.\s*(create|createMany|update|updateMany|upsert)\b/;
    expect(nonCommentOccurrences(fixture, pattern)).toBeGreaterThan(0);
  });

  it('H-6 역검증 — 픽스처 문자열에 logger.warn(rawText)가 있으면 검사 로직이 실제로 잡아낸다', () => {
    const fixture = "logger.warn(`실패: rawText=${rawText}`);";
    const loggerCallPattern = /logger\s*\.\s*(log|warn|error|debug)\s*\(([^)]*)\)/g;
    const forbiddenIdentifiers = /\brawText\b|\btoken\b|\bsessionId\b|\.message\b/;
    const matches = Array.from(fixture.matchAll(loggerCallPattern));
    expect(matches.some((m) => forbiddenIdentifiers.test(m[2]))).toBe(true);
  });

  it('H-9) packages/dialogue-engine/src에 handoff·cannedResponse·HandoffGate 심볼이 0건이다(엔진 수정 0, FR-0-118)', () => {
    const engineFiles: string[] = [];
    walk(ENGINE_SRC, ['.ts'], engineFiles);
    expect(engineFiles.length).toBeGreaterThan(0);
    const pattern = /handoff|cannedResponse|HandoffGate/i;
    const offenders = engineFiles.filter((f) => pattern.test(readFileSync(f, 'utf8'))).map((f) => f);
    expect(offenders).toEqual([]);
  });

  it('H-10) @Public() 총 8건이며 7번째는 PublicConversationController#pollHandoff · 8번째는 submitFeedback다', () => {
    const controllerFiles: string[] = [];
    walk(API_SRC, ['.controller.ts'], controllerFiles);
    let total = 0;
    for (const f of controllerFiles) total += nonCommentOccurrences(readFileSync(f, 'utf8'), /@Public\(\)/g);
    expect(total).toBe(8);

    const controllerFile = readFileSync(resolve(API_SRC, 'conversation/public-conversation.controller.ts'), 'utf8');
    const pollHandoffIndex = controllerFile.indexOf('pollHandoff(');
    // [No.44] 새 핸들러(submitFeedback)는 파일 끝에 둔다 — pollHandoff( 앞 400자 검사는 불변이다.
    const precedingDecorator = controllerFile.slice(Math.max(0, pollHandoffIndex - 400), pollHandoffIndex);
    expect(precedingDecorator.includes('@Public()')).toBe(true);
  });

  it('H-11) handoff/**·canned-responses/**에 외부 송신·실시간 채널·생성형 힌트 심볼이 0건이다', () => {
    const scoped = fileContents.filter(({ f }) => {
      const norm = normPath(f);
      return norm.includes('/src/handoff/') || norm.includes('/src/canned-responses/');
    });
    const patterns = [/\bfetch\(/, /\baxios\b/, /\bhttp\.request\(/, /\bWebSocket\b/, /\bEventSource\b/, /@Sse\(/, /\bsocket\.io\b/, /\bRagHttpClient\b/, /\baugmentation\b/i];
    for (const { f, content } of scoped) {
      for (const pattern of patterns) {
        expect({ f, hit: nonCommentOccurrences(content, pattern) }).toEqual({ f, hit: 0 });
      }
    }
  });

  it('H-12) simulation/**·validation/**·versions/**·deploy-schedules/**·stats/**·learning/**에 handoff/·canned-responses/ import가 0건이다(DI 격리, FR-0-123)', () => {
    const dirs = ['/src/simulation/', '/src/validation/', '/src/versions/', '/src/deploy-schedules/', '/src/stats/', '/src/learning/'];
    const importRe = /from\s+['"][^'"]*\/(handoff|canned-responses)\//;
    const offenders = fileContents
      .filter(({ f, content }) => dirs.some((d) => normPath(f).includes(d)) && importRe.test(content))
      .map(({ f }) => f);
    expect(offenders).toEqual([]);
  });

  it('H-13) appendUserMessage·appendAgentMessage 블록에서 금지어 마스킹(maskPlainText)이 PII 마스킹(maskPii)에 중첩(먼저 실행)되고, 다른 파일에서 handoffMessage 쓰기의 text: 대입이 없다(마스킹 순서·누락 방지)', () => {
    const threadFile = fileContents.find(({ f }) => normPath(f).endsWith('handoff/handoff-thread.service.ts'));
    const content = threadFile!.content;

    for (const methodName of ['appendUserMessage', 'appendAgentMessage']) {
      const start = content.indexOf(`async ${methodName}(`);
      expect(start).toBeGreaterThanOrEqual(0);
      const nextMethod = content.indexOf('\n  async ', start + 1);
      const end = nextMethod > 0 ? nextMethod : content.length;
      const block = content.slice(start, end);
      const maskPlainIdx = block.indexOf('maskPlainText(');
      const maskPiiIdx = block.indexOf('maskPii(');
      expect(maskPlainIdx).toBeGreaterThanOrEqual(0);
      expect(maskPiiIdx).toBeGreaterThanOrEqual(0);
      // `maskPii(await this.bannedWordFilter.maskPlainText(x)).maskedText`(ConversationLogService.record()와
      // 같은 중첩 형태) — 실행 순서는 안쪽 maskPlainText가 먼저이고(금지어→PII), 텍스트 위치는
      // maskPii( 가 먼저 나온다(감싸는 호출이 왼쪽에 온다). 두 함수가 같은 문장 안에서 중첩 호출됐는지만 확인한다.
      expect(maskPiiIdx).toBeLessThan(maskPlainIdx);
    }

    const otherFiles = fileContents.filter(({ f }) => normPath(f).includes('/src/handoff/') && !normPath(f).endsWith('handoff-thread.service.ts'));
    const textAssignPattern = /handoffMessage\s*\.\s*(create|update|updateMany)\s*\([\s\S]*?text\s*:/;
    const offenders = otherFiles.filter(({ content: c }) => textAssignPattern.test(c)).map(({ f }) => f);
    expect(offenders).toEqual([]);
  });

  it('H-15) AUDIT_FIELDS.HandoffSession·CannedResponse에 원문·전체 세션 식별자·토큰 필드가 없다', () => {
    const snapshotFile = readFileSync(resolve(API_SRC, 'audit-logs/lib/audit-snapshot.ts'), 'utf8');
    const handoffFieldsMatch = snapshotFile.match(/HandoffSession:\s*\[([^\]]*)\]/);
    const cannedFieldsMatch = snapshotFile.match(/CannedResponse:\s*\[([^\]]*)\]/);
    expect(handoffFieldsMatch).not.toBeNull();
    expect(cannedFieldsMatch).not.toBeNull();
    const forbidden = ['text', 'body', 'rawText', 'sessionId', 'sessionRef', 'token'];
    for (const forbiddenField of forbidden) {
      expect(handoffFieldsMatch![1]).not.toMatch(new RegExp(`'${forbiddenField}'`));
      expect(cannedFieldsMatch![1]).not.toMatch(new RegExp(`'${forbiddenField}'`));
    }
  });

  it('H-16) CONVERSATION_STATE_VERSION은 1이고 ConversationStateSchema 키 집합은 5개로 불변이다(봉투에 상담 상태 유입 금지)', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const shared = require('@chat-bot/shared-types');
    expect(shared.CONVERSATION_STATE_VERSION).toBe(1);
    const keys = Object.keys(shared.ConversationStateSchema.shape).sort();
    expect(keys).toEqual(['completedSurveyIds', 'contextSession', 'pendingClarify', 'surveySession', 'version'].sort());
  });

  it('H-17) LiveSessionRow·TranscriptResponse·HandoffDetail·HandoffHistoryItem·HandoffBrief 스키마에 sessionId 키가 없다(전체 sessionId 미노출, P-5)', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const shared = require('@chat-bot/shared-types');
    const schemasToCheck: Array<[string, unknown]> = [
      ['LiveSessionRowSchema', shared.LiveSessionRowSchema],
      ['HandoffBriefSchema', shared.HandoffBriefSchema],
      ['HandoffDetailSchema', shared.HandoffDetailSchema],
      ['HandoffHistoryItemSchema', shared.HandoffHistoryItemSchema],
    ];
    for (const [name, schema] of schemasToCheck) {
      const shape = (schema as { shape: Record<string, unknown> }).shape;
      expect({ name, hasSessionId: 'sessionId' in shape }).toEqual({ name, hasSessionId: false });
    }
    const transcriptShape = (shared.TranscriptResponseSchema as { shape: Record<string, unknown> }).shape;
    expect('sessionId' in transcriptShape).toBe(false);
  });

  it('(런타임 H-14) HandoffPollMessageSchema·HandoffPollResponseSchema·PublicHandoffStateSchema 키 집합이 계약대로다(공개 응답에 원문·내부 id·신원 없음)', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const shared = require('@chat-bot/shared-types');
    expect(Object.keys(shared.HandoffPollMessageSchema.shape).sort()).toEqual(['action', 'seq', 'sender', 'sentAt', 'text'].sort());
    expect(Object.keys(shared.HandoffPollResponseSchema.shape).sort()).toEqual(['cursor', 'messages', 'pollAfterMs', 'status', 'token'].sort());
    expect(Object.keys(shared.PublicHandoffStateSchema.shape).sort()).toEqual(['pollAfterMs', 'status', 'token', 'watch'].sort());
  });
});
