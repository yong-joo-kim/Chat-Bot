import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * 운영 예약 배포(No.28) 정적 검사(§16.1, scheduled-deploy-설계.md) — `version-sealing.spec.ts`와
 * 같은 형식(스캔 루트 지정 · 자기 자신 제외 · 스캔 대상 0건 아님 가드 · 주석 줄 제외).
 *
 * ⚠ D-10 범위에 대한 구현자 주석: 설계서 원문은 "동작 리터럴 분기는 registry·required-permissions·
 * result-summary 밖에 0건"이라고 적었으나, 배열 필터링(`activeRows.filter(r => r.action === 'X')`)·
 * 표시용 판별(매퍼의 필드 평탄화)·경고 계산(readiness, 비차단·정보성)까지 전부 포함하면 실질적으로
 * 정상 동작하는 코드를 작성할 수 없다(예: chain-rules.ts의 R6/R7 자체가 동작별 필터다). 이 검사는
 * **switch/case 스타일의 실행 디스패치 재구현**(D-10의 실제 우려사항 — 레지스트리를 두고도 각처에서
 * `case 'RESTORE_VERSION': ...` 분기로 실행기를 재구현하는 것)만 금지한다. 단순 비교·필터는 대상이
 * 아니다. 이 범위 좁힘은 system-architect 재확인이 필요한 항목으로 인수인계 문서에 기록한다.
 */

const REPO_ROOT = resolve(__dirname, '../../../../..');
const SELF_ABSOLUTE = resolve(__dirname, 'deploy-schedule-sealing.spec.ts');

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

describe('운영 예약 배포(No.28) 정적 검사 — scheduled-deploy-설계.md §16.1', () => {
  const apiFiles = collectApiSourceFiles();
  const apiFileContents = apiFiles.map((f) => ({ f: f.replace(/\\/g, '/'), content: readFileSync(f, 'utf8') }));
  const dsFiles = apiFileContents.filter(({ f }) => f.includes('/src/deploy-schedules/') && !f.endsWith('.spec.ts'));
  const pollingFiles = apiFileContents.filter(({ f }) => f.includes('/src/common/polling/') && !f.endsWith('.spec.ts'));

  it('스캔 대상 파일이 존재한다(회귀 방지)', () => {
    expect(apiFiles.length).toBeGreaterThan(50);
    expect(dsFiles.length).toBeGreaterThan(10);
    expect(pollingFiles.length).toBeGreaterThan(1);
  });

  describe('D-1: deploy-schedules/**의 prisma.deploySchedule 쓰기 호출은 2파일뿐이다', () => {
    const pattern = /(?:prisma|tx)\.(\w+)\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(/g;

    it('deploySchedule 이외 모델 쓰기 호출이 0건이다', () => {
      for (const { content } of dsFiles) {
        const matches = [...content.matchAll(pattern)].filter((m) => !isCommentLine(m[0]));
        for (const m of matches) {
          expect(m[1]).toBe('deploySchedule');
        }
      }
    });

    it('deploySchedule 쓰기 호출 파일은 정확히 2개다', () => {
      const offenders = dsFiles.filter(({ content }) => /(?:prisma|tx)\.deploySchedule\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(/.test(content)).map(({ f }) => f);
      const unique = Array.from(new Set(offenders)).sort();
      expect(unique).toEqual([
        expect.stringMatching(/deploy-schedules\/deploy-schedule\.service\.ts$/),
        expect.stringMatching(/deploy-schedules\/engine\/deploy-schedule\.repository\.ts$/),
      ]);
    });
  });

  describe('D-2: 자산·상태·채널 서비스/모듈 봉인', () => {
    const FORBIDDEN_SYMBOLS = [
      'VersionRestoreApplier',
      'RestoreApplier',
      'IntentsService',
      'KeywordsService',
      'FaqsService',
      'DialogNodesService',
      'ContextsService',
      'HomonymsService',
      'AugmentationAcceptService',
      'LearningApplyService',
      'ChatbotsService',
      'ChannelsService',
    ];
    it.each(FORBIDDEN_SYMBOLS)('%s 심볼이 deploy-schedules/**에 없다', (symbol) => {
      for (const { content } of dsFiles) {
        expect(nonCommentOccurrences(content, new RegExp(`\\b${symbol}\\b`, 'g'))).toBe(0);
      }
    });

    const FORBIDDEN_MODULES = [
      'IntentsModule',
      'KeywordsModule',
      'FaqsModule',
      'DialogNodesModule',
      'ContextsModule',
      'HomonymsModule',
      'AnswerSettingsModule',
      'AugmentationModule',
      'LearningModule',
      'ClassifierModule',
      'TrainingJobsModule',
      'ConversationModule',
    ];
    it.each(FORBIDDEN_MODULES)('%s를 deploy-schedules.module.ts가 import하지 않는다', (mod) => {
      const file = dsFiles.find(({ f }) => f.endsWith('deploy-schedules.module.ts'));
      expect(file).toBeDefined();
      expect(nonCommentOccurrences(file!.content, new RegExp(`\\b${mod}\\b`, 'g'))).toBe(0);
    });
  });

  describe('D-3: versionRestore(Service)?.restore( 호출 파일은 정확히 2개다(J-11)', () => {
    it('저장소 전체에서 정확히 2개', () => {
      const pattern = /(restoreService|versionRestore)\.restore\(/;
      const offenders = apiFileContents.filter(({ f }) => !f.endsWith('.spec.ts')).filter(({ content }) => pattern.test(content)).map(({ f }) => f);
      const unique = Array.from(new Set(offenders)).sort();
      expect(unique).toEqual([
        expect.stringMatching(/deploy-schedules\/executors\/restore-version\.executor\.ts$/),
        expect.stringMatching(/versions\/versions\.controller\.ts$/),
      ]);
    });
  });

  describe('D-4: 아웃바운드 HTTP 신규 0건(FR-0-86)', () => {
    const patterns = [/\bfetch\(/, /\baxios\b/, /\bhttp\.request\(/, /\bhttps\.request\(/, /\bnodemailer\b/, /\bWebSocket\b/];
    it.each(patterns.map((p) => p.source))('%s가 deploy-schedules/**·common/polling/**에 없다', (src) => {
      const pattern = new RegExp(src);
      for (const { content } of [...dsFiles, ...pollingFiles]) {
        expect(nonCommentOccurrences(content, new RegExp(pattern.source, 'g'))).toBe(0);
      }
    });
  });

  describe('D-5: @Public() 총수 8(No.44 답변 평가 7→8) · deploy-schedules 컨트롤러 0건', () => {
    function collectAllApiControllerFiles(): string[] {
      const files: string[] = [];
      walk(join(REPO_ROOT, 'apps/api/src'), ['.controller.ts'], files);
      return files;
    }
    it('전체 @Public() 총개수가 8개다', () => {
      const controllerFiles = collectAllApiControllerFiles();
      let total = 0;
      for (const file of controllerFiles) total += nonCommentOccurrences(readFileSync(file, 'utf8'), /@Public\(\)/g);
      expect(total).toBe(8);
    });
    it('deploy-schedules 컨트롤러 2개에는 @Public()이 없다', () => {
      const files = dsFiles.filter(({ f }) => f.endsWith('.controller.ts'));
      expect(files.length).toBe(2);
      for (const { content } of files) expect(nonCommentOccurrences(content, /@Public\(\)/g)).toBe(0);
    });
  });

  describe('D-6: 예약별 타이머 금지 — setTimeout/setInterval은 polling-loop.ts 1곳뿐', () => {
    it('deploy-schedules/**에 setTimeout(·setInterval(이 없다', () => {
      for (const { content } of dsFiles) {
        expect(nonCommentOccurrences(content, /setTimeout\(/g)).toBe(0);
        expect(nonCommentOccurrences(content, /setInterval\(/g)).toBe(0);
      }
    });
    it('common/polling/**에서 setTimeout(·setInterval(은 polling-loop.ts에만 있다', () => {
      const offenders = pollingFiles.filter(({ content }) => /setTimeout\(|setInterval\(/.test(content)).map(({ f }) => f);
      const unique = Array.from(new Set(offenders));
      expect(unique).toEqual([expect.stringMatching(/common\/polling\/polling-loop\.ts$/)]);
    });
  });

  describe('D-7: @nestjs/schedule·cron·node-cron 의존 0건(J-3)', () => {
    it('apps/api/package.json에 없다', () => {
      const pkg = readFileSync(join(REPO_ROOT, 'apps/api/package.json'), 'utf8');
      expect(pkg.includes('@nestjs/schedule')).toBe(false);
      expect(/"node-cron"|"cron"/.test(pkg)).toBe(false);
    });
    it('apps/api/src/**에 import 0건이다', () => {
      for (const { content } of apiFileContents) {
        expect(nonCommentOccurrences(content, /@nestjs\/schedule/g)).toBe(0);
        expect(nonCommentOccurrences(content, /from 'node-cron'/g)).toBe(0);
      }
    });
  });

  describe('D-8: deploy-schedules/**에 원시 SQL 0건(NFR-DM5)', () => {
    it.each(['\\$queryRaw', '\\$executeRaw', '\\$queryRawUnsafe', '\\$executeRawUnsafe'])('%s가 없다', (token) => {
      for (const { content } of dsFiles) {
        expect(nonCommentOccurrences(content, new RegExp(token, 'g'))).toBe(0);
      }
    });
  });

  describe('D-9: packages/dialogue-engine에 deploySchedule 심볼 0건(FR-0-78)', () => {
    const engineFiles = collectEngineSourceFiles();
    it('엔진 소스 파일이 존재한다', () => {
      expect(engineFiles.length).toBeGreaterThan(0);
    });
    it.each(engineFiles)('%s에 deploySchedule(대소문자 무관) 심볼이 없다', (file) => {
      const content = readFileSync(file, 'utf8');
      expect(/deployschedule/i.test(content)).toBe(false);
    });
  });

  describe('D-10: switch/case 스타일 동작 디스패치는 허용 파일 3개뿐이다(§16 D-10 — 범위는 파일 상단 주석 참고)', () => {
    const ALLOWED = ['deploy-schedules/executors/executor.registry.ts', 'deploy-schedules/lib/required-permissions.ts', 'deploy-schedules/lib/result-summary.ts'];
    const pattern = /case\s+'(RESTORE_VERSION|PUBLISH|SET_WEB_CHANNEL)'\s*:/;
    it('switch/case 리터럴 분기가 허용 파일 밖에 없다', () => {
      const offenders = dsFiles.filter(({ content }) => pattern.test(content)).map(({ f }) => f);
      for (const file of offenders) {
        expect(ALLOWED.some((allowed) => file.endsWith(allowed))).toBe(true);
      }
    });
  });

  describe('D-11: common/polling/**는 도메인 무관이다(NFR-DM3)', () => {
    it.each(['deploySchedule', 'DeploySchedule', 'PrismaService'])('%s 심볼이 없다', (symbol) => {
      for (const { content } of pollingFiles) {
        expect(nonCommentOccurrences(content, new RegExp(`\\b${symbol}\\b`, 'g'))).toBe(0);
      }
    });
  });

  describe('D-12: 시계 직접 호출 금지(NFR-DM4)', () => {
    it('deploy-schedules/**에 Date.now(이 없다', () => {
      for (const { content } of dsFiles) expect(nonCommentOccurrences(content, /Date\.now\(/g)).toBe(0);
    });
    it('deploy-schedules/**에 인자 없는 new Date()가 없다(매퍼의 DB 값 변환은 인자를 받으므로 대상 아님)', () => {
      for (const { content } of dsFiles) expect(nonCommentOccurrences(content, /new Date\(\)/g)).toBe(0);
    });
  });

  describe('D-13: 로그에 memo 토큰 금지(FR-0-87)', () => {
    it('logger.(log|warn|error|debug)( 호출 인자에 memo 토큰이 없다', () => {
      const loggerCallPattern = /logger\.(log|warn|error|debug)\(([^;]*)\)/gs;
      for (const { content } of dsFiles) {
        const stripped = stripComments(content);
        for (const m of stripped.matchAll(loggerCallPattern)) {
          expect(/\bmemo\b/.test(m[2])).toBe(false);
        }
      }
    });
  });

  describe('D-14: tx 콜백 안 Promise.all 금지(단일 커넥션 규약)', () => {
    it.each(dsFiles.map(({ f }) => f))('%s의 tx 콜백 본문에 Promise.all(이 없다', (file) => {
      const content = dsFiles.find((x) => x.f === file)!.content;
      const bodies = extractTxTransactionCallbackBodies(content);
      for (const body of bodies) expect(body.includes('Promise.all(')).toBe(false);
    });
  });

  describe('D-15: versions.module.ts exports에 VersionRestoreApplier 0건', () => {
    it('exports 절에 없다', () => {
      const file = apiFileContents.find(({ f }) => f.endsWith('versions/versions.module.ts'));
      expect(file).toBeDefined();
      const exportsMatch = file!.content.match(/exports:\s*\[([^\]]*)\]/);
      expect(exportsMatch).toBeTruthy();
      expect(exportsMatch![1].includes('VersionRestoreApplier')).toBe(false);
    });
  });

  describe('D-16: TestRunService 참조는 post-run-test.starter.ts 1개뿐이다(§11)', () => {
    it('deploy-schedules/** 안에서 정확히 1개 파일(주석 속 언급은 제외)', () => {
      const offenders = dsFiles.filter(({ content }) => nonCommentOccurrences(content, /\bTestRunService\b/g) > 0).map(({ f }) => f);
      const unique = Array.from(new Set(offenders));
      expect(unique).toEqual([expect.stringMatching(/deploy-schedules\/post-run\/post-run-test\.starter\.ts$/)]);
    });
  });
});
