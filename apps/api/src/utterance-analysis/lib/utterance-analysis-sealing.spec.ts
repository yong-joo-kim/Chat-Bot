import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Permission } from '@chat-bot/shared-types';
import { EGRESS_REGISTRY } from '../../common/egress/egress-registry';

/**
 * 발화 묶음 분석(No.21) 정적 검사 — `docs/02-spec/deep-clustering-설계.md` §20.4 UA-1~UA-11. 기존
 * `governance-sealing.spec.ts`·`validation-sealing.spec.ts`와 같은 형식(스캔 루트 지정 · 자기 자신 제외 ·
 * "스캔 대상 0건 아님" 가드 · 주석 줄 제외 · 역검증 픽스처 포함)이다.
 *
 * 스캔 규칙: 모듈 소스는 `apps/api/src/utterance-analysis/**`의 `.ts` 중 시험(`*.spec.ts`)과 품질 측정 도구
 * (`eval/` — CI 밖 개발 도구, 보고서 파일을 쓴다)를 뺀 것이다.
 */

const REPO_ROOT = resolve(__dirname, '../../../../..');
const API_SRC = join(REPO_ROOT, 'apps/api/src');
const MODULE_DIR = join(API_SRC, 'utterance-analysis');
const SELF = resolve(__dirname, 'utterance-analysis-sealing.spec.ts');

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

function walk(dir: string, extensions: string[], out: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry === 'node_modules' || entry === 'dist' || entry === '.venv' || entry === '__pycache__') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, extensions, out);
    else if (extensions.some((ext) => entry.endsWith(ext))) out.push(full);
  }
}

function rel(absolute: string): string {
  return absolute.replace(/\\/g, '/').replace(REPO_ROOT.replace(/\\/g, '/') + '/', '');
}

function occurrences(content: string, pattern: RegExp): number {
  const g = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
  let count = 0;
  for (const line of content.split('\n')) {
    if (isCommentLine(line)) continue;
    const m = line.match(g);
    if (m) count += m.length;
  }
  return count;
}

interface SourceFile {
  readonly f: string;
  readonly content: string;
}

function load(files: string[]): SourceFile[] {
  return files.map((file) => ({ f: rel(file), content: readFileSync(file, 'utf8') }));
}

/** 모듈 소스(시험·eval 제외). */
function moduleFiles(): SourceFile[] {
  const files: string[] = [];
  walk(MODULE_DIR, ['.ts'], files);
  return load(files.filter((f) => f !== SELF && !f.endsWith('.spec.ts') && !rel(f).includes('utterance-analysis/eval/')));
}

/** apps/api 전체 소스(시험 제외). */
function apiFiles(): SourceFile[] {
  const files: string[] = [];
  walk(API_SRC, ['.ts'], files);
  return load(files.filter((f) => f !== SELF && !f.endsWith('.spec.ts')));
}

/** `marker` 뒤 첫 `(`부터 괄호 매칭으로 인자 텍스트를 뽑는다(주석 제외 전처리 후). */
function callArguments(rawContent: string, marker: RegExp): string[] {
  const content = stripComments(rawContent);
  const g = new RegExp(marker.source, 'g');
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = g.exec(content)) !== null) {
    let i = m.index + m[0].length - 1; // `(` 위치
    let depth = 0;
    let j = i;
    for (; j < content.length; j += 1) {
      if (content[j] === '(') depth += 1;
      else if (content[j] === ')') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    out.push(content.slice(i, j + 1));
    g.lastIndex = j + 1;
  }
  return out;
}

const MODULE = moduleFiles();
const ALL_API = apiFiles();

describe('발화 묶음 분석(No.21) 정적 검사 — deep-clustering-설계.md §20.4', () => {
  it('스캔 대상 파일이 존재한다(0건 통과 방지)', () => {
    expect(MODULE.length).toBeGreaterThan(15);
    expect(ALL_API.length).toBeGreaterThan(200);
    // 품질 측정 도구는 모듈 스캔에서 제외된다.
    expect(MODULE.some(({ f }) => f.includes('/eval/'))).toBe(false);
  });

  describe('UA-1: 대화 경로·엔진·위젯·채널 어댑터가 이 모듈을 알지 못한다(DC-1)', () => {
    const roots = [join(API_SRC, 'conversation'), join(REPO_ROOT, 'packages/dialogue-engine/src'), join(REPO_ROOT, 'apps/widget/src'), join(API_SRC, 'channels')];
    const files: string[] = [];
    for (const r of roots) walk(r, ['.ts', '.tsx'], files);
    const scanned = load(files);

    it('스캔 대상이 존재한다', () => {
      expect(scanned.length).toBeGreaterThan(20);
    });

    it('conversation/**·channels/**·dialogue-engine·widget에 utterance-analysis import·UtteranceAnalysis 심볼이 없다', () => {
      const offenders = scanned
        .filter(({ content }) => occurrences(content, /utterance-analysis|UtteranceAnalysis|UtteranceCluster|AnalyzedUtterance/) > 0)
        .map(({ f }) => f);
      expect(offenders).toEqual([]);
    });
  });

  describe('UA-2: 모듈 안 금지 심볼 0(DC-2 — 대화 로그·질의 캐시·RAG·레거시 API·업무 자동화·미응답 수집기)', () => {
    const pattern = /\b(ConversationLogService|QueryEmbeddingService|RagHttpClient|RagGateService|LegacyApi\w*|Workflow\w*|UnansweredCollectorService)\b/;

    it('주석을 제외한 소스에 금지 심볼이 없다', () => {
      const offenders = MODULE.filter(({ content }) => occurrences(content, pattern) > 0).map(({ f }) => f);
      expect(offenders).toEqual([]);
    });

    it('역검증: 금지 심볼 조각을 실제로 검출한다', () => {
      expect(pattern.test('constructor(private readonly log: ConversationLogService) {}')).toBe(true);
      expect(pattern.test('this.ragGate = new RagGateService()')).toBe(true);
      expect(pattern.test('import { WorkflowEventSink } from "../workflow"')).toBe(true);
      expect(pattern.test('this.legacy: LegacyApiService')).toBe(true);
    });
  });

  describe('UA-3: 모듈 imports 금지 목록 0(DC-3)', () => {
    const FORBIDDEN = [
      'ConversationModule',
      'KeywordsModule',
      'FaqsModule',
      'DialogNodesModule',
      'AugmentationModule',
      'ValidationModule',
      'RagModule',
      'LegacyApiModule',
      'WorkflowModule',
      'InboxModule',
      'TopicsModule',
      'LearningModule',
      'GovernanceModule',
    ];
    const moduleFile = MODULE.find(({ f }) => f.endsWith('utterance-analysis/utterance-analysis.module.ts'));

    it('금지 목록의 이름이 실제로 선언된 모듈이다(이름 오타로 0건 통과하는 것을 막는다)', () => {
      for (const name of FORBIDDEN) {
        const declared = ALL_API.some(({ content }) => new RegExp(`export\\s+class\\s+${name}\\b`).test(content));
        expect({ name, declared }).toEqual({ name, declared: true });
      }
    });

    it('모듈 파일이 존재하고 imports 배열에 금지 모듈이 없다', () => {
      expect(moduleFile).toBeDefined();
      const content = stripComments(moduleFile!.content);
      const start = content.indexOf('imports: [');
      expect(start).toBeGreaterThanOrEqual(0);
      const importsText = content.slice(start, content.indexOf(']', start));
      for (const name of FORBIDDEN) expect(importsText).not.toMatch(new RegExp(`\\b${name}\\b`));
      // import 문 자체에도 없다.
      for (const name of FORBIDDEN) expect(content).not.toMatch(new RegExp(`import\\s*\\{[^}]*\\b${name}\\b`));
    });

    it('LearningApplyService는 모듈 import 없이 providers에 직접 둔다(증강 모듈 선례)', () => {
      const content = stripComments(moduleFile!.content);
      const providersText = content.slice(content.indexOf('providers: ['));
      expect(providersText).toMatch(/\bLearningApplyService\b/);
    });
  });

  describe('UA-4: 자산 쓰기는 apply/utterance-apply.service.ts 1파일뿐이다(DC-4)', () => {
    const APPLY = 'apps/api/src/utterance-analysis/apply/utterance-apply.service.ts';

    it('의도 서비스 주입 · 예문 반영 호출 · 학습 반영(번들 무효화) 호출은 이 파일에만 있다', () => {
      for (const pattern of [/\bIntentsService\b/, /\.applyLearningExample\(/, /\.applyLearning\(/]) {
        const offenders = MODULE.filter(({ content }) => occurrences(content, pattern) > 0).map(({ f }) => f);
        expect(offenders).toEqual([APPLY]);
      }
    });

    it('학습 반영 호출문은 2개 이하이고 미리보기(preview)에는 0개다', () => {
      const apply = MODULE.find(({ f }) => f === APPLY)!;
      expect(occurrences(apply.content, /\.applyLearning\(/)).toBeLessThanOrEqual(2);
      expect(occurrences(apply.content, /\.applyLearning\(/)).toBeGreaterThanOrEqual(1);
      const previewStart = apply.content.indexOf('async preview(');
      const applyStart = apply.content.indexOf('async apply(');
      expect(previewStart).toBeGreaterThan(0);
      expect(applyStart).toBeGreaterThan(previewStart);
      const previewBlock = apply.content.slice(previewStart, applyStart);
      expect(occurrences(previewBlock, /\.applyLearning\(|\.applyLearningExample\(|\.markApplied\(/)).toBe(0);
    });

    it('모듈 안 어디에도 .invalidate( 호출이 없다(번들 무효화는 학습 반영 서비스 1곳)', () => {
      expect(MODULE.filter(({ content }) => occurrences(content, /\.invalidate\(/) > 0).map(({ f }) => f)).toEqual([]);
    });

    it('러너 파일(*job.runner.ts)에는 IntentsService·KeywordsService 심볼이 없다', () => {
      const runner = MODULE.filter(({ f }) => f.endsWith('job.runner.ts'));
      expect(runner.length).toBe(1);
      for (const { content } of runner) {
        expect(occurrences(content, /\bIntentsService\b/)).toBe(0);
        expect(occurrences(content, /\bKeywordsService\b/)).toBe(0);
      }
    });
  });

  describe('UA-5: 3테이블 쓰기 호출 파일 집합(DC-5)', () => {
    const writes = /\.(utteranceAnalysis|utteranceCluster|analyzedUtterance)\.(create|createMany|update|updateMany|upsert)\(/;
    const deletes = /\.(utteranceAnalysis|utteranceCluster|analyzedUtterance)\.(delete|deleteMany)\(/;

    it('create*·update*·upsert 호출 파일 = core/utterance-analysis.store.ts 1개', () => {
      const offenders = ALL_API.filter(({ content }) => occurrences(content, writes) > 0).map(({ f }) => f);
      expect(offenders).toEqual(['apps/api/src/utterance-analysis/core/utterance-analysis.store.ts']);
    });

    it('delete* 호출 파일 ⊆ {store · governance-data.writer.ts · chatbots.service.ts}', () => {
      const offenders = ALL_API.filter(({ content }) => occurrences(content, deletes) > 0).map(({ f }) => f);
      const allowed = new Set([
        'apps/api/src/utterance-analysis/core/utterance-analysis.store.ts',
        'apps/api/src/governance/writer/governance-data.writer.ts',
        'apps/api/src/chatbots/chatbots.service.ts',
      ]);
      expect(offenders.length).toBeGreaterThanOrEqual(3);
      for (const f of offenders) expect(allowed.has(f)).toBe(true);
    });

    it('역검증: prisma·tx 두 경로를 모두 검출한다', () => {
      expect(writes.test('await this.prisma.utteranceAnalysis.update({ where: { id } });')).toBe(true);
      expect(writes.test('await tx.analyzedUtterance.createMany({ data });')).toBe(true);
      expect(writes.test('await tx.utteranceCluster.upsert({});')).toBe(true);
      expect(writes.test('await this.prisma.utteranceAnalysis.findMany({});')).toBe(false);
    });
  });

  describe('UA-6: 금지 테이블 쓰기 0(DC-6)', () => {
    const pattern =
      /\.(topic|unansweredQuestion|conversationLog|messageFeedback|embeddingVector|embeddingTextVector|trainingJob|testRun\w*|augmentationSuggestion|keyword|faqEntry|dialogNode|intent)\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(/;

    it('모듈 안에서 자산·로그·학습·검증 테이블 쓰기 호출이 없다(의도 쓰기도 apply 서비스가 IntentsService로만 한다)', () => {
      expect(MODULE.filter(({ content }) => occurrences(content, pattern) > 0).map(({ f }) => f)).toEqual([]);
    });

    it('역검증', () => {
      expect(pattern.test('await this.prisma.conversationLog.create({ data });')).toBe(true);
      // 다른 봉인 스펙(S-1)이 소스 텍스트를 스캔하므로 픽스처 문자열은 조각을 이어 붙여 만든다.
      const write = ['await tx.', 'intent', '.update({ where });'].join('');
      const read = ['await this.prisma.', 'intent', '.findMany({});'].join('');
      expect(pattern.test(write)).toBe(true);
      expect(pattern.test(read)).toBe(false);
    });
  });

  describe('UA-7: MaskedUtteranceText 브랜드 발급은 lib/prepare-utterances.ts 1개뿐이다(DC-7)', () => {
    it('`as MaskedUtteranceText` 는 모듈 안에서 그 파일에만 있다(통합 인박스 `inbox/core/lib/masked-text.ts`는 별개의 자기 브랜드다)', () => {
      const offenders = MODULE.filter(({ content }) => occurrences(content, /\bas\s+MaskedUtteranceText\b/) > 0).map(({ f }) => f);
      expect(offenders).toEqual(['apps/api/src/utterance-analysis/lib/prepare-utterances.ts']);
    });

    it('저장소(store)는 MaskedUtteranceText 브랜드만 받는다(text·sourceMemo 타입)', () => {
      const store = MODULE.find(({ f }) => f.endsWith('core/utterance-analysis.store.ts'))!;
      expect(store.content).toMatch(/text:\s*MaskedUtteranceText;/);
      expect(store.content).toMatch(/sourceMemo:\s*MaskedUtteranceText\s*\|\s*null;/);
    });
  });

  describe('UA-8: 원본 파일·마스킹 전 문자열을 디스크에 쓰지 않는다(DC-8)', () => {
    const pattern = /\b(writeFile|writeFileSync|createWriteStream|appendFile|appendFileSync)\b|fs\.promises\.write/;

    it('모듈 안(eval 제외)에 파일 쓰기 API가 없다', () => {
      expect(MODULE.filter(({ content }) => occurrences(content, pattern) > 0).map(({ f }) => f)).toEqual([]);
    });

    it('역검증', () => {
      expect(pattern.test('fs.writeFileSync(path, buffer)')).toBe(true);
      expect(pattern.test('const s = createWriteStream(p)')).toBe(true);
      expect(pattern.test('await workbook.xlsx.writeBuffer()')).toBe(false); // 메모리 버퍼 생성은 디스크 쓰기가 아니다
    });
  });

  describe('UA-9: 로그·감사에 문장·파일 내용이 없다(DC-9)', () => {
    const forbidden = /\b(text|utterance|utterances|raw|fileName|memo|keywords)\b/i;

    it('Logger 호출 인자에 text·utterance·raw·fileName·memo 식별자가 없다', () => {
      const offenders: string[] = [];
      for (const { f, content } of MODULE) {
        for (const args of callArguments(content, /\blogger\.(log|warn|error|debug|verbose)\(/)) {
          if (forbidden.test(args)) offenders.push(`${f}: ${args.slice(0, 80)}`);
        }
      }
      expect(offenders).toEqual([]);
    });

    it('Logger 호출이 실제로 존재한다(0건 통과 방지)', () => {
      const total = MODULE.reduce((sum, { content }) => sum + callArguments(content, /\blogger\.(log|warn|error|debug|verbose)\(/).length, 0);
      expect(total).toBeGreaterThan(2);
    });

    it('역검증: 금지 식별자가 담긴 Logger 호출을 검출한다', () => {
      const fixture = 'this.logger.warn(`실패 text=${text} file=${fileName}`);';
      const args = callArguments(fixture, /\blogger\.(log|warn|error|debug|verbose)\(/);
      expect(args).toHaveLength(1);
      expect(forbidden.test(args[0])).toBe(true);
    });

    it('AUDIT_FIELDS.UtteranceAnalysis 화이트리스트에 text·fileName·memo·keywords류 필드명이 없다', () => {
      const entry = ALL_API.find(({ f }) => f.endsWith('audit-logs/lib/audit-snapshot.ts'))!;
      const content = stripComments(entry.content);
      const idx = content.search(/UtteranceAnalysis\s*:\s*\[/);
      expect(idx).toBeGreaterThanOrEqual(0);
      const start = content.indexOf('[', idx);
      const arrayText = content.slice(start, content.indexOf(']', start) + 1);
      expect(/\btext\b|\bfileName\b|\bmemo\b|\bkeywords?\b|\bmessage\b|\bquestion\b|\bbody\b/i.test(arrayText)).toBe(false);
      expect(arrayText).toMatch(/'validCount'/); // 건수 필드는 실제로 있다
    });
  });

  describe('UA-10: 백그라운드 루프·난수 0(DC-12 · 결정론)', () => {
    const pattern = /\bsetInterval\(|\bcron\b|\bPollingLoop\b|\bMath\.random\(/i;

    it('모듈 안(eval 제외)에 setInterval·cron·PollingLoop·Math.random이 없다', () => {
      expect(MODULE.filter(({ content }) => occurrences(content, pattern) > 0).map(({ f }) => f)).toEqual([]);
    });

    it('군집 함수 파일도 Math.random을 쓰지 않는다(시드 난수 mulberry32만)', () => {
      const km = MODULE.find(({ f }) => f.endsWith('lib/spherical-kmeans.ts'))!;
      expect(occurrences(km.content, /Math\.random\(/)).toBe(0);
      expect(km.content).toMatch(/mulberry32/);
    });
  });

  describe('UA-11: 엔진 패키지에 분석 심볼이 없다(DC-13)', () => {
    it('packages/dialogue-engine에 utteranceAnalysis·UtteranceCluster·analyzedUtterance가 없다', () => {
      const files: string[] = [];
      walk(join(REPO_ROOT, 'packages/dialogue-engine/src'), ['.ts'], files);
      expect(files.length).toBeGreaterThan(5);
      const offenders = load(files)
        .filter(({ content }) => /utteranceAnalys|UtteranceCluster|analyzedUtterance/i.test(content))
        .map(({ f }) => f);
      expect(offenders).toEqual([]);
    });
  });

  describe('추가 봉인 — 출구(DC-11) · 권한(DC-14) · 컨트롤러 계약', () => {
    it('이름 제안 출구 파일은 AUGMENT_LOCAL에 등록돼 있고 fetch( 앞에 assertEgressAllowed( 가 있다', () => {
      const local = EGRESS_REGISTRY.find((e) => e.exitId === 'AUGMENT_LOCAL')!;
      expect(local.files).toContain('utterance-analysis/naming/cluster-name-http.client.ts');
      const client = MODULE.find(({ f }) => f.endsWith('naming/cluster-name-http.client.ts'))!;
      const content = stripComments(client.content);
      expect(content.indexOf('assertEgressAllowed(')).toBeGreaterThan(-1);
      expect(content.indexOf('assertEgressAllowed(')).toBeLessThan(content.indexOf('fetch('));
      expect(content).toMatch(/egressRedirectMode\(\)/);
      expect(content).toMatch(/assertNoRedirectResponse\(/);
    });

    it('새 출구 클래스가 없다(EgressExitId 7종 그대로) · 모듈 안 fetch( 호출 파일은 그 출구 파일 1개뿐이다', () => {
      expect(EGRESS_REGISTRY).toHaveLength(7);
      const fetchers = MODULE.filter(({ content }) => occurrences(content, /\bfetch\(/) > 0).map(({ f }) => f);
      expect(fetchers).toEqual(['apps/api/src/utterance-analysis/naming/cluster-name-http.client.ts']);
    });

    it('cloud(외부 LLM API) 이름 제안 구현이 없다(FR-0-292)', () => {
      const offenders = MODULE.filter(({ content }) => occurrences(content, /generativelanguage|gemini|openai/i) > 0).map(({ f }) => f);
      expect(offenders).toEqual([]);
    });

    it('신규 권한 0 — Permission은 18종 그대로이고 컨트롤러에 @Public()이 없다', () => {
      expect(Permission.options).toHaveLength(18);
      const controller = MODULE.find(({ f }) => f.endsWith('utterance-analyses.controller.ts'))!;
      expect(occurrences(controller.content, /@Public\(\)/)).toBe(0);
      expect(occurrences(controller.content, /@RequirePermission\('dialogue:(read|write)'\)/)).toBe(13);
    });

    it('컨트롤러는 13 핸들러이고 template·capability·preview가 :analysisId 경로보다 먼저 선언된다', () => {
      const controller = MODULE.find(({ f }) => f.endsWith('utterance-analyses.controller.ts'))!;
      const content = stripComments(controller.content);
      const verbs = content.match(/@(Get|Post|Patch|Delete)\(/g) ?? [];
      expect(verbs).toHaveLength(13);
      const idxDetail = content.indexOf("@Get(':analysisId')");
      for (const literal of ["@Get('template')", "@Get('capability')", "@Post('preview')"]) {
        expect(content.indexOf(literal)).toBeGreaterThan(-1);
        expect(content.indexOf(literal)).toBeLessThan(idxDetail);
      }
    });

    it('러너는 취소를 단계마다 확인한다(임베딩 배치·군집·키워드·대조·이름 제안·저장 직전)', () => {
      const runner = MODULE.find(({ f }) => f.endsWith('job.runner.ts'))!;
      expect(occurrences(runner.content, /isCancelled\(\)/)).toBeGreaterThanOrEqual(5);
    });
  });
});
