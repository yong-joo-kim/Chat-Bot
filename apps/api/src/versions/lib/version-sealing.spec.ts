import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * 챗봇 복원/버전 이력관리(No.25) 정적 검사(§16.1) — `rag-allowlist.spec.ts`·`asset-write-sealing.spec.ts`
 * ·`validation-sealing.spec.ts`와 같은 형식(스캔 루트 지정 · 자기 자신 제외 · 스캔 대상 0건 아님 가드 ·
 * 주석 줄 제외).
 */

const REPO_ROOT = resolve(__dirname, '../../../../..');
const SELF_ABSOLUTE = resolve(__dirname, 'version-sealing.spec.ts');

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
  walk(join(REPO_ROOT, 'apps/api/src'), ['.ts'], files);
  return files.filter((f) => f !== SELF_ABSOLUTE);
}

function collectEngineSourceFiles(): string[] {
  const files: string[] = [];
  walk(join(REPO_ROOT, 'packages/dialogue-engine/src'), ['.ts'], files);
  return files;
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

function stripComments(content: string): string {
  return content
    .split('\n')
    .map((line) => (isCommentLine(line) ? '' : line))
    .join('\n');
}

/**
 * `xxx.$transaction(async (tx) => { ... })` 형태의 **블록 바디** 콜백 본문을 추출한다(중괄호 균형
 * 매칭 — M-1 재발 방지). `(tx) => expr`처럼 블록이 아닌 표현식 바디는 대상에서 제외한다(이 저장소의
 * 실제 사용 패턴에는 존재하지 않는다).
 */
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
    // 콜백 매개변수명이 tx인 경우만 대상(다른 헬퍼의 콜백은 대상 아님).
    if (!/\(\s*tx\b/.test(header)) {
      searchFrom = arrowIdx + 2;
      continue;
    }
    let i = arrowIdx + 2;
    while (i < content.length && /\s/.test(content[i])) i += 1;
    if (content[i] !== '{') {
      // 표현식 바디(예: `(tx) => this.readConsistent(chatbotId, tx)`) — 블록이 아니므로 건너뛴다.
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

describe('챗봇 복원/버전 이력관리(No.25) 정적 검사 — version-history-설계.md §16.1', () => {
  const apiFiles = collectApiSourceFiles();
  const apiFileContents = apiFiles.map((f) => ({ f: f.replace(/\\/g, '/'), content: readFileSync(f, 'utf8') }));
  const versionFiles = apiFileContents.filter(({ f }) => f.includes('/src/versions/'));

  it('스캔 대상 파일이 존재한다(회귀 방지)', () => {
    expect(apiFiles.length).toBeGreaterThan(50);
    expect(versionFiles.length).toBeGreaterThan(5);
  });

  describe('V-1: 대화 자산 9테이블 쓰기 호출은 versions/** 안에서 applier 1파일에만 존재한다', () => {
    const writeCallPattern =
      /(?:prisma|tx)\.(intent|keyword|homonymDictionary|contextVariable|dialogNode|dialogNodeIntent|dialogNodeKeyword|faqEntry|chatbotAnswerSetting)\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(/;

    it.each(versionFiles.filter(({ content }) => writeCallPattern.test(content)).map(({ f }) => f))(
      '%s는 restore/version-restore.applier.ts여야 한다',
      (file) => {
        expect(file.endsWith('versions/restore/version-restore.applier.ts')).toBe(true);
      },
    );

    it('실제로 걸리는 파일이 정확히 1개다(가드)', () => {
      const offenders = versionFiles.filter(({ content }) => writeCallPattern.test(content)).map(({ f }) => f);
      expect(offenders).toEqual([expect.stringMatching(/versions\/restore\/version-restore\.applier\.ts$/)]);
    });
  });

  describe('V-2: `chatbot.update(`은 applier 1파일에만 존재한다', () => {
    const pattern = /(?:prisma|tx)\.chatbot\.update\(/;
    it('실제로 걸리는 파일이 정확히 1개다', () => {
      const offenders = versionFiles.filter(({ content }) => pattern.test(content)).map(({ f }) => f);
      expect(offenders).toEqual([expect.stringMatching(/versions\/restore\/version-restore\.applier\.ts$/)]);
    });
  });

  describe('V-3: versions/**에 범위 밖 테이블 쓰기 호출 0건 · intentClassifierModel은 applier의 deleteMany만', () => {
    const OUT_OF_SCOPE = [
      'augmentationSuggestion',
      'testCase',
      'testCaseSet',
      'testRun',
      'testRunResult',
      'trainingJob',
      'conversationLog',
      'unansweredQuestion',
      'ragCallLog',
      'embeddingVector',
      'channel',
      'bannedWord',
    ];
    const writeVerbs = '(create|createMany|update|updateMany|upsert|delete|deleteMany)';

    it.each(OUT_OF_SCOPE)('%s 쓰기 호출이 versions/**에 0건이다', (table) => {
      const pattern = new RegExp(`(?:prisma|tx)\\.${table}\\.${writeVerbs}\\(`);
      for (const { content } of versionFiles) {
        expect(nonCommentOccurrences(content, pattern)).toBe(0);
      }
    });

    it('intentClassifierModel 쓰기는 applier의 deleteMany 1건뿐이다', () => {
      const pattern = /(?:prisma|tx)\.intentClassifierModel\.(create|createMany|update|updateMany|upsert|delete)\(/;
      for (const { content } of versionFiles) {
        expect(nonCommentOccurrences(content, pattern)).toBe(0);
      }
      const deleteManyPattern = /(?:prisma|tx)\.intentClassifierModel\.deleteMany\(/;
      const offenders = versionFiles.filter(({ content }) => deleteManyPattern.test(content)).map(({ f }) => f);
      expect(offenders).toEqual([expect.stringMatching(/versions\/restore\/version-restore\.applier\.ts$/)]);
    });
  });

  describe('V-4: versions/**에 QueryEmbeddingService 참조 0건이다(AC-H3-15)', () => {
    it.each(versionFiles.map(({ f }) => f))('%s에 QueryEmbeddingService 심볼이 없다', (file) => {
      const content = versionFiles.find((x) => x.f === file)!.content;
      expect(nonCommentOccurrences(content, /\bQueryEmbeddingService\b/g)).toBe(0);
    });
  });

  describe('V-5: versions.module.ts · version-capture.module.ts는 자산/제안/검증/학습 모듈을 import하지 않는다', () => {
    const FORBIDDEN = [
      'IntentsModule',
      'KeywordsModule',
      'FaqsModule',
      'DialogNodesModule',
      'ContextsModule',
      'HomonymsModule',
      'AugmentationModule',
      'ValidationModule',
      'ConversationModule',
      'LearningModule',
      'ClassifierModule',
      'TrainingJobsModule',
    ];
    const targetFiles = versionFiles.filter(({ f }) => f.endsWith('versions.module.ts') || f.endsWith('capture/version-capture.module.ts'));

    it('대상 파일 2개가 존재한다', () => {
      expect(targetFiles).toHaveLength(2);
    });

    it.each(FORBIDDEN)('%s 심볼이 두 모듈 어디에도 없다', (symbol) => {
      for (const { content } of targetFiles) {
        expect(nonCommentOccurrences(content, new RegExp(`\\b${symbol}\\b`, 'g'))).toBe(0);
      }
    });
  });

  describe('V-6: version-capture.module.ts에 VersionRestore·RestoreApplier 심볼이 없다', () => {
    it('캡처 모듈 DI 그래프에 복원 쓰기 경로가 유입되지 않는다', () => {
      const file = versionFiles.find(({ f }) => f.endsWith('capture/version-capture.module.ts'));
      expect(file).toBeDefined();
      expect(nonCommentOccurrences(file!.content, /VersionRestore/g)).toBe(0);
      expect(nonCommentOccurrences(file!.content, /RestoreApplier/g)).toBe(0);
    });
  });

  describe('V-7: chatbotVersionPayload(Prisma 모델 접근자) 참조 파일은 허용 목록뿐이다(FR-H1-17, AC-H1-12)', () => {
    // `version-payload.reader.ts`는 `ChatbotVersion.payload`(관계 필드명)로만 접근해 리터럴
    // `chatbotVersionPayload` 토큰이 존재하지 않는다 — 그래도 본문 테이블에 접근하는 4곳 중
    // 하나이므로 별도로 존재를 확인한다(파일 자체는 있는지만 단언).
    const ALLOWED = ['versions/capture/version-capture.service.ts', 'versions/capture/version-retention.service.ts', 'chatbots/chatbots.service.ts'];

    it('리터럴 chatbotVersionPayload 참조 파일(.spec.ts 제외 — 목은 실제 쓰기 경로가 아니다)이 allowlist의 부분집합이다', () => {
      const offenders = apiFileContents
        .filter(({ f }) => !f.endsWith('.spec.ts'))
        .filter(({ content }) => nonCommentOccurrences(content, /\bchatbotVersionPayload\b/g) > 0)
        .map(({ f }) => f);
      for (const file of offenders) {
        expect(ALLOWED.some((allowed) => file.endsWith(allowed))).toBe(true);
      }
    });

    it('version-payload.reader.ts가 존재하고 payload 관계 필드로만 본문에 접근한다', () => {
      const file = apiFileContents.find(({ f }) => f.endsWith('versions/read/version-payload.reader.ts'));
      expect(file).toBeDefined();
    });

    it('version.service.ts는 chatbotVersionPayload를 참조하지 않는다(목록/상세는 payload를 읽지 않는다)', () => {
      const file = apiFileContents.find(({ f }) => f.endsWith('versions/version.service.ts'));
      expect(file).toBeDefined();
      expect(nonCommentOccurrences(file!.content, /\bchatbotVersionPayload\b/g)).toBe(0);
    });
  });

  describe('V-8: @Public() 핸들러 수는 정확히 6개다(FR-0-76)', () => {
    function collectAllApiControllerFiles(): string[] {
      const files: string[] = [];
      walk(join(REPO_ROOT, 'apps/api/src'), ['.controller.ts'], files);
      return files;
    }

    it('*.controller.ts 전체에서 @Public() 총개수가 변함없이 6개다(versions.controller.ts는 0건)', () => {
      const controllerFiles = collectAllApiControllerFiles();
      expect(controllerFiles.length).toBeGreaterThan(10);
      let total = 0;
      for (const file of controllerFiles) {
        total += nonCommentOccurrences(readFileSync(file, 'utf8'), /@Public\(\)/g);
      }
      expect(total).toBe(6);
    });

    it('versions.controller.ts에는 @Public()이 없다', () => {
      const file = versionFiles.find(({ f }) => f.endsWith('versions.controller.ts'));
      expect(file).toBeDefined();
      expect(nonCommentOccurrences(file!.content, /@Public\(\)/g)).toBe(0);
    });
  });

  describe('V-9: packages/dialogue-engine에 chatbotVersion 심볼이 0건이다(FR-0-68 엔진 불가침)', () => {
    const engineFiles = collectEngineSourceFiles();

    it('엔진 소스 파일이 존재한다', () => {
      expect(engineFiles.length).toBeGreaterThan(0);
    });

    it.each(engineFiles)('%s에 chatbotVersion(대소문자 무관) 심볼이 없다', (file) => {
      const content = readFileSync(file, 'utf8');
      expect(/chatbotversion/i.test(content)).toBe(false);
    });
  });

  describe('V-10: 인터랙티브 트랜잭션(tx) 콜백 안에서 Promise.all 병렬 발행 금지(§6.1, M-1 재발 방지)', () => {
    // tx는 단일 커넥션이다 — 병렬 발행은 "노드는 새 의도를 참조하는데 의도 목록은 옛것"인 비일관
    // 읽기를 만들 수 있다(FR-H1-6). code-review 1차 M-1: version-restore.service.ts의 트랜잭션
    // 콜백 안에서 trainingJob.count/testRun.count를 Promise.all로 병렬 발행하던 위반을 수정했다.
    it.each(versionFiles.map(({ f }) => f))('%s의 tx 콜백 본문에 Promise.all(이 없다', (file) => {
      const content = versionFiles.find((x) => x.f === file)!.content;
      const bodies = extractTxTransactionCallbackBodies(content);
      for (const body of bodies) {
        expect(body.includes('Promise.all(')).toBe(false);
      }
    });

    it('회귀 확인 — 헬퍼가 실제로 tx 콜백 안의 Promise.all을 검출한다(검사 자체가 무력화되지 않았음을 확인)', () => {
      const sample = `
        await this.prisma.$transaction(async (tx) => {
          const [a, b] = await Promise.all([tx.trainingJob.count({}), tx.testRun.count({})]);
        });
      `;
      const bodies = extractTxTransactionCallbackBodies(sample);
      expect(bodies).toHaveLength(1);
      expect(bodies[0].includes('Promise.all(')).toBe(true);
    });

    it('회귀 확인 — tx가 아닌 콜백 매개변수명(예: 일반 헬퍼)의 Promise.all은 대상이 아니다', () => {
      const sample = `
        const [a, b] = await Promise.all([this.prisma.chatbotVersion.count({}), this.prisma.auditLog.count({})]);
      `;
      const bodies = extractTxTransactionCallbackBodies(sample);
      expect(bodies).toHaveLength(0);
    });
  });
});
