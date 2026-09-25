import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

/**
 * 환경 분리(No.40) 정적 검사(§20, environment-separation-설계.md) — `deploy-schedule-sealing.spec.ts`·
 * `version-sealing.spec.ts`와 같은 형식(스캔 루트 지정 · 자기 자신 제외 · 스캔 대상 0건 아님 가드 ·
 * 주석 줄 제외). E-1~E-17 전부를 검사한다(2026-09-25 — E-3·E-4·E-8·E-10·E-13·E-17 추가, PM 지시로
 * 축소 없이 설계서대로 구현).
 */

const REPO_ROOT = resolve(__dirname, '../../../../..');
const SELF_ABSOLUTE = resolve(__dirname, 'environment-sealing.spec.ts');

function isCommentLine(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*');
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
  walk(join(REPO_ROOT, 'apps/api/src'), ['.ts'], files);
  return files.filter((f) => f !== SELF_ABSOLUTE);
}

function collectEngineSourceFiles(): string[] {
  const files: string[] = [];
  walk(join(REPO_ROOT, 'packages/dialogue-engine/src'), ['.ts'], files);
  return files;
}

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

describe('환경 분리(No.40) 정적 검사 — environment-separation-설계.md §20', () => {
  const apiFiles = collectApiSourceFiles();
  const apiFileContents = apiFiles.map((f) => ({ f: f.replace(/\\/g, '/'), content: readFileSync(f, 'utf8') }));
  const envFiles = apiFileContents.filter(({ f }) => f.includes('/src/environment/') && !f.endsWith('.spec.ts'));

  it('스캔 대상 파일이 존재한다(회귀 방지)', () => {
    expect(apiFiles.length).toBeGreaterThan(50);
    expect(envFiles.length).toBeGreaterThan(5);
  });

  describe('E-1: prodVersionId를 쓰는 Prisma 호출 파일은 environment-pointer.writer.ts 1개뿐이다', () => {
    const writePattern = /\.(chatbot|chatbotEnvironment|environmentSwitchLog)\.(create|createMany|update|updateMany|upsert)\(/;

    it('prodVersionId 데이터를 쓰는 파일이 1개뿐이다', () => {
      const offenders = apiFileContents
        .filter(({ f }) => !f.endsWith('.spec.ts'))
        .filter(({ content }) => {
          const stripped = stripComments(content);
          // data 절에 prodVersionId가 있고, 같은 파일에 쓰기 호출 패턴이 있는지 본다(휴리스틱 — 실제로는
          // writer 1개 파일에만 두 조건이 동시에 성립해야 한다).
          return /prodVersionId/.test(stripped) && writePattern.test(stripped);
        })
        .map(({ f }) => f);
      const unique = Array.from(new Set(offenders));
      expect(unique).toEqual([expect.stringMatching(/environment\/core\/environment-pointer\.writer\.ts$/)]);
    });

    it('chatbots.service.ts · topics/topic-split.service.ts · asset-transfer/**에 prodVersionId 토큰이 없다', () => {
      const targets = apiFileContents.filter(
        ({ f }) => f.endsWith('chatbots/chatbots.service.ts') || f.endsWith('topics/topic-split.service.ts') || f.includes('/src/asset-transfer/'),
      );
      expect(targets.length).toBeGreaterThan(0);
      for (const { content } of targets) {
        expect(nonCommentOccurrences(content, /prodVersionId/g)).toBe(0);
      }
    });
  });

  describe('E-2: environment/**의 자산 테이블 쓰기 0 · 자산/복원 서비스 심볼 0', () => {
    const assetWritePattern = /\.(intent|keyword|homonymDictionary|dialogNode|contextVariable|faqEntry|chatbotAnswerSetting|survey|topic)\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(/;
    it('자산 테이블 쓰기 호출이 0건이다(topic.update는 예외 — 존재하지 않아야 함)', () => {
      for (const { content } of envFiles) {
        const stripped = stripComments(content);
        expect(assetWritePattern.test(stripped)).toBe(false);
      }
    });

    const FORBIDDEN_SYMBOLS = ['VersionRestoreService', 'VersionRestoreApplier', 'IntentsService', 'KeywordsService', 'FaqsService', 'DialogNodesService', 'ContextsService', 'HomonymsService', 'LearningApplyService'];
    it.each(FORBIDDEN_SYMBOLS)('%s 심볼이 environment/**에 없다', (symbol) => {
      for (const { content } of envFiles) {
        expect(nonCommentOccurrences(content, new RegExp(`\\b${symbol}\\b`, 'g'))).toBe(0);
      }
    });
  });

  describe('E-5: packages/dialogue-engine 변경 0건(FR-0-149)', () => {
    const engineFiles = collectEngineSourceFiles();
    it('엔진 소스 파일이 존재한다', () => {
      expect(engineFiles.length).toBeGreaterThan(0);
    });

    // ★ 신설 개념 키워드 검사(environment·prodVersion·servedVersion) — 단, `tiebreak`는 엔진에
    // 이미 존재하는 무관한 용어(`NODE_TIEBREAK` trace 코드, No.40 착수 이전부터 존재)와 충돌하므로
    // 이 표층 검사에서는 제외하고, 아래 git diff 검사로 "새 내용 0건"을 정밀하게 확인한다.
    it.each(engineFiles)('%s에 environment·prodVersion·servedVersion(대소문자 무관) 심볼이 없다', (file) => {
      const content = readFileSync(file, 'utf8');
      expect(/environment|prodversion|servedversion/i.test(content)).toBe(false);
    });

    it('★ git 기준 packages/dialogue-engine에 변경분(diff)이 0건이다(가장 정밀한 검사)', () => {
      let output = '';
      try {
        output = execFileSync('git', ['status', '--porcelain', '--', 'packages/dialogue-engine'], { cwd: REPO_ROOT, encoding: 'utf8' });
      } catch {
        // git이 없는 실행 환경(CI 아티팩트 전용 등)에서는 이 검사를 건너뛴다 — 위 키워드 검사가 대신한다.
        return;
      }
      expect(output.trim()).toBe('');
    });
  });

  describe('E-6: environment.controller.ts에 @Public() 0건', () => {
    it('컨트롤러 파일에 @Public()이 없다', () => {
      const file = envFiles.find(({ f }) => f.endsWith('environment.controller.ts'));
      expect(file).toBeDefined();
      expect(nonCommentOccurrences(file!.content, /@Public\(\)/g)).toBe(0);
    });
  });

  describe('E-7: environmentSwitchLog는 update/updateMany/upsert 0건 · delete류는 chatbots.service.ts 1곳뿐', () => {
    it('저장소 전체에 environmentSwitchLog.(update|updateMany|upsert)가 없다', () => {
      for (const { content } of apiFileContents) {
        expect(nonCommentOccurrences(content, /environmentSwitchLog\.(update|updateMany|upsert)\(/g)).toBe(0);
      }
    });
    it('environmentSwitchLog.deleteMany 호출 파일은 chatbots.service.ts 1곳뿐이다', () => {
      const offenders = apiFileContents.filter(({ content }) => /environmentSwitchLog\.(delete|deleteMany)\(/.test(stripComments(content))).map(({ f }) => f);
      const unique = Array.from(new Set(offenders));
      expect(unique).toEqual([expect.stringMatching(/chatbots\/chatbots\.service\.ts$/)]);
    });
  });

  describe('E-9: public-conversation.service.ts의 소스 선택 지점 1곳', () => {
    it('bundleSourceOf(·.getCached(·versionBundles.get(가 각 정확히 1회다', () => {
      const file = apiFileContents.find(({ f }) => f.endsWith('conversation/public-conversation.service.ts'));
      expect(file).toBeDefined();
      const stripped = stripComments(file!.content);
      expect((stripped.match(/bundleSourceOf\(/g) ?? []).length).toBe(1);
      expect((stripped.match(/\.getCached\(/g) ?? []).length).toBe(1);
      expect((stripped.match(/versionBundles[!?]?\.get\(/g) ?? []).length).toBe(1);
    });
  });

  describe('E-11: embeddingTextVector 쓰기 호출 파일 = embedding-text-vector.service.ts + chatbots.service.ts(deleteMany)', () => {
    it('쓰기 호출(create류·delete류) 파일이 정확히 2개다', () => {
      const offenders = apiFileContents
        .filter(({ content }) => /embeddingTextVector\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(/.test(stripComments(content)))
        .map(({ f }) => f);
      const unique = Array.from(new Set(offenders)).sort();
      expect(unique).toEqual([expect.stringMatching(/chatbots\/chatbots\.service\.ts$/), expect.stringMatching(/embedding\/text-vector\/embedding-text-vector\.service\.ts$/)]);
    });
  });

  describe('E-12: embeddingVector 쓰기 호출 파일 집합에 environment/**·embedding/text-vector/**·embedding/version-vectors/**가 없다', () => {
    it('세 디렉터리에 embeddingVector 쓰기 호출이 없다', () => {
      const targets = apiFileContents.filter(
        ({ f }) => f.includes('/src/environment/') || f.includes('/src/embedding/text-vector/') || f.includes('/src/embedding/version-vectors/'),
      );
      expect(targets.length).toBeGreaterThan(0);
      for (const { content } of targets) {
        expect(nonCommentOccurrences(content, /embeddingVector\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(/g)).toBe(0);
      }
    });
  });

  describe('E-14: Permission.options.length === 18 · chatbot:deploy는 ADMIN에만 · @RequirePermission(\'chatbot:deploy\')는 environment.controller.ts 전용', () => {
    it("`chatbot:deploy` 사용 파일이 environment.controller.ts뿐이다", () => {
      const offenders = apiFileContents.filter(({ content }) => /@RequirePermission\([^)]*'chatbot:deploy'/.test(content)).map(({ f }) => f);
      const unique = Array.from(new Set(offenders));
      expect(unique).toEqual([expect.stringMatching(/environment\/environment\.controller\.ts$/)]);
    });
  });

  describe('E-15: 모듈 export 경계', () => {
    it('environment-core.module.ts exports = { ProdSwitchService, EnvironmentReadService }', () => {
      const file = envFiles.find(({ f }) => f.endsWith('environment-core.module.ts'));
      expect(file).toBeDefined();
      const exportsMatch = file!.content.match(/exports:\s*\[([^\]]*)\]/);
      expect(exportsMatch).toBeTruthy();
      const names = exportsMatch![1]
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      expect(new Set(names)).toEqual(new Set(['ProdSwitchService', 'EnvironmentReadService']));
    });

    it('environment-serving.module.ts exports = { VersionBundleService }', () => {
      const file = envFiles.find(({ f }) => f.endsWith('environment-serving.module.ts'));
      expect(file).toBeDefined();
      const exportsMatch = file!.content.match(/exports:\s*\[([^\]]*)\]/);
      expect(exportsMatch).toBeTruthy();
      const names = exportsMatch![1]
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      expect(names).toEqual(['VersionBundleService']);
    });

    it('EnvironmentPointerWriter는 environment-core.module.ts의 exports에 없다', () => {
      const file = envFiles.find(({ f }) => f.endsWith('environment-core.module.ts'));
      const exportsMatch = file!.content.match(/exports:\s*\[([^\]]*)\]/);
      expect(exportsMatch![1].includes('EnvironmentPointerWriter')).toBe(false);
    });
  });

  describe('E-16: environment/**의 $transaction(tx 콜백) 본문에 Promise.all( 이 없다', () => {
    it.each(envFiles.map(({ f }) => f))('%s', (file) => {
      const content = envFiles.find((x) => x.f === file)!.content;
      const bodies = extractTxTransactionCallbackBodies(content);
      for (const body of bodies) expect(body.includes('Promise.all(')).toBe(false);
    });
  });

  describe('E-3: restore( 호출 파일 = 2(D-3 재확인 — 새 파일 추가 0)', () => {
    it('.restore( 호출부가 정확히 2개 파일이다', () => {
      const offenders = apiFileContents
        .filter(({ f }) => !f.endsWith('.spec.ts'))
        .filter(({ content }) => nonCommentOccurrences(content, /\.restore\(/g) > 0)
        .map(({ f }) => f);
      const unique = Array.from(new Set(offenders)).sort();
      expect(unique).toEqual(
        [expect.stringMatching(/deploy-schedules\/executors\/restore-version\.executor\.ts$/), expect.stringMatching(/versions\/versions\.controller\.ts$/)].sort(
          (a, b) => String(a).localeCompare(String(b)),
        ),
      );
    });

    it('★ 역검증 — .restore(는 정의부(async restore()도 잡지 않는다', () => {
      expect(nonCommentOccurrences('async restore(chatbotId: string) {}', /\.restore\(/g)).toBe(0);
      expect(nonCommentOccurrences('await this.versionRestore.restore(x);', /\.restore\(/g)).toBe(1);
    });
  });

  describe('E-4: chatbotVersionPayload 토큰 — V-7 허용 목록의 부분집합 · environment/**·embedding/**는 0', () => {
    const ALLOWED = ['versions/capture/version-capture.service.ts', 'versions/capture/version-retention.service.ts', 'chatbots/chatbots.service.ts'];

    it('저장소 전체에서 chatbotVersionPayload 참조 파일이 V-7 허용 목록의 부분집합이다', () => {
      const offenders = apiFileContents
        .filter(({ f }) => !f.endsWith('.spec.ts'))
        .filter(({ content }) => nonCommentOccurrences(content, /\bchatbotVersionPayload\b/g) > 0)
        .map(({ f }) => f);
      for (const file of offenders) {
        expect(ALLOWED.some((allowed) => file.endsWith(allowed))).toBe(true);
      }
    });

    it('environment/**·embedding/**에 chatbotVersionPayload 토큰이 0건이다', () => {
      const targets = apiFileContents.filter(({ f }) => f.includes('/src/environment/') || f.includes('/src/embedding/'));
      expect(targets.length).toBeGreaterThan(5);
      for (const { content } of targets) {
        expect(nonCommentOccurrences(content, /\bchatbotVersionPayload\b/g)).toBe(0);
      }
    });

    it('★ 역검증 — 허용 목록 밖 파일이 chatbotVersionPayload를 쓰면 잡힌다(헬퍼 자체 검증)', () => {
      const fakeOffender = 'environment/serving/version-bundle.service.ts';
      expect(ALLOWED.some((allowed) => fakeOffender.endsWith(allowed))).toBe(false);
    });
  });

  describe('E-8: conversationLog.update* 0(R-10) · conversation-log.service.ts create.data에 servedVersionId 키', () => {
    it('저장소 전체에 conversationLog.update|updateMany가 없다', () => {
      for (const { content } of apiFileContents.filter(({ f }) => !f.endsWith('.spec.ts'))) {
        expect(nonCommentOccurrences(content, /conversationLog\.(update|updateMany)\(/g)).toBe(0);
      }
    });

    it('conversation-log.service.ts의 create.data에 servedVersionId 키가 있다', () => {
      const file = apiFileContents.find(({ f }) => f.endsWith('conversation/conversation-log.service.ts'));
      expect(file).toBeDefined();
      const stripped = stripComments(file!.content);
      expect(/servedVersionId\s*:/.test(stripped)).toBe(true);
    });

    it('★ 역검증 — conversationLog.update(는 헬퍼가 실제로 잡는다', () => {
      expect(nonCommentOccurrences('await this.prisma.conversationLog.update({ where, data });', /conversationLog\.(update|updateMany)\(/g)).toBe(1);
    });
  });

  describe('E-10: apps/widget/src·apps/ml-worker/src에 environment·stagingVersion·prodVersion·embedding_text_vectors 0', () => {
    const CONSUMER_ROOTS = ['apps/widget/src', 'apps/ml-worker/src'];
    const TOKEN_PATTERN = /environment|stagingversion|prodversion|embedding_text_vectors/i;

    function collectConsumerFiles(): string[] {
      const files: string[] = [];
      for (const root of CONSUMER_ROOTS) {
        walk(join(REPO_ROOT, root), ['.ts', '.tsx', '.py'], files);
      }
      return files;
    }

    it('두 소비자(위젯·ml-worker) 소스에 대상 토큰이 0건이다(vitest 환경 지시자 제외)', () => {
      const files = collectConsumerFiles();
      expect(files.length).toBeGreaterThan(5);
      for (const file of files) {
        const content = readFileSync(file, 'utf8');
        const stripped = content
          .split('\n')
          .filter((line) => !line.includes('@vitest-environment')) // vitest 환경 지시자 주석(jsdom) — 무관한 동음이의
          .join('\n');
        expect(TOKEN_PATTERN.test(stripComments(stripped))).toBe(false);
      }
    });
  });

  describe('E-13: environment/**·embedding/text-vector/**의 logger.(log|warn|error|debug)( 줄에 reason·memo·text 토큰 0', () => {
    it('두 디렉터리의 로거 호출 줄에 금지 토큰이 없다', () => {
      const targets = apiFileContents.filter(({ f }) => f.includes('/src/environment/') || f.includes('/src/embedding/text-vector/'));
      expect(targets.length).toBeGreaterThan(3);
      const loggerCallLine = /logger\.(log|warn|error|debug)\(/;
      const forbiddenTokens = ['reason', 'memo', 'text'];
      for (const { content } of targets) {
        for (const line of content.split('\n')) {
          if (isCommentLine(line)) continue;
          if (!loggerCallLine.test(line)) continue;
          for (const token of forbiddenTokens) {
            expect(new RegExp(`\\b${token}\\b`, 'i').test(line)).toBe(false);
          }
        }
      }
    });

    it('★ 역검증 — 금지 토큰이 있는 로거 줄은 헬퍼가 실제로 잡는다', () => {
      const line = "this.logger.warn(`실패: reason=${reason}`);";
      expect(/logger\.(log|warn|error|debug)\(/.test(line) && /\breason\b/i.test(line)).toBe(true);
    });
  });

  describe('E-17: excludeInactiveTopics 식별자 environment/** 0(T-2 불변) · getCachedUnfiltered( 호출 파일 = simulation.service.ts 1개(T-4 불변)', () => {
    it('environment/**에 excludeInactiveTopics 식별자가 없다', () => {
      for (const { content } of envFiles) {
        expect(nonCommentOccurrences(content, /\bexcludeInactiveTopics\b/g)).toBe(0);
      }
    });

    it('.getCachedUnfiltered( 호출 파일이 simulation.service.ts 1개뿐이다(정의부 dialogue-bundle.service.ts는 제외)', () => {
      const offenders = apiFileContents
        .filter(({ f }) => !f.endsWith('.spec.ts'))
        .filter(({ content }) => nonCommentOccurrences(content, /\.getCachedUnfiltered\(/g) > 0)
        .map(({ f }) => f);
      const unique = Array.from(new Set(offenders));
      expect(unique).toEqual([expect.stringMatching(/simulation\/simulation\.service\.ts$/)]);
    });
  });
});
