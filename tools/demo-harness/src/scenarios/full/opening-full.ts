// [DT-2] 풀 투어 시작(40초) — 설계 §9.1. DT-1 S0-01·S0-02를 파생하고(원본 불변) 계획 문맥으로 사실을 채운다.
//  - S0-01: 장치(G) 유무로 자막 변형 2개(같은 ID · 계획마다 1개만 활성) · 안내 줄은 장치 선택·대체 > 시연용 설정 > GPU 사용 알림
//  - S0-02: 검증을 "계획별 기대 출구 집합"으로(허용 = 문장 분석 ∪ 음성 인식(real) ∪ 소형 생성(llm) · 차단 0)
import { showGovernanceMap, openingSegment } from '../opening';
import type { SegmentDef, StepContext, StepDef } from '../../scenario/types';
import type { PlanContext } from '../../scenario/plan';
import { derive } from './derive';
import { isSttGpu, S0_01_NARRATION_CPU, S0_01_NARRATION_GPU, s001Disclosure, s002Disclosure } from './text';

interface FactsJson {
  device: string;
  gpuHidden: boolean;
  latencyP95: number | null;
  externalAddresses: number;
  network: 'closed' | 'open' | 'unknown';
  plan?: { servers: string[]; gpuUse: string; gpuUseText: string; egressNames: string[] };
}

async function readFacts(ctx: StepContext): Promise<FactsJson> {
  const res = await fetch(`${ctx.urls.stage}/__facts`, { signal: AbortSignal.timeout(5_000) });
  return (await res.json()) as FactsJson;
}

/** 계획별 기대 출구 ID(제품 `EgressExitId`) — 문장 분석은 항상, 음성 인식·소형 생성은 켠 계획만. */
export function expectedExitIds(p: Pick<PlanContext, 'voiceInput' | 'localLlm'>): string[] {
  const ids = ['EMBEDDING'];
  if (p.voiceInput === 'real') ids.push('SPEECH_LOCAL');
  if (p.localLlm) ids.push('AUGMENT_LOCAL');
  return ids;
}

interface GovernanceMapJson {
  mode: 'ON' | 'OFF';
  egress: { exits: Array<{ exitId: string; decision: string; host: string | null }> };
}

/** 데이터 지도 검증(S0-02 · S6-05 풀 투어 변형) — 허용 출구 집합 = 계획 기대값 · 차단 0. */
export async function verifyGovernanceMapPlan(ctx: StepContext): Promise<{ ok: boolean; expected: string; actual: string }> {
  const map = (await ctx.api.admin1.get('/governance/map')).body as GovernanceMapJson;
  const allowed = map.egress.exits.filter((e) => e.decision === 'ALLOWED').map((e) => e.exitId).sort();
  const blocked = map.egress.exits.filter((e) => e.decision === 'BLOCKED');
  const want = [...expectedExitIds(ctx.plan)].sort();
  const ok = map.mode === 'ON' ? allowed.join(',') === want.join(',') && blocked.length === 0 : blocked.length === 0 && map.egress.exits.every((e) => e.decision !== 'ALLOWED');
  return {
    ok,
    expected: map.mode === 'ON' ? `허용 ${want.length}곳(${want.join(',')}) · 차단 0` : '모드 꺼짐(집행 안 함)',
    actual: `모드 ${map.mode} · 허용 ${allowed.join(',') || '없음'} · 차단 ${blocked.length}`,
  };
}

const [s001Base, s002Base] = openingSegment.steps;

function s001(variant: 'cpu' | 'gpu'): StepDef {
  return derive(s001Base, {
    budgetSec: 20,
    narration: variant === 'gpu' ? S0_01_NARRATION_GPU : S0_01_NARRATION_CPU,
    when: (p) => (variant === 'gpu' ? isSttGpu(p) : !isSttGpu(p)),
    inactive: 'variant',
    dynamicDisclosure: (ctx) => s001Disclosure(ctx.plan, ctx.facts),
    facts: ['GPU_USED'],
    async verify(ctx) {
      // 카드의 값 = 하네스 상태(+ 풀 투어 계획 값) — 값이 비면 항상 "확인 못함" 계열 문구(빈 값 0)
      const f = await readFacts(ctx);
      const text = await ctx.page.frameLocator('#card-frame').locator('body').innerText();
      const want = [f.device, f.latencyP95 === null ? '측정하지 못했습니다' : `${Math.round(f.latencyP95)}ms`, `${f.externalAddresses}개`];
      if (f.plan) want.push(`서버 ${f.plan.servers.length}개`, `${f.plan.egressNames.length}곳`);
      if (f.plan && f.plan.gpuUse !== 'none') want.push(f.plan.gpuUseText);
      const missing = want.filter((w) => !text.includes(w));
      return { ok: missing.length === 0, expected: `카드에 ${want.join(' · ')}`, actual: missing.length === 0 ? '모두 표시' : `없음: ${missing.join(', ')}` };
    },
  });
}

const s002: StepDef = derive(s002Base, {
  budgetSec: 20,
  narration: ['데이터가 나가는 출구는 모두 이 PC 안입니다'],
  dynamicDisclosure: (ctx) => s002Disclosure(ctx.plan),
  async run(ctx) {
    await showGovernanceMap(ctx);
  },
  async verify(ctx) {
    return verifyGovernanceMapPlan(ctx);
  },
});

export const openingFullSegment: Pick<SegmentDef, 'steps' | 'skipOrder'> = {
  steps: [s001('cpu'), s001('gpu'), s002],
  skipOrder: ['S0-02'],
};
