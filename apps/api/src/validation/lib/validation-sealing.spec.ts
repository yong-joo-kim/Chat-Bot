import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * 검증/품질 고도화(No.19/20)의 구조적 봉인 정적 검사(ADR-0029/0030 §12) — `rag-allowlist.spec.ts`·
 * `asset-write-sealing.spec.ts`와 **같은 형식**(스캔 루트 지정·자기 자신 제외·스캔 대상 0건 아님을 먼저 단언).
 *
 * "실행이 운영 대화의 로그·캐시·자산·제안 테이블을 건드리지 않는다"를 **약속이 아니라 컴파일 불가/
 * grep 0건으로** 강제한다.
 */

const REPO_ROOT = resolve(__dirname, '../../../../..');
const SELF_ABSOLUTE = resolve(__dirname, 'validation-sealing.spec.ts');

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

function collectValidationFiles(): string[] {
  const files: string[] = [];
  walk(join(REPO_ROOT, 'apps/api/src/validation'), ['.ts'], files);
  return files.filter((f) => f !== SELF_ABSOLUTE);
}

function collectAllApiControllerFiles(): string[] {
  const files: string[] = [];
  walk(join(REPO_ROOT, 'apps/api/src'), ['.controller.ts'], files);
  return files;
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

describe('검증/품질 고도화 구조적 봉인 정적 검사 — ADR-0029/0030 §12', () => {
  const validationFiles = collectValidationFiles();
  const validationFileContents = validationFiles.map((f) => ({ f, content: readFileSync(f, 'utf8') }));

  it('스캔 대상 파일이 존재한다(회귀 방지 — 스캔 자체가 조용히 0건이 되는 것을 막는다)', () => {
    expect(validationFiles.length).toBeGreaterThan(10);
  });

  it('1) validation/**에 ConversationLogService 참조가 0건이다(FR-0-60, J-9)', () => {
    const offenders = validationFileContents
      .filter(({ content }) => nonCommentOccurrences(content, /\bConversationLogService\b/g) > 0)
      .map(({ f }) => f);
    expect(offenders).toEqual([]);
  });

  it('2) validation.module.ts의 imports에 금지 모듈 6종이 0건이다(ADR-0025 봉인 L1과 동일 방식)', () => {
    const moduleFile = validationFileContents.find(({ f }) => f.replace(/\\/g, '/').endsWith('validation/validation.module.ts'));
    expect(moduleFile).toBeDefined();
    const forbidden = ['IntentsModule', 'KeywordsModule', 'FaqsModule', 'DialogNodesModule', 'ConversationModule', 'AugmentationModule'];
    // 이름이 틀리면 이 검사는 항상 통과하는 빈 검사가 된다(실제로 'FaqModule' 오타로 그랬다) —
    // 금지 목록의 모든 이름이 apps/api/src에 실제로 선언된 모듈 클래스인지 먼저 단언한다.
    const apiSrcFiles: string[] = [];
    walk(resolve(REPO_ROOT, 'apps/api/src'), ['.module.ts'], apiSrcFiles);
    const declared = new Set(
      apiSrcFiles.flatMap((f) => [...readFileSync(f, 'utf-8').matchAll(/export class (\w+Module)/g)].map((m) => m[1])),
    );
    expect(forbidden.filter((name) => !declared.has(name))).toEqual([]);
    for (const name of forbidden) {
      expect(nonCommentOccurrences(moduleFile!.content, new RegExp(`\\b${name}\\b`, 'g'))).toBe(0);
    }
  });

  it('3) validation/**에 QueryEmbeddingService 참조가 0건이다(J-8, ADR-0030 §2 — 전역 캐시 오염 봉인)', () => {
    const offenders = validationFileContents
      .filter(({ content }) => nonCommentOccurrences(content, /\bQueryEmbeddingService\b/g) > 0)
      .map(({ f }) => f);
    expect(offenders).toEqual([]);
  });

  it('4) validation/**에 fetch(·axios 직접 호출이 0건이다(외부 출구는 여전히 3곳 — RagHttpClient/embedding provider 경유)', () => {
    const offenders = validationFileContents
      .filter(({ content }) => nonCommentOccurrences(content, /\bfetch\(/g) > 0 || nonCommentOccurrences(content, /\baxios\b/g) > 0)
      .map(({ f }) => f);
    expect(offenders).toEqual([]);
  });

  it('5) validation/**에 augmentationSuggestion 쓰기 호출(create|update|updateMany|delete|deleteMany|upsert)이 0건이다(NFR-VS3, 읽기 전용)', () => {
    const writePattern = /(?:prisma|tx)\.augmentationSuggestion\.(create|update|updateMany|delete|deleteMany|upsert)\(/;
    const offenders = validationFileContents.filter(({ content }) => writePattern.test(content)).map(({ f }) => f);
    expect(offenders).toEqual([]);
  });

  it('6) packages/dialogue-engine/**에 testCase·testRun 심볼이 0건이다(엔진 불가침, ADR-0029 §3)', () => {
    const engineFiles = collectEngineSourceFiles();
    expect(engineFiles.length).toBeGreaterThan(0);
    for (const file of engineFiles) {
      const content = readFileSync(file, 'utf8');
      expect(/testcase/i.test(content)).toBe(false);
      expect(/testrun/i.test(content)).toBe(false);
    }
  });

  it('7) @Public() 핸들러 수는 저장소 전체에서 정확히 6개다(변동 없음 — 이 그룹은 공개 경로를 하나도 추가하지 않는다, FR-0-66)', () => {
    const controllerFiles = collectAllApiControllerFiles();
    expect(controllerFiles.length).toBeGreaterThan(10);
    let total = 0;
    for (const file of controllerFiles) {
      const content = readFileSync(file, 'utf8');
      total += nonCommentOccurrences(content, /@Public\(\)/g);
    }
    expect(total).toBe(6);
  });
});
