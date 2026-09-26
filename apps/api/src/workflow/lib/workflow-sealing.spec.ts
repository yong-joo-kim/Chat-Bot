import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { EGRESS_REGISTRY } from '../../common/egress/egress-registry';
import {
  WorkflowEnvelopeV1Schema,
  WorkflowRunItemSchema,
  WorkflowStepViewSchema,
  WorkflowTargetPickerItemSchema,
} from '@chat-bot/shared-types';

/**
 * 업무 자동화 워크플로우(No.41) 정적 검사(`workflow-automation-설계.md` §17 W-1~W-18) — 기존
 * `*-sealing.spec.ts` 형식(스캔 루트 지정 · 자기 자신 제외 · 스캔 대상 0건 아님 가드 · 주석 줄 제외 ·
 * 역검증 픽스처 포함).
 */

const REPO_ROOT = resolve(__dirname, '../../../../..');
const SELF_ABSOLUTE = resolve(__dirname, 'workflow-sealing.spec.ts');

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
    if (entry === 'node_modules' || entry === 'dist' || entry === '.venv' || entry === 'venv' || entry === '__pycache__' || entry === '.git') continue;
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) walk(fullPath, extensions, out);
    else if (extensions.some((ext) => entry.endsWith(ext))) out.push(fullPath);
  }
}

function toRepoRelative(absolutePath: string): string {
  return absolutePath.replace(/\\/g, '/').replace(REPO_ROOT.replace(/\\/g, '/') + '/', '');
}

function collectApiSourceFiles(): string[] {
  const files: string[] = [];
  walk(join(REPO_ROOT, 'apps/api/src'), ['.ts'], files);
  return files.filter((f) => f !== SELF_ABSOLUTE && !f.endsWith('.spec.ts') && !f.replace(/\\/g, '/').includes('/integration/'));
}

function nonCommentOccurrences(content: string, pattern: RegExp): number {
  let count = 0;
  const g = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
  for (const line of content.split('\n')) {
    if (isCommentLine(line)) continue;
    const matches = line.match(g);
    if (matches) count += matches.length;
  }
  return count;
}

const apiFiles = collectApiSourceFiles();
const apiFileContents = apiFiles.map((f) => ({ f: toRepoRelative(f), content: readFileSync(f, 'utf8') }));

describe('업무 자동화 워크플로우(No.41) 정적 검사 — 스캔 기반 확인', () => {
  it('스캔 대상이 0건이 아니다(가드)', () => {
    expect(apiFileContents.length).toBeGreaterThan(100);
  });

  describe('W-1: WORKFLOW_SECRET__ 참조·리졸버 주입 파일 집합', () => {
    it('문자열 WORKFLOW_SECRET__ 보유 파일(주석 제외) = workflow/secrets/workflow-secret.resolver.ts 1개', () => {
      const offenders = apiFileContents
        .filter(({ f, content }) => nonCommentOccurrences(content, /WORKFLOW_SECRET__/) > 0 && f !== 'apps/api/src/workflow/secrets/workflow-secret.resolver.ts')
        .map(({ f }) => f);
      expect(offenders).toEqual([]);
      expect(apiFileContents.some((e) => e.f === 'apps/api/src/workflow/secrets/workflow-secret.resolver.ts')).toBe(true);
    });

    it('WorkflowSecretResolver 참조 파일 ⊆ {catalog, sender, targets, module 등록 파일}', () => {
      const allowed = [
        'apps/api/src/workflow/catalog/workflow-catalog.service.ts',
        'apps/api/src/workflow/catalog/workflow-catalog.module.ts',
        'apps/api/src/workflow/dispatch/workflow-http.sender.ts',
        'apps/api/src/workflow/targets/workflow-targets.service.ts',
        'apps/api/src/workflow/targets/workflow-target.mapper.ts',
        'apps/api/src/workflow/workflow.module.ts',
      ];
      const offenders = apiFileContents
        .filter(({ f, content }) => nonCommentOccurrences(content, /WorkflowSecretResolver\b/) > 0 && !allowed.includes(f) && f !== 'apps/api/src/workflow/secrets/workflow-secret.resolver.ts')
        .map(({ f }) => f);
      expect(offenders).toEqual([]);
    });
  });

  describe('W-2: 출구 레지스트리 · 발송기 봉인', () => {
    it('EGRESS_REGISTRY에 WORKFLOW_WEBHOOK이 있고 files에 발송기가 포함된다', () => {
      const def = EGRESS_REGISTRY.find((e) => e.exitId === 'WORKFLOW_WEBHOOK');
      expect(def).toBeDefined();
      expect(def?.files).toContain('workflow/dispatch/workflow-http.sender.ts');
    });

    it('발송기에 fetch( 심볼이 없다', () => {
      const sender = apiFileContents.find((e) => e.f === 'apps/api/src/workflow/dispatch/workflow-http.sender.ts');
      expect(sender).toBeDefined();
      expect(nonCommentOccurrences(sender!.content, /\bfetch\(/)).toBe(0);
    });

    it('발송기의 checkEgress(가 transport.request(보다 앞선다(G-2 순서 재확인)', () => {
      const sender = apiFileContents.find((e) => e.f === 'apps/api/src/workflow/dispatch/workflow-http.sender.ts')!;
      const guardIdx = sender.content.indexOf("checkEgress('WORKFLOW_WEBHOOK'");
      const sendIdx = sender.content.indexOf('this.transport.request(');
      expect(guardIdx).toBeGreaterThan(-1);
      expect(sendIdx).toBeGreaterThan(-1);
      expect(guardIdx).toBeLessThan(sendIdx);
    });

    it('역검증 — 가드 없이 송신만 있는 픽스처는 순서 위반으로 잡힌다', () => {
      const fixture = `class X { run() { this.transport.request(x); checkEgress('WORKFLOW_WEBHOOK', y); } }`;
      const guardIdx = fixture.indexOf("checkEgress('WORKFLOW_WEBHOOK'");
      const sendIdx = fixture.indexOf('this.transport.request(');
      expect(guardIdx).toBeGreaterThan(sendIdx);
    });
  });

  describe('W-3: workflowRun 쓰기 파일 집합', () => {
    it('workflowRun.create( 호출 파일 = triggers/workflow-run-enqueue.writer.ts 1개', () => {
      const offenders = apiFileContents
        .filter(({ f, content }) => nonCommentOccurrences(content, /workflowRun\.create\(/) > 0 && f !== 'apps/api/src/workflow/triggers/workflow-run-enqueue.writer.ts')
        .map(({ f }) => f);
      expect(offenders).toEqual([]);
    });

    it('workflowRun.update|updateMany( 호출 파일 = core/workflow-run.store.ts 1개', () => {
      const offenders = apiFileContents
        .filter(
          ({ f, content }) =>
            (nonCommentOccurrences(content, /workflowRun\.update\(/) > 0 || nonCommentOccurrences(content, /workflowRun\.updateMany\(/) > 0) &&
            f !== 'apps/api/src/workflow/core/workflow-run.store.ts',
        )
        .map(({ f }) => f);
      expect(offenders).toEqual([]);
    });

    it('workflowRun.delete|deleteMany( 호출 파일 ⊆ {governance-data.writer.ts, chatbots.service.ts}', () => {
      const allowed = ['apps/api/src/governance/writer/governance-data.writer.ts', 'apps/api/src/chatbots/chatbots.service.ts'];
      const offenders = apiFileContents
        .filter(({ f, content }) => nonCommentOccurrences(content, /workflowRun\.deleteMany\(/) > 0 && !allowed.includes(f))
        .map(({ f }) => f);
      expect(offenders).toEqual([]);
    });
  });

  describe('W-4: workflowTarget · workflowSubscription 쓰기 파일 집합', () => {
    it('workflowTarget 쓰기 = {workflow-targets.service.ts, workflow-run.store.ts}', () => {
      const allowed = ['apps/api/src/workflow/targets/workflow-targets.service.ts', 'apps/api/src/workflow/core/workflow-run.store.ts'];
      const offenders = apiFileContents
        .filter(
          ({ f, content }) =>
            (nonCommentOccurrences(content, /workflowTarget\.(create|update|updateMany|delete|upsert)\(/) > 0) && !allowed.includes(f),
        )
        .map(({ f }) => f);
      expect(offenders).toEqual([]);
    });

    it('workflowSubscription 쓰기 ⊆ {workflow-subscriptions.service.ts, workflow-run.store.ts, chatbots.service.ts}', () => {
      const allowed = [
        'apps/api/src/workflow/subscriptions/workflow-subscriptions.service.ts',
        'apps/api/src/workflow/core/workflow-run.store.ts',
        'apps/api/src/chatbots/chatbots.service.ts',
      ];
      const offenders = apiFileContents
        .filter(({ f, content }) => nonCommentOccurrences(content, /workflowSubscription\.(create|update|updateMany|delete|deleteMany|upsert)\(/) > 0 && !allowed.includes(f))
        .map(({ f }) => f);
      expect(offenders).toEqual([]);
    });
  });

  describe('W-5·W-6: 로그·감사 화이트리스트에 값 필드 0', () => {
    it('workflow/** · common/workflow/** logger 호출 인자에 금지 식별자가 없다(휴리스틱)', () => {
      const forbidden = ['payload', 'fields', 'sessionId', 'secret', 'body', 'headers'];
      const targets = apiFileContents.filter(({ f }) => f.startsWith('apps/api/src/workflow/') || f.startsWith('apps/api/src/common/workflow/'));
      for (const { f, content } of targets) {
        for (const line of content.split('\n')) {
          if (!/\.(warn|error|log|debug)\(/.test(line)) continue;
          for (const word of forbidden) {
            if (new RegExp(`\\$\\{[^}]*\\b${word}\\b[^}]*\\}`).test(line)) {
              throw new Error(`금지 식별자(${word})가 로그 호출에 포함됨: ${f}`);
            }
          }
        }
      }
      expect(true).toBe(true);
    });
  });

  describe('W-7: schema.prisma 신규 3모델 규약', () => {
    const schema = readFileSync(join(REPO_ROOT, 'apps/api/prisma/schema.prisma'), 'utf8');

    function extractModelBlockNoComments(marker: string): string {
      const start = schema.indexOf(marker);
      expect(start).toBeGreaterThan(-1);
      const end = schema.indexOf('\n}', start);
      return schema
        .slice(start, end)
        .split('\n')
        .filter((l) => !l.trim().startsWith('///'))
        .join('\n');
    }

    it('신규 3모델에 onDelete: Cascade/SetNull이 없다', () => {
      const modelBlocks = ['model WorkflowTarget {', 'model WorkflowSubscription {', 'model WorkflowRun {'];
      for (const marker of modelBlocks) {
        const block = extractModelBlockNoComments(marker);
        expect(/onDelete:\s*Cascade/.test(block)).toBe(false);
        expect(/onDelete:\s*SetNull/.test(block)).toBe(false);
      }
    });

    it('WorkflowRun에 sessionId·userMessage·botResponse 컬럼(필드 선언)이 없다', () => {
      const block = extractModelBlockNoComments('model WorkflowRun {');
      // 필드 선언 형태(줄 시작 + 공백 + 식별자)만 검사 — 문서 주석은 이미 제거했다.
      expect(/^\s*sessionId\s+/m.test(block)).toBe(false);
      expect(/^\s*userMessage\s+/m.test(block)).toBe(false);
      expect(/^\s*botResponse\s+/m.test(block)).toBe(false);
    });
  });

  describe('W-8: 엔진 심볼 0', () => {
    it('packages/dialogue-engine/src에 webhook·hmac·workflowRun·WorkflowTarget·dispatch·deliveryId 심볼이 없다', () => {
      const files: string[] = [];
      walk(join(REPO_ROOT, 'packages/dialogue-engine/src'), ['.ts'], files);
      const forbidden = ['webhook', 'hmac', 'workflowRun', 'WorkflowTarget', 'dispatch', 'deliveryId'];
      for (const file of files) {
        if (file.endsWith('.spec.ts')) continue;
        const content = readFileSync(file, 'utf8');
        for (const word of forbidden) {
          if (new RegExp(`\\b${word}\\b`).test(content)) {
            throw new Error(`엔진 파일에 금지 심볼(${word}) 발견: ${toRepoRelative(file)}`);
          }
        }
      }
      expect(files.length).toBeGreaterThan(0);
    });
  });

  describe('W-9: 도메인 모듈의 workflow/ import 제한', () => {
    it('validation·versions·deploy-schedules·stats·learning·topics·asset-transfer·governance·environment에 workflow/ import가 없다', () => {
      const forbiddenDirs = [
        'apps/api/src/validation/',
        'apps/api/src/deploy-schedules/',
        'apps/api/src/stats/',
        'apps/api/src/learning/',
        'apps/api/src/topics/',
        'apps/api/src/asset-transfer/',
      ];
      const offenders = apiFileContents
        .filter(({ f, content }) => forbiddenDirs.some((d) => f.startsWith(d)) && /from '.*workflow\//.test(content))
        .map(({ f }) => f);
      expect(offenders).toEqual([]);
    });

    it('handoff·survey-responses·feedback의 workflow/ import는 triggers 모듈·포트뿐이다', () => {
      const targets = ['apps/api/src/handoff/', 'apps/api/src/survey-responses/', 'apps/api/src/feedback/'];
      const offenders: string[] = [];
      for (const { f, content } of apiFileContents) {
        if (!targets.some((d) => f.startsWith(d))) continue;
        const matches = content.match(/from '([^']*workflow\/[^']*)'/g) ?? [];
        for (const m of matches) {
          if (!/workflow\/triggers\/workflow-triggers\.module/.test(m) && !/common\/workflow\/workflow-event\.port/.test(m)) {
            offenders.push(`${f}: ${m}`);
          }
        }
      }
      expect(offenders).toEqual([]);
    });
  });

  describe('W-10: @Public() 0', () => {
    it('workflow/** 파일에 @Public()이 없다', () => {
      const offenders = apiFileContents.filter(({ f, content }) => f.startsWith('apps/api/src/workflow/') && content.includes('@Public(')).map(({ f }) => f);
      expect(offenders).toEqual([]);
    });
  });

  describe('W-11: 위젯·ml-worker 변경 0', () => {
    it('apps/widget/src · apps/ml-worker에 workflow·WORKFLOW_·webhook 심볼이 없다', () => {
      const files: string[] = [];
      walk(join(REPO_ROOT, 'apps/widget/src'), ['.ts', '.tsx'], files);
      walk(join(REPO_ROOT, 'apps/ml-worker'), ['.py'], files);
      const offenders = files.filter((file) => {
        const content = readFileSync(file, 'utf8');
        return /workflow|WORKFLOW_|webhook/i.test(content);
      });
      expect(offenders).toEqual([]);
    });
  });

  describe('W-12: legacy-api import 허용 목록', () => {
    it('workflow/** 의 legacy-api/ import ⊆ 전송·DNS·IP정책 파일', () => {
      const allowedSuffixes = ['transport/legacy-transport.port', 'transport/node-http.transport', 'transport/node-dns.resolver', 'lib/ip-policy'];
      const offenders: string[] = [];
      for (const { f, content } of apiFileContents) {
        if (!f.startsWith('apps/api/src/workflow/')) continue;
        const matches = content.match(/from '([^']*legacy-api\/[^']*)'/g) ?? [];
        for (const m of matches) {
          if (!allowedSuffixes.some((s) => m.includes(s))) offenders.push(`${f}: ${m}`);
        }
      }
      expect(offenders).toEqual([]);
    });

    it('workflow/** 에 LegacyApiHttpClient·LegacyApiService·LegacyApiSecretResolver 심볼이 없다', () => {
      const forbidden = ['LegacyApiHttpClient', 'LegacyApiService', 'ValidatedLegacyRequest', 'LegacyApiSecretResolver', 'LEGACY_API_SECRET'];
      const offenders: string[] = [];
      for (const { f, content } of apiFileContents) {
        if (!f.startsWith('apps/api/src/workflow/')) continue;
        for (const word of forbidden) if (content.includes(word)) offenders.push(`${f}:${word}`);
      }
      expect(offenders).toEqual([]);
    });
  });

  describe('W-13: sealField/openField(WORKFLOW_PAYLOAD 봉인', () => {
    it("sealField('WORKFLOW_PAYLOAD' 호출 파일 = writer 1개", () => {
      const offenders = apiFileContents
        .filter(({ f, content }) => content.includes("sealField('WORKFLOW_PAYLOAD'") && f !== 'apps/api/src/workflow/triggers/workflow-run-enqueue.writer.ts')
        .map(({ f }) => f);
      expect(offenders).toEqual([]);
    });

    it("openField('WORKFLOW_PAYLOAD' 호출 파일 = store 1개", () => {
      const offenders = apiFileContents
        .filter(({ f, content }) => content.includes("openField('WORKFLOW_PAYLOAD'") && f !== 'apps/api/src/workflow/core/workflow-run.store.ts')
        .map(({ f }) => f);
      expect(offenders).toEqual([]);
    });
  });

  describe('W-14: zod 스키마 키 집합의 런타임 일치(화면 계약 고정)', () => {
    it('WorkflowEnvelopeV1Schema.shape 키 집합이 승인된 목록과 정확히 같다(sessionId·payload 없음)', () => {
      const expected = [
        'action',
        'channel',
        'chatbot',
        'data',
        'deliveryId',
        'eventType',
        'fields',
        'occurredAt',
        'sessionRef',
        'source',
        'specVersion',
        'test',
      ].sort();
      const actual = Object.keys(WorkflowEnvelopeV1Schema.shape).sort();
      expect(actual).toEqual(expected);
      expect(actual).not.toContain('sessionId');
      expect(actual).not.toContain('payload');
    });

    it('WorkflowRunItemSchema.shape 키 집합이 승인된 목록과 정확히 같다(sessionId·payload 없음)', () => {
      const expected = [
        'actionKey',
        'attemptCount',
        'chatbotId',
        'completedAt',
        'createdAt',
        'eventType',
        'fieldNames',
        'holdReason',
        'id',
        'lastHttpStatus',
        'lastLatencyMs',
        'lastOutcome',
        'manualRetryCount',
        'nextAttemptAt',
        'nodeId',
        'payloadPurged',
        'personalDataMasked',
        'retryable',
        'sessionRef',
        'status',
        'statusReason',
        'subscriptionId',
        'targetId',
        'targetName',
        'triggerKind',
      ].sort();
      const actual = Object.keys(WorkflowRunItemSchema.shape).sort();
      expect(actual).toEqual(expected);
      expect(actual).not.toContain('sessionId');
      expect(actual).not.toContain('payload');
    });

    it('WorkflowStepViewSchema.shape 키 집합이 승인된 목록과 정확히 같다', () => {
      const expected = [
        'actionKey',
        'bindingMissing',
        'fields',
        'mock',
        'nodeId',
        'personalDataMasked',
        'rawPersonalData',
        'targetId',
        'targetName',
        'targetState',
      ].sort();
      const actual = Object.keys(WorkflowStepViewSchema.shape).sort();
      expect(actual).toEqual(expected);
    });

    it('WorkflowTargetPickerItemSchema.shape 키 집합이 승인된 목록과 정확히 같다(비밀·URL 필드 없음)', () => {
      const expected = ['allowRawPersonalData', 'enabled', 'id', 'name', 'paused', 'ready'].sort();
      const actual = Object.keys(WorkflowTargetPickerItemSchema.shape).sort();
      expect(actual).toEqual(expected);
      expect(actual).not.toContain('baseUrl');
      for (const key of actual) {
        expect(/Ref$/.test(key)).toBe(false);
      }
    });

    it('역검증 — 스키마에 키가 추가되면 고정 목록 비교가 실제로 실패로 잡는다', () => {
      const fixtureShape = { ...WorkflowTargetPickerItemSchema.shape, extraLeakedField: WorkflowTargetPickerItemSchema.shape.id };
      const actual = Object.keys(fixtureShape).sort();
      const expected = ['allowRawPersonalData', 'enabled', 'id', 'name', 'paused', 'ready'].sort();
      expect(actual).not.toEqual(expected);
    });

    it('simulation.service.ts의 응답 구성에 `...result` 스프레드가 없다(apiStep·workflowEvents 원시 유출 방지)', () => {
      const entry = apiFileContents.find((e) => e.f === 'apps/api/src/simulation/simulation.service.ts')!;
      expect(entry).toBeDefined();
      expect(nonCommentOccurrences(entry.content, /\.\.\.result\b/)).toBe(0);
    });

    it('역검증 — `...result` 스프레드가 있는 픽스처는 실제로 잡힌다', () => {
      const fixture = 'return { input: x, ...result, workflowSteps };';
      expect(nonCommentOccurrences(fixture, /\.\.\.result\b/)).toBeGreaterThan(0);
    });
  });

  describe('W-15: 모듈 export 규약', () => {
    it("drainForTest( 운영 코드 호출 0(테스트 파일 밖)", () => {
      const offenders = apiFileContents.filter(({ f, content }) => content.includes('.drainForTest(') && !f.includes('/integration/')).map(({ f }) => f);
      expect(offenders).toEqual([]);
    });

    it('WorkflowModule exports는 []이다', () => {
      const mod = apiFileContents.find((e) => e.f === 'apps/api/src/workflow/workflow.module.ts')!;
      expect(/exports:\s*\[\]/.test(mod.content)).toBe(true);
    });

    it('WorkflowTriggersModule exports = {WorkflowTriggerService, WORKFLOW_EVENT_SINK}', () => {
      const mod = apiFileContents.find((e) => e.f === 'apps/api/src/workflow/triggers/workflow-triggers.module.ts')!;
      expect(mod.content).toMatch(/exports:\s*\[WorkflowTriggerService,\s*WORKFLOW_EVENT_SINK\]/);
    });

    it('WorkflowCatalogModule exports = {WorkflowCatalogService}', () => {
      const mod = apiFileContents.find((e) => e.f === 'apps/api/src/workflow/catalog/workflow-catalog.module.ts')!;
      expect(mod.content).toMatch(/exports:\s*\[WorkflowCatalogService\]/);
    });
  });

  describe('W-16: 원천 4파일 발행 규약', () => {
    const sourceFiles = [
      'apps/api/src/handoff/handoff-thread.service.ts',
      'apps/api/src/survey-responses/survey-response.service.ts',
      'apps/api/src/feedback/message-feedback.service.ts',
      'apps/api/src/conversation/conversation-log.service.ts',
    ];

    it('원천 파일의 emit( 호출에 await가 없다', () => {
      for (const f of sourceFiles) {
        const entry = apiFileContents.find((e) => e.f === f);
        expect(entry).toBeDefined();
        for (const line of entry!.content.split('\n')) {
          if (isCommentLine(line)) continue;
          if (line.includes('.emit(') && line.includes('await')) {
            throw new Error(`emit( 앞에 await가 있음: ${f}`);
          }
        }
      }
    });

    it('kind 리터럴 발행 개수가 설계 표와 일치한다(핸드오프 2·설문 1·평가 1·로그 1)', () => {
      const expectations: Record<string, string[]> = {
        'apps/api/src/handoff/handoff-thread.service.ts': ['HANDOFF_STARTED', 'HANDOFF_ENDED'],
        'apps/api/src/survey-responses/survey-response.service.ts': ['SURVEY_COMPLETED'],
        'apps/api/src/feedback/message-feedback.service.ts': ['FEEDBACK_NEGATIVE'],
        'apps/api/src/conversation/conversation-log.service.ts': ['TURN_LOGGED'],
      };
      for (const [f, kinds] of Object.entries(expectations)) {
        const entry = apiFileContents.find((e) => e.f === f)!;
        for (const kind of kinds) {
          expect(entry.content.includes(`kind: '${kind}'`)).toBe(true);
        }
      }
    });
  });

  describe('W-17: 발송 루프 시험 격리', () => {
    it("jest.isolate-env.js에 WORKFLOW_DISPATCH_ENABLED = 'false'가 있다", () => {
      const content = readFileSync(join(REPO_ROOT, 'apps/api/jest.isolate-env.js'), 'utf8');
      expect(content.includes("process.env.WORKFLOW_DISPATCH_ENABLED = 'false';")).toBe(true);
    });

    it('workflow-dispatch.job.ts가 PollingLoop를 쓰고 setInterval(이 없다', () => {
      const entry = apiFileContents.find((e) => e.f === 'apps/api/src/workflow/dispatch/workflow-dispatch.job.ts')!;
      expect(entry.content.includes('new PollingLoop(')).toBe(true);
      expect(nonCommentOccurrences(entry.content, /setInterval\(/)).toBe(0);
    });
  });

  describe('W-18: 원시 SQL·마이그레이션 규약', () => {
    it('workflow/** 에 $queryRaw·$executeRaw가 없다', () => {
      const offenders = apiFileContents.filter(({ f, content }) => f.startsWith('apps/api/src/workflow/') && /\$(query|execute)Raw/.test(content)).map(({ f }) => f);
      expect(offenders).toEqual([]);
    });

    it('신규 마이그레이션 SQL에 DROP·ALTER TABLE·WHERE(부분 인덱스)가 없다', () => {
      const migrationPath = join(REPO_ROOT, 'apps/api/prisma/migrations/20260926180000_workflow_automation/migration.sql');
      const content = readFileSync(migrationPath, 'utf8');
      expect(/\bDROP\b/i.test(content)).toBe(false);
      expect(/ALTER TABLE/i.test(content)).toBe(false);
      // CREATE INDEX ... WHERE(부분 인덱스) 금지 — 일반 WHERE 절이 CREATE TABLE 안에 없어야 한다.
      const indexLines = content.split('\n').filter((l) => /CREATE (UNIQUE )?INDEX/i.test(l));
      expect(indexLines.some((l) => /\bWHERE\b/i.test(l))).toBe(false);
    });
  });
});
