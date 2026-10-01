import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ApiErrorCode, AuditTargetType, EgressExitId, Permission } from '@chat-bot/shared-types';

/**
 * AI 거버넌스·가드레일(No.36) 정적 검사 — `ai-guardrails-설계.md` §18.7 GR-1~GR-14(봉인 AG-3~AG-15 · AG-18 · AG-10).
 * 각 검사에는 **역검증**(위반 픽스처를 헬퍼가 실제로 잡는지)을 1개씩 둔다 — 기존 봉인 선례.
 * AG-16(콘솔 문자열)은 web vitest 소관이라 여기에 없다.
 */

const REPO_ROOT = resolve(__dirname, '../../../../..');
const SELF_ABSOLUTE = resolve(__dirname, 'guardrail-sealing.spec.ts');

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
    if (entry === 'node_modules' || entry === 'dist' || entry === '.git' || entry === '__pycache__' || entry === '.venv') continue;
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) walk(fullPath, extensions, out);
    else if (extensions.some((ext) => entry.endsWith(ext))) out.push(fullPath);
  }
}

function toRepoRelative(absolutePath: string): string {
  return absolutePath.replace(/\\/g, '/').replace(`${REPO_ROOT.replace(/\\/g, '/')}/`, '');
}

interface Src {
  f: string;
  content: string;
}

function collect(root: string, extensions = ['.ts']): Src[] {
  const files: string[] = [];
  walk(join(REPO_ROOT, root), extensions, files);
  return files.filter((f) => f !== SELF_ABSOLUTE && !f.endsWith('.spec.ts')).map((f) => ({ f: toRepoRelative(f), content: readFileSync(f, 'utf8') }));
}

/** 주석 줄을 뺀 줄 단위 일치 횟수. */
function nonCommentOccurrences(content: string, pattern: RegExp): number {
  const g = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
  let count = 0;
  for (const line of content.split('\n')) {
    if (isCommentLine(line)) continue;
    count += line.match(g)?.length ?? 0;
  }
  return count;
}

function stripComments(content: string): string {
  return content
    .split('\n')
    .filter((line) => !isCommentLine(line))
    .join('\n');
}

/** 패턴을 가진(주석 제외) 파일 목록. */
function filesWith(sources: readonly Src[], pattern: RegExp): string[] {
  return sources.filter(({ content }) => nonCommentOccurrences(content, pattern) > 0).map(({ f }) => f);
}

const api = collect('apps/api/src');
const guardrailsSrc = api.filter(({ f }) => f.startsWith('apps/api/src/guardrails/') && !f.includes('/eval/'));
const approvalSrc = api.filter(({ f }) => f.startsWith('apps/api/src/environment/approval/'));
const ownSrc = [...guardrailsSrc, ...approvalSrc];
const engineSrc = collect('packages/dialogue-engine/src');
const widgetSrc = collect('apps/widget/src');
const mlWorkerSrc = collect('apps/ml-worker', ['.py', '.ts']);

function fileOf(sources: readonly Src[], suffix: string): Src {
  const found = sources.find(({ f }) => f.endsWith(suffix));
  expect(found).toBeDefined();
  return found as Src;
}

describe('가드레일 정적 검사(GR-1~GR-14) — 스캔 기반 확인', () => {
  it('스캔 대상이 0건이 아니다(가드)', () => {
    expect(guardrailsSrc.length).toBeGreaterThan(10);
    expect(approvalSrc.length).toBeGreaterThan(4);
    expect(engineSrc.length).toBeGreaterThan(5);
    expect(widgetSrc.length).toBeGreaterThan(5);
  });

  describe('AG-2: Permission 18 · EgressExitId 8(No.32 SPEECH_LOCAL 추가) · AuditTargetType 38 · 신규 오류 코드 6 불변 확인', () => {
    it('개수 단언', () => {
      expect(Permission.options).toHaveLength(18);
      expect(EgressExitId.options).toHaveLength(8);
      expect(AuditTargetType.options).toHaveLength(38);
      for (const code of ['ENV_APPROVAL_REQUIRED', 'APPROVAL_SELF_FORBIDDEN', 'APPROVAL_NOT_PENDING', 'APPROVAL_BASE_CHANGED', 'APPROVAL_PENDING_EXISTS', 'APPROVAL_POLICY_UNAVAILABLE']) {
        expect(ApiErrorCode.options).toContain(code);
      }
    });
  });

  describe('GR-1(AG-3): 모델·임베딩·LLM·외부 호출 심볼 0', () => {
    const FORBIDDEN = /\b(EmbeddingProviderFactory|QueryEmbeddingService|SemanticMatchService|AugmentationProvider|ClusterNameSuggester|RagHttpClient|LegacyApi\w*)\b|\bfetch\(/;

    it('guardrails/**·environment/approval/**에 없다', () => {
      expect(filesWith(ownSrc, FORBIDDEN)).toEqual([]);
    });

    it('역검증 — 위반 픽스처를 잡는다', () => {
      expect(filesWith([{ f: 'x', content: 'const p = this.embeddingProviderFactory; new EmbeddingProviderFactory()' }], FORBIDDEN)).toEqual(['x']);
      expect(filesWith([{ f: 'x', content: "await fetch('http://x')" }], FORBIDDEN)).toEqual(['x']);
    });
  });

  describe('GR-2(AG-4): 쓰기 유일 파일', () => {
    const WRITE = 'create|createMany|update|updateMany|upsert|delete|deleteMany';
    const writersOf = (model: string) => filesWith(api, new RegExp(`\\b${model}\\.(${WRITE})\\(`));

    it('guardrailRule = core/guardrail-rule.store.ts (+ 영구삭제 chatbots.service.ts의 deleteMany)', () => {
      expect(writersOf('guardrailRule').sort()).toEqual(['apps/api/src/chatbots/chatbots.service.ts', 'apps/api/src/guardrails/core/guardrail-rule.store.ts']);
    });

    it('chatbotGuardrailSetting = core/guardrail-setting.store.ts (+ chatbots.service.ts)', () => {
      expect(writersOf('chatbotGuardrailSetting').sort()).toEqual(['apps/api/src/chatbots/chatbots.service.ts', 'apps/api/src/guardrails/core/guardrail-setting.store.ts']);
    });

    it('guardrailEvent = runtime/guardrail-event.writer.ts (+ chatbots.service.ts의 deleteMany)', () => {
      expect(writersOf('guardrailEvent').sort()).toEqual(['apps/api/src/chatbots/chatbots.service.ts', 'apps/api/src/guardrails/runtime/guardrail-event.writer.ts']);
    });

    it('prodSwitchApprovalRequest = environment/approval/switch-approval.store.ts (+ chatbots.service.ts)', () => {
      expect(writersOf('prodSwitchApprovalRequest').sort()).toEqual(['apps/api/src/chatbots/chatbots.service.ts', 'apps/api/src/environment/approval/switch-approval.store.ts']);
    });

    it('delete*는 규칙 저장소 + chatbots.service.ts(영구삭제)에만 있다', () => {
      const deleters = filesWith(api, /(guardrailRule|chatbotGuardrailSetting|guardrailEvent|prodSwitchApprovalRequest)\.(delete|deleteMany)\(/);
      expect(deleters.sort()).toEqual(['apps/api/src/chatbots/chatbots.service.ts', 'apps/api/src/guardrails/core/guardrail-rule.store.ts']);
    });

    it('역검증', () => {
      expect(filesWith([{ f: 'x', content: 'await this.prisma.guardrailRule.update({})' }], new RegExp(`\\bguardrailRule\\.(${WRITE})\\(`))).toEqual(['x']);
    });
  });

  describe('GR-3(AG-5): 자산 쓰기·자산 서비스 심볼 0', () => {
    const ASSET_WRITE = /\b(intent|keyword|faqEntry|dialogNode|topic|homonymDictionary|contextVariable|chatbotAnswerSetting|bannedWord)\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(/;
    const ASSET_SERVICE = /\b(IntentsService|FaqsService|DialogNodesService|LearningApplyService|VersionRestoreService)\b/;

    it('guardrails/**·environment/approval/**에 없다', () => {
      expect(filesWith(ownSrc, ASSET_WRITE)).toEqual([]);
      expect(filesWith(ownSrc, ASSET_SERVICE)).toEqual([]);
    });

    it('역검증', () => {
      expect(filesWith([{ f: 'x', content: 'this.prisma.faqEntry.update({})' }], ASSET_WRITE)).toEqual(['x']);
      expect(filesWith([{ f: 'x', content: 'constructor(private s: IntentsService) {}' }], ASSET_SERVICE)).toEqual(['x']);
    });
  });

  describe('GR-4(AG-6): 문장 컬럼 0 — schema.prisma의 GuardrailEvent·ProdSwitchApprovalRequest', () => {
    const schema = readFileSync(join(REPO_ROOT, 'apps/api/prisma/schema.prisma'), 'utf8');

    function modelBlock(source: string, name: string): string {
      const start = source.search(new RegExp(`^model ${name} \\{`, 'm'));
      expect(start).toBeGreaterThanOrEqual(0);
      const end = source.indexOf('\n}', start);
      return source.slice(start, end);
    }

    function forbiddenColumns(block: string, allowed: readonly string[]): string[] {
      const names = block
        .split('\n')
        .map((line) => line.trim().split(/\s+/)[0])
        .filter((n) => /^[a-z]\w*$/.test(n));
      return names.filter((n) => /^(userMessage|botResponse|text|answer|question|body)$/i.test(n) && !allowed.includes(n));
    }

    it('두 모델에 없다(요청 reason·decisionNote는 마스킹 메모 ≤200 — 예외 명시)', () => {
      expect(forbiddenColumns(modelBlock(schema, 'GuardrailEvent'), [])).toEqual([]);
      expect(forbiddenColumns(modelBlock(schema, 'ProdSwitchApprovalRequest'), [])).toEqual([]);
    });

    it('역검증', () => {
      expect(forbiddenColumns('model X {\n  id String\n  userMessage String\n  answer String\n}', [])).toEqual(['userMessage', 'answer']);
    });
  });

  describe('GR-5(AG-7): kinds:·preserveDates: 인자를 넘기는 maskPii 호출 파일 = exit-pii.ts 1개', () => {
    const CALL = /maskPii\([^)]*\{[^}]*\b(kinds|preserveDates)\b/;

    it('운영 코드 전체에서 1개', () => {
      expect(filesWith([...api, ...collect('packages/pii-mask/src').filter(({ f }) => !f.endsWith('index.ts'))], CALL)).toEqual(['apps/api/src/guardrails/lib/exit-pii.ts']);
    });

    it('역검증', () => {
      expect(filesWith([{ f: 'x', content: "maskPii(text, { kinds: ['rrn'] })" }], CALL)).toEqual(['x']);
      expect(filesWith([{ f: 'x', content: 'maskPii(text)' }], CALL)).toEqual([]);
    });
  });

  describe('GR-6(AG-8): 판정·기록 호출 위치와 횟수', () => {
    const outside = api.filter(({ f }) => !f.startsWith('apps/api/src/guardrails/'));

    it('입구 판정 guardrails?.evaluateInbound( = public-conversation.service.ts 1회 + simulation.service.ts 1회', () => {
      const callers = outside.filter(({ content }) => nonCommentOccurrences(content, /guardrails\??\.evaluateInbound\(/) > 0);
      expect(callers.map(({ f }) => f).sort()).toEqual(['apps/api/src/conversation/public-conversation.service.ts', 'apps/api/src/simulation/simulation.service.ts']);
      for (const c of callers) expect(nonCommentOccurrences(c.content, /guardrails\??\.evaluateInbound\(/)).toBe(1);
    });

    it('출구 판정 evaluateOutbound( = rag-answer.service.ts 1회 + simulation.service.ts 1회', () => {
      const callers = outside.filter(({ content }) => nonCommentOccurrences(content, /\.evaluateOutbound\(/) > 0);
      expect(callers.map(({ f }) => f).sort()).toEqual(['apps/api/src/rag/rag-answer.service.ts', 'apps/api/src/simulation/simulation.service.ts']);
      for (const c of callers) expect(nonCommentOccurrences(c.content, /\.evaluateOutbound\(/)).toBe(1);
    });

    it('recordEvents( 호출 파일 = {public-conversation.service.ts, rag-answer.service.ts} — 시뮬레이터 0', () => {
      expect(filesWith(outside, /\.recordEvents\(/).sort()).toEqual(['apps/api/src/conversation/public-conversation.service.ts', 'apps/api/src/rag/rag-answer.service.ts']);
    });

    it('역검증', () => {
      expect(filesWith([{ f: 'x', content: 'this.guardrails?.recordEvents({})' }], /\.recordEvents\(/)).toEqual(['x']);
    });
  });

  describe('GR-7(AG-9): 외부 RAG 봉인 — guardrails/**에 prompt · RAG 서버 설정 경로 · 문단 상세 경로 문자열 0', () => {
    const FORBIDDEN = /prompt|\/api\/rag\/settings|rag_paragraph_detail/i;

    it('없다', () => {
      expect(filesWith(guardrailsSrc, FORBIDDEN)).toEqual([]);
    });

    it('역검증', () => {
      // 금지 문자열 자체가 저장소에 0건이어야 하므로(`rag-allowlist.spec.ts`) 픽스처도 조각으로 조립한다.
      const forbiddenPath = ['/api', 'rag', 'settings'].join('/');
      expect(filesWith([{ f: 'x', content: `const url = '${forbiddenPath}'` }], FORBIDDEN)).toEqual(['x']);
    });
  });

  describe('GR-8(AG-10): 엔진·위젯·ml-worker에 guardrail·approval 토큰 0', () => {
    it('없다(대소문자 무시)', () => {
      for (const group of [engineSrc, widgetSrc, mlWorkerSrc]) {
        expect(filesWith(group, /guardrail|approval/i)).toEqual([]);
      }
    });

    it('역검증', () => {
      expect(filesWith([{ f: 'x', content: 'const guardrailStage = 1' }], /guardrail|approval/i)).toEqual(['x']);
    });
  });

  describe('GR-9(AG-11): 2인 승인 강제 지점 1곳', () => {
    const service = api.find(({ f }) => f.endsWith('environment/core/prod-switch.service.ts')) as Src;

    /** 강제 지점 규약을 검사한다: switchProd( 호출 앞에 assertApprovalSatisfied( 호출이 있고, 같은 $transaction 콜백 안에 claim( 이 있다. */
    function enforcementViolations(content: string): string[] {
      const code = stripComments(content);
      const problems: string[] = [];
      const switchIdx = code.indexOf('switchProd(');
      const assertIdx = code.indexOf('this.assertApprovalSatisfied(');
      if (switchIdx < 0) problems.push('switchProd( 없음');
      if (assertIdx < 0 || (switchIdx >= 0 && assertIdx > switchIdx)) problems.push('assertApprovalSatisfied( 가 switchProd( 앞에 없다');
      const txIdx = code.lastIndexOf('$transaction(', switchIdx);
      const tail = txIdx >= 0 ? code.slice(txIdx) : '';
      const txEnd = tail.indexOf('} catch');
      const txBody = txEnd > 0 ? tail.slice(0, txEnd) : tail;
      if (!/\.claim\(tx\)/.test(txBody)) problems.push('$transaction 콜백 안에 claim( 이 없다');
      return problems;
    }

    it('switchProd( 호출 파일은 prod-switch.service.ts 1개(승인 서비스·컨트롤러는 포인터를 직접 쓰지 않는다)', () => {
      expect(filesWith(api, /\bwriter\.switchProd\(/)).toEqual(['apps/api/src/environment/core/prod-switch.service.ts']);
      expect(filesWith(approvalSrc, /switchProd\(|\bchatbot\.updateMany\(/)).toEqual([]);
    });

    it('규약을 지킨다', () => {
      expect(enforcementViolations(service.content)).toEqual([]);
    });

    it('역검증 — 승인 확인이 없거나 claim이 트랜잭션 밖이면 잡는다', () => {
      const noAssert = 'async switch() { await this.prisma.$transaction(async (tx) => { const c = await this.writer.switchProd(tx, {}); await approval.claim(tx); }); }';
      expect(enforcementViolations(noAssert)).toEqual(['assertApprovalSatisfied( 가 switchProd( 앞에 없다']);
      const noClaim = 'async switch() { await this.assertApprovalSatisfied(); try { await this.prisma.$transaction(async (tx) => { await this.writer.switchProd(tx, {}); }); } catch (e) {} }';
      expect(enforcementViolations(noClaim)).toEqual(['$transaction 콜백 안에 claim( 이 없다']);
    });
  });

  describe('GR-10(AG-12): 승인 요청 전이 update*는 where에 status: \'PENDING\' 포함(CAS)', () => {
    const UPDATE = /prodSwitchApprovalRequest\.(update|updateMany)\(/g;

    /** 각 update* 호출 뒤 200자 안에 `status: 'PENDING'`이 없는 위치를 돌려준다. */
    function casViolations(content: string): number[] {
      const code = stripComments(content);
      const bad: number[] = [];
      for (const m of code.matchAll(UPDATE)) {
        const window = code.slice(m.index ?? 0, (m.index ?? 0) + 200);
        if (!/status:\s*'PENDING'/.test(window)) bad.push(m.index ?? 0);
      }
      return bad;
    }

    it('저장소 1파일의 모든 update*가 CAS다', () => {
      const store = fileOf(api, 'environment/approval/switch-approval.store.ts');
      expect((stripComments(store.content).match(UPDATE) ?? []).length).toBeGreaterThanOrEqual(3);
      expect(casViolations(store.content)).toEqual([]);
    });

    it('역검증', () => {
      expect(casViolations("await db.prodSwitchApprovalRequest.updateMany({ where: { id }, data: { status: 'APPROVED' } })")).toHaveLength(1);
    });
  });

  describe('GR-11(AG-13): 로그 인자 — logger 호출 줄에 문장 식별자 0', () => {
    const LOGGER_LINE = /logger\.(log|warn|error|debug)\(/;
    const FORBIDDEN_IDENT = /\$\{[^}]*\b(text|reason|note|expression|replacement|answer|question|userMessage)\b[^}]*\}|\b(text|reason|note|expression|replacement|answer|question|userMessage)\s*[,)]/;

    function violations(content: string): string[] {
      return content.split('\n').filter((line) => !isCommentLine(line) && LOGGER_LINE.test(line) && FORBIDDEN_IDENT.test(line));
    }

    it('guardrails/**·environment/approval/**에 없다', () => {
      expect(ownSrc.flatMap(({ f, content }) => violations(content).map((l) => `${f}: ${l.trim()}`))).toEqual([]);
    });

    it('역검증', () => {
      expect(violations('this.logger.warn(`실패: ${text}`)')).toHaveLength(1);
      expect(violations('this.logger.warn(`실패: chatbotId=${chatbotId} error=${name}`)')).toEqual([]);
    });
  });

  describe('GR-12(AG-14): 규칙은 대화 자산이 아니다 — 스냅샷·복사·승격·이전에 guardrailRule 토큰 0', () => {
    const TOKEN = /guardrailRule|GuardrailRule/;
    const targets = api.filter(
      ({ f }) =>
        f.startsWith('apps/api/src/versions/') ||
        f.startsWith('apps/api/src/asset-transfer/') ||
        /apps\/api\/src\/topics\/topic-split/.test(f) ||
        f === 'apps/api/src/environment/staging-promotion.service.ts',
    );

    it('없다', () => {
      expect(targets.length).toBeGreaterThan(10);
      expect(filesWith(targets, TOKEN)).toEqual([]);
    });

    it('chatbots.service.ts는 영구삭제 deleteMany 1줄만 허용(복사 등 다른 사용 0)', () => {
      const service = fileOf(api, 'chatbots/chatbots.service.ts');
      const lines = stripComments(service.content)
        .split('\n')
        .filter((l) => TOKEN.test(l));
      expect(lines.map((l) => l.trim())).toEqual(['await tx.guardrailRule.deleteMany({ where: { chatbotId: id } });']);
    });

    it('역검증', () => {
      expect(filesWith([{ f: 'x', content: 'tx.guardrailRule.findMany({})' }], TOKEN)).toEqual(['x']);
    });
  });

  describe('GR-13(AG-15): deploy-schedules/** 변경은 lib/outcome-classifier.ts 1파일 — approval 쓰기 0', () => {
    const schedules = api.filter(({ f }) => f.startsWith('apps/api/src/deploy-schedules/'));

    it('approval 토큰이 있는 파일은 outcome-classifier.ts뿐이고 승인 요청 모델을 건드리지 않는다', () => {
      expect(filesWith(schedules, /approval/i)).toEqual(['apps/api/src/deploy-schedules/lib/outcome-classifier.ts']);
      expect(filesWith(schedules, /prodSwitchApprovalRequest/)).toEqual([]);
    });

    it('역검증', () => {
      expect(filesWith([{ f: 'x', content: 'this.prisma.prodSwitchApprovalRequest.update({})' }], /prodSwitchApprovalRequest/)).toEqual(['x']);
    });
  });

  describe('GR-14(AG-18): 금지어 모듈 무수정 — banned-words/**에 guardrail 토큰 0', () => {
    const banned = api.filter(({ f }) => f.startsWith('apps/api/src/banned-words/'));

    it('없다', () => {
      expect(banned.length).toBeGreaterThan(3);
      expect(filesWith(banned, /guardrail/i)).toEqual([]);
    });

    it('역검증', () => {
      expect(filesWith([{ f: 'x', content: "import { X } from '../guardrails/x'" }], /guardrail/i)).toEqual(['x']);
    });
  });

  describe('AG-1·AG-17: 채널 어댑터 무변경 · EnvironmentCoreModule exports 불변', () => {
    it('conversation/adapters/**에 guardrail·approval 토큰 0', () => {
      const adapters = api.filter(({ f }) => f.startsWith('apps/api/src/conversation/adapters/'));
      expect(adapters.length).toBeGreaterThan(0);
      expect(filesWith(adapters, /guardrail|approval/i)).toEqual([]);
    });

    it('environment-core.module.ts exports = { ProdSwitchService, EnvironmentReadService } · 포인터 writer 미export', () => {
      const core = fileOf(api, 'environment/core/environment-core.module.ts');
      const match = core.content.match(/exports:\s*\[([^\]]*)\]/);
      expect(match).toBeTruthy();
      expect(new Set((match as RegExpMatchArray)[1].split(',').map((s) => s.trim()).filter(Boolean))).toEqual(new Set(['ProdSwitchService', 'EnvironmentReadService']));
    });

    it('GuardrailRuntimeModule exports = { GuardrailRuntimeService } 1개', () => {
      const runtime = fileOf(api, 'guardrails/runtime/guardrail-runtime.module.ts');
      const match = runtime.content.match(/exports:\s*\[([^\]]*)\]/);
      expect((match as RegExpMatchArray)[1].trim()).toBe('GuardrailRuntimeService');
    });
  });
});
