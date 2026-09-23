import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * "제안 ≠ 자산" 구조적 봉인의 정적 검사(ADR-0025 §5·§13, AC-L4-3) — `rag-allowlist.spec.ts`와
 * **같은 형식**(스캔 루트 지정 · 자기 자신 제외 · 스캔 대상이 0건이 아님을 먼저 단언).
 *
 * "승인 없이 대화 자산을 바꾸는 코드 경로를 만들지 않는다"는 **약속이 아니라 구조**로 강제한다 —
 * 이 스펙이 실패하면 CI가 즉시 잡는다(ADR-0022의 봉인 패턴 두 번째 적용).
 */

const REPO_ROOT = resolve(__dirname, '../../../../..');
const SELF_ABSOLUTE = resolve(__dirname, 'asset-write-sealing.spec.ts');

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

describe('제안 ≠ 자산 구조적 봉인 정적 검사 — ADR-0025 §13, AC-L4-3', () => {
  const apiFiles = collectApiSourceFiles();
  const apiFileContents = apiFiles.map((f) => ({ f, content: readFileSync(f, 'utf8') }));

  it('스캔 대상 파일이 존재한다(회귀 방지 — 스캔 자체가 조용히 0건이 되는 것을 막는다)', () => {
    expect(apiFiles.length).toBeGreaterThan(50);
  });

  describe('S-1: Intent/Keyword 자산 쓰기 Prisma 호출은 소유 서비스 파일 밖에서 0건이다', () => {
    // `upsert`도 쓰기 호출이며, 트랜잭션 콜백 변수(관례상 `tx`) 경유 호출도 리터럴 `prisma.` 앞부분만
    // 보면 놓친다 — 두 우회 모두 잡도록 `prisma`/`tx` 두 접두사와 `upsert`를 포함한다.
    const writeCallPattern = /(?:prisma|tx)\.(intent|keyword)\.(create|update|updateMany|upsert)\(/;

    // [신규 2026-09-23 No.25] 복원 applier(`versions/restore/version-restore.applier.ts`)가 3번째 허용
    // 파일로 추가된다(ADR-0025 갱신 각주, version-history-설계.md §16.2). 복원은 "새 편집"이 아니라
    // 관리자 요청 핸들러 1곳의 **과거 상태 재현**이며, 본문을 만드는 경로가 실제 DB 자산의 캡처뿐이라
    // "승인 없는 자산 주입" 경로가 아니다.
    it.each(apiFileContents.filter(({ content }) => writeCallPattern.test(content)).map(({ f }) => f))(
      '%s는 intents.service.ts · keywords.service.ts · versions/restore/version-restore.applier.ts 중 하나여야 한다',
      (file) => {
        const normalized = file.replace(/\\/g, '/');
        expect(
          normalized.endsWith('intents/intents.service.ts') ||
            normalized.endsWith('keywords/keywords.service.ts') ||
            normalized.endsWith('versions/restore/version-restore.applier.ts'),
        ).toBe(true);
      },
    );

    it('실제로 걸리는 파일이 정확히 3개(intents.service.ts, keywords.service.ts, version-restore.applier.ts)다(가드 — 검사 자체가 무력화되지 않았음을 확인)', () => {
      const offenders = apiFileContents.filter(({ content }) => writeCallPattern.test(content)).map(({ f }) => f.replace(/\\/g, '/'));
      expect(offenders.filter((f) => f.endsWith('intents/intents.service.ts'))).toHaveLength(1);
      expect(offenders.filter((f) => f.endsWith('keywords/keywords.service.ts'))).toHaveLength(1);
      expect(offenders.filter((f) => f.endsWith('versions/restore/version-restore.applier.ts'))).toHaveLength(1);
    });

    it('회귀: upsert 호출과 tx 트랜잭션 변수 경유 호출도 실제로 검출된다(정규식 우회 방지 확인)', () => {
      // 이 검사가 실제로 잡아내는지 확인하기 위한 임시 문자열 조각 — 실제 소스에 존재하는 코드가 아니다.
      const upsertBypass = 'this.prisma.intent.upsert({ where: { id }, create: {}, update: {} });';
      const txBypass = 'await this.prisma.$transaction(async (tx) => { await tx.keyword.update({ where: { id }, data: {} }); });';
      const oldPattern = /prisma\.(intent|keyword)\.(create|update|updateMany)\(/;

      // 구멍이 있던 이전 정규식(prisma. 접두사만 인식 + upsert 미포함)은 두 우회를 모두 놓친다.
      expect(oldPattern.test(upsertBypass)).toBe(false); // upsert(는 create/update/updateMany 중 어느 것도 아니라 매치되지 않는다.
      expect(oldPattern.test(txBypass)).toBe(false); // tx.keyword.update(는 리터럴 prisma. 접두사가 아니라 매치되지 않는다.

      // 새 정규식은 둘 다 잡는다.
      expect(writeCallPattern.test(upsertBypass)).toBe(true);
      expect(writeCallPattern.test(txBypass)).toBe(true);
    });
  });

  describe('S-2: applyLearningExample() 호출부는 allowlist 3곳뿐이다', () => {
    const ALLOWLIST = [
      'learning/unanswered-questions.service.ts',
      'augmentation/augmentation-accept.service.ts',
      'learning/decomposed-resolve.service.ts',
    ];

    it('호출 파일이 정확히 3곳이며 전부 allowlist에 있다', () => {
      const offenders = apiFileContents
        .filter(({ content }) => nonCommentOccurrences(content, /\.applyLearningExample\(/g) > 0)
        .map(({ f }) => f.replace(/\\/g, '/'));

      expect(offenders).toHaveLength(3);
      for (const file of offenders) {
        expect(ALLOWLIST.some((allowed) => file.endsWith(allowed))).toBe(true);
      }
    });

    it('정의 파일(intents.service.ts) 자신은 카운트에서 제외된다(정의부는 호출부가 아니다)', () => {
      const intentsServiceFile = apiFileContents.find(({ f }) => f.replace(/\\/g, '/').endsWith('intents/intents.service.ts'));
      expect(intentsServiceFile).toBeDefined();
      // `async applyLearningExample(` 정의 1건은 `.applyLearningExample(`(점 프리픽스) 패턴과 일치하지 않는다.
      expect(nonCommentOccurrences(intentsServiceFile!.content, /\.applyLearningExample\(/g)).toBe(0);
    });
  });

  describe('S-3: training-jobs/**·*job.runner.ts 파일에 IntentsService·KeywordsService 심볼이 0건이다', () => {
    const targetFiles = apiFileContents.filter(({ f }) => {
      const normalized = f.replace(/\\/g, '/');
      return normalized.includes('/training-jobs/') || normalized.endsWith('job.runner.ts');
    });

    it('스캔 대상(Job 실행기 계열) 파일이 존재한다', () => {
      expect(targetFiles.length).toBeGreaterThan(0);
    });

    it.each(targetFiles.map(({ f }) => f))('%s에 IntentsService·KeywordsService 심볼이 없다(주석 제외 — 이 규약을 설명하는 주석 자체에 그 이름이 등장하므로)', (file) => {
      const content = apiFileContents.find((x) => x.f === file)!.content;
      expect(nonCommentOccurrences(content, /\bIntentsService\b/g)).toBe(0);
      expect(nonCommentOccurrences(content, /\bKeywordsService\b/g)).toBe(0);
    });
  });

  describe('S-4: 모듈 그래프 — IntentsModule import는 augmentation.module.ts 1곳뿐이고 training-jobs.module.ts에는 없다', () => {
    it('training-jobs.module.ts는 IntentsModule·KeywordsModule·LearningModule을 import하지 않는다(주석 제외 — 이 규약을 설명하는 주석 자체에 그 이름이 등장하므로)', () => {
      const file = apiFileContents.find(({ f }) => f.replace(/\\/g, '/').endsWith('training-jobs/training-jobs.module.ts'));
      expect(file).toBeDefined();
      expect(nonCommentOccurrences(file!.content, /\bIntentsModule\b/g)).toBe(0);
      expect(nonCommentOccurrences(file!.content, /\bKeywordsModule\b/g)).toBe(0);
      expect(nonCommentOccurrences(file!.content, /\bLearningModule\b/g)).toBe(0);
    });

    it('classifier.module.ts는 IntentsModule·KeywordsModule을 import하지 않는다(§9.2 — classifier는 intents/keywords 서비스를 주입하지 않는다)', () => {
      const file = apiFileContents.find(({ f }) => f.replace(/\\/g, '/').endsWith('classifier/classifier.module.ts'));
      expect(file).toBeDefined();
      expect(nonCommentOccurrences(file!.content, /\bIntentsModule\b/g)).toBe(0);
      expect(nonCommentOccurrences(file!.content, /\bKeywordsModule\b/g)).toBe(0);
    });

    it('*.module.ts 중 IntentsModule을 import하는 파일은 augmentation.module.ts와 intents/keywords/learning 소유 모듈뿐이다', () => {
      const moduleFiles = apiFileContents.filter(({ f }) => f.endsWith('.module.ts'));
      const importingIntentsModule = moduleFiles
        .filter(({ content }) => /import\s*\{[^}]*\bIntentsModule\b[^}]*\}\s*from/.test(content))
        .map(({ f }) => f.replace(/\\/g, '/'));

      // 대화 설계 그룹(intents 자신 제외)·학습 그룹(learning)은 기존에도 IntentsModule을 쓴다.
      // 학습 고도화 그룹에서 "새로" 추가된 위치가 augmentation.module.ts 1곳임을 확인한다.
      const newGroupImporters = importingIntentsModule.filter(
        (f) => f.includes('/augmentation/') || f.includes('/classifier/') || f.includes('/training-jobs/'),
      );
      expect(newGroupImporters).toEqual([expect.stringMatching(/augmentation\/augmentation\.module\.ts$/)]);
    });
  });

  describe('S-5: 스케줄러 심볼이 augmentation/**·classifier/**에 없다(setInterval·cron — 자동 승격 배치 방지)', () => {
    const targetFiles = apiFileContents.filter(({ f }) => {
      const normalized = f.replace(/\\/g, '/');
      return normalized.includes('/augmentation/') || normalized.includes('/classifier/');
    });

    it('스캔 대상 파일이 존재한다', () => {
      expect(targetFiles.length).toBeGreaterThan(5);
    });

    it.each(targetFiles.map(({ f }) => f))('%s에 setInterval(·cron 심볼이 없다', (file) => {
      const content = apiFileContents.find((x) => x.f === file)!.content;
      expect(content.includes('setInterval(')).toBe(false);
      expect(/\bcron\b/i.test(content)).toBe(false);
    });
  });

  describe('S-6: packages/dialogue-engine에 classifier·augmentation 심볼이 0건이다(AC-L4-2, 엔진 불가침)', () => {
    const engineFiles = collectEngineSourceFiles();

    it('엔진 소스 파일이 존재한다', () => {
      expect(engineFiles.length).toBeGreaterThan(0);
    });

    it.each(engineFiles)('%s에 classifier·augmentation(대소문자 무관) 심볼이 없다', (file) => {
      const content = readFileSync(file, 'utf8');
      expect(/classifier/i.test(content)).toBe(false);
      expect(/augmentation/i.test(content)).toBe(false);
    });
  });
});
