import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * No.29 봉인 정적 검사(J-3, FR-I1-3, NFR-IS3, ADR-0033 §2, `integrated-stats-설계.md` §11 R-1~R-10).
 * "누적 통계 원천(`ConversationLog`/`UnansweredQuestion`)은 어떤 운영 코드 경로로도 지워지거나
 * 소급 변경되지 않는다"를 약속이 아니라 컴파일 불가/grep 0건으로 강제한다 — 기존 `*-sealing.spec.ts`
 * (`validation-sealing.spec.ts` 등)와 같은 형식.
 *
 * 검사 대상: `apps/api/src/**\/*.ts` 중 `*.spec.ts`·`src/integration/**` 제외(주석 제거 후 검사).
 * `prisma/`(seed·scripts)는 `src` 밖이라 자연히 제외된다.
 */

const REPO_ROOT = resolve(__dirname, '../../../../..');
const API_SRC = resolve(REPO_ROOT, 'apps/api/src');
const SELF_ABSOLUTE = resolve(__dirname, 'stats-retention-sealing.spec.ts');

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
    if (stat.isDirectory()) {
      walk(fullPath, extensions, out);
    } else if (extensions.some((ext) => entry.endsWith(ext))) {
      out.push(fullPath);
    }
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

describe('통합 통계(No.29) 원천 보존 봉인 정적 검사 — ADR-0033 §2, 설계서 §11 R-1~R-10', () => {
  const files = collectApiSourceFiles();
  const fileContents = files.map((f) => ({ f, content: readFileSync(f, 'utf8') }));

  it('스캔 대상 파일이 존재한다(회귀 방지 — 스캔 자체가 조용히 0건이 되는 것을 막는다)', () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it('R-1) apps/api/src에 conversationLog.delete|deleteMany 호출이 0건이다', () => {
    const pattern = /\.conversationLog\s*\.\s*(delete|deleteMany)\b/;
    const offenders = fileContents.filter(({ content }) => nonCommentOccurrences(content, pattern) > 0).map(({ f }) => f);
    expect(offenders).toEqual([]);
  });

  it('R-2) apps/api/src에 unansweredQuestion.delete|deleteMany 호출이 0건이다', () => {
    const pattern = /\.unansweredQuestion\s*\.\s*(delete|deleteMany)\b/;
    const offenders = fileContents.filter(({ content }) => nonCommentOccurrences(content, pattern) > 0).map(({ f }) => f);
    expect(offenders).toEqual([]);
  });

  it('R-3) 원시 SQL 문자열을 포함해 conversation_logs/unanswered_questions에 대한 DELETE FROM이 0건이다', () => {
    const pattern = /DELETE\s+FROM\s+"?(conversation_logs|unanswered_questions)"?/i;
    const offenders = fileContents.filter(({ content }) => pattern.test(content)).map(({ f }) => f);
    expect(offenders).toEqual([]);
  });

  it('R-4) LOG_DELETION_ALLOWLIST는 빈 배열이다(로그 삭제 경로는 이 ADR을 갱신하는 결정과 함께만 추가)', () => {
    // 이번 구현에 허용 목록 소비 코드가 없다 — 상수 자체가 존재하지 않는 것도 "빈 배열" 규약을
    // 어기지 않는다(FR-I1-4). 향후 도입 시 이 검사를 `LOG_DELETION_ALLOWLIST` 참조 + 길이 0 단언으로
    // 갱신한다. 현재는 상수가 정의되어 있다면 빈 배열이어야 한다는 것만 단언한다.
    const pattern = /LOG_DELETION_ALLOWLIST\s*=\s*(\[[^\]]*\])/;
    for (const { f, content } of fileContents) {
      const match = content.match(pattern);
      if (!match) continue;
      const arrayLiteral = match[1].replace(/\s/g, '');
      expect({ f, arrayLiteral }).toEqual({ f, arrayLiteral: '[]' });
    }
  });

  it('R-5) schema.prisma의 ConversationLog·UnansweredQuestion에 onDelete: Cascade|SetNull이 없다', () => {
    const schemaPath = resolve(REPO_ROOT, 'apps/api/prisma/schema.prisma');
    const content = readFileSync(schemaPath, 'utf8');
    const modelBlock = (name: string): string => {
      const start = content.indexOf(`model ${name} {`);
      expect(start).toBeGreaterThanOrEqual(0);
      const end = content.indexOf('\n}', start);
      return content.slice(start, end);
    };
    for (const name of ['ConversationLog', 'UnansweredQuestion']) {
      const block = modelBlock(name);
      expect(/onDelete:\s*(Cascade|SetNull)/.test(block)).toBe(false);
      expect(/onDelete:\s*Restrict/.test(block)).toBe(true);
    }
  });

  it('R-5b) apps/api/src/stats/**(kst-date.ts 제외)에 KST 헬퍼 재정의가 0건이다(FR-I5-4, AC-I6-4)', () => {
    const statsFiles = files.filter((f) => {
      const norm = f.replace(/\\/g, '/');
      return norm.includes('/src/stats/') && !norm.endsWith('/stats/lib/kst-date.ts');
    });
    const patterns = [/KST_OFFSET_MINUTES\s*=/, /function\s+toKstDateOnly\b/, /function\s+kstDateOnlyToUtc\b/];
    for (const f of statsFiles) {
      const content = readFileSync(f, 'utf8');
      for (const pattern of patterns) {
        expect({ f, hit: nonCommentOccurrences(content, pattern) }).toEqual({ f, hit: 0 });
      }
    }
  });

  it('R-6) 영구삭제 사전검사 목록에 conversationLogs·unansweredQuestions가 있고, 트랜잭션에 두 모델 삭제 호출이 없다(P-2)', () => {
    const chatbotsServicePath = resolve(API_SRC, 'chatbots/chatbots.service.ts');
    const content = readFileSync(chatbotsServicePath, 'utf8');

    const precheckStart = content.indexOf('const counts: Record<string, number> = {');
    const precheckEnd = content.indexOf('};', precheckStart);
    const precheckBlock = content.slice(precheckStart, precheckEnd);
    expect(/\bconversationLogs\b/.test(precheckBlock)).toBe(true);
    expect(/\bunansweredQuestions\b/.test(precheckBlock)).toBe(true);

    const txStart = content.indexOf('await this.prisma.$transaction(async (tx) => {');
    const txEnd = content.indexOf('});', txStart);
    const txBlock = content.slice(txStart, txEnd);
    expect(/tx\.conversationLog\s*\.\s*(delete|deleteMany)\b/.test(txBlock)).toBe(false);
    expect(/tx\.unansweredQuestion\s*\.\s*(delete|deleteMany)\b/.test(txBlock)).toBe(false);
  });

  it('R-7) $queryRaw 보유 파일이 정확히 4개다(stats.service.ts·integrated-session.query.ts·health.controller.ts·handoff-secure-delete.query.ts) · $queryRawUnsafe 등 0건', () => {
    const rawSqlPattern = /\$queryRaw\b/;
    const owners = fileContents.filter(({ content }) => rawSqlPattern.test(content)).map(({ f }) => f.replace(/\\/g, '/'));
    const expected = ['stats/stats.service.ts', 'stats/integrated/integrated-session.query.ts', 'health/health.controller.ts', 'handoff/handoff-secure-delete.query.ts'];
    for (const suffix of expected) {
      expect(owners.some((o) => o.endsWith(suffix))).toBe(true);
    }
    expect(owners.length).toBe(4);

    const statsFiles = fileContents.filter(({ f }) => f.replace(/\\/g, '/').includes('/src/stats/'));
    const unsafePattern = /\$(queryRawUnsafe|executeRaw|executeRawUnsafe)\b/;
    const unsafeOffenders = statsFiles.filter(({ content }) => nonCommentOccurrences(content, unsafePattern) > 0).map(({ f }) => f);
    expect(unsafeOffenders).toEqual([]);
  });

  it('R-8) stats/**에 Prisma 쓰기 호출이 0건이다(통계는 부수효과 없는 읽기 전용, FR-0-92)', () => {
    const statsFiles = fileContents.filter(({ f }) => f.replace(/\\/g, '/').includes('/src/stats/'));
    const writePattern = /\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\(/;
    const offenders = statsFiles.filter(({ content }) => nonCommentOccurrences(content, writePattern) > 0).map(({ f }) => f);
    expect(offenders).toEqual([]);
  });

  it('R-9) conversationLog.create|createMany 호출 파일은 conversation/conversation-log.service.ts 1개뿐이다(FR-I2-2)', () => {
    const pattern = /conversationLog\s*\.\s*(create|createMany)\b/;
    const owners = fileContents.filter(({ content }) => pattern.test(content)).map(({ f }) => f.replace(/\\/g, '/'));
    expect(owners.length).toBe(1);
    expect(owners[0].endsWith('conversation/conversation-log.service.ts')).toBe(true);
  });

  it('R-10) conversationLog.update|updateMany|upsert 호출 파일은 governance/writer/governance-data.writer.ts(텍스트 소거 1파일)뿐이다(적재 후 groupId 등은 불변, ADR-0033 §4 — No.45 갱신)', () => {
    const pattern = /conversationLog\s*\.\s*(update|updateMany|upsert)\b/;
    const offenders = fileContents.filter(({ content }) => pattern.test(content)).map(({ f }) => f.replace(/\\/g, '/'));
    const allowlist = ['apps/api/src/governance/writer/governance-data.writer.ts'];
    expect(offenders.every((f) => allowlist.some((a) => f.endsWith(a)))).toBe(true);
    expect(new Set(offenders).size).toBeGreaterThan(0);
  });

  it('AC-I1-3 역검증 — 픽스처 문자열에 conversationLog.deleteMany가 있으면 R-1 검사 로직이 실제로 잡아낸다', () => {
    const fixture = "await this.prisma.conversationLog.deleteMany({ where: { chatbotId: id } });";
    const pattern = /\.conversationLog\s*\.\s*(delete|deleteMany)\b/;
    expect(nonCommentOccurrences(fixture, pattern)).toBeGreaterThan(0);
  });
});
