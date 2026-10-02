// 시작 · 구축형 구성 확인(30초) — 설계 §10.1. 말(주장)이 아니라 하네스가 확인한 값을 보인다(구성 카드 → 데이터 지도).
import { CONSOLE_TEXT } from '../selectors/console';
import type { SegmentDef, StepContext, StepDef } from '../scenario/types';

interface FactsJson {
  device: string;
  gpuHidden: boolean;
  latencyP95: number | null;
  externalAddresses: number;
  network: 'closed' | 'open' | 'unknown';
}

async function readFacts(ctx: StepContext): Promise<FactsJson> {
  const res = await fetch(`${ctx.urls.stage}/__facts`, { signal: AbortSignal.timeout(5_000) });
  return (await res.json()) as FactsJson;
}

/** 거버넌스 지도 API의 출구 목록 — 허용 1곳(임베딩 루프백) · 나머지 미설정 · 차단 0(모드 OFF면 집행 안 함). */
interface GovernanceMapJson {
  mode: 'ON' | 'OFF';
  egress: { exits: Array<{ exitId: string; decision: string; host: string | null }> };
}

export async function verifyGovernanceMap(ctx: StepContext): Promise<{ ok: boolean; expected: string; actual: string }> {
  const map = (await ctx.api.admin1.get('/governance/map')).body as GovernanceMapJson;
  const allowed = map.egress.exits.filter((e) => e.decision === 'ALLOWED');
  const blocked = map.egress.exits.filter((e) => e.decision === 'BLOCKED');
  const embeddingOk = allowed.length === 1 && allowed[0].exitId === 'EMBEDDING';
  const ok = map.mode === 'ON' ? embeddingOk && blocked.length === 0 : blocked.length === 0 && map.egress.exits.every((e) => e.decision !== 'ALLOWED');
  return {
    ok,
    expected: map.mode === 'ON' ? '허용 1곳(임베딩) · 차단 0' : '모드 꺼짐(집행 안 함)',
    actual: `모드 ${map.mode} · 허용 ${allowed.map((e) => e.exitId).join(',') || '없음'} · 차단 ${blocked.length}`,
  };
}

/** 데이터 지도 화면을 열고 출구 표가 그려질 때까지 기다린다(S0-02·S6-05 공용). */
export async function showGovernanceMap(ctx: StepContext): Promise<void> {
  await ctx.console.getByRole('heading', { name: CONSOLE_TEXT.governance.egressTitle }).first().waitFor({ state: 'visible', timeout: 15_000 });
  await ctx.console.getByRole('row').filter({ hasText: '임베딩' }).first().waitFor({ state: 'visible', timeout: 10_000 });
}

const steps: StepDef[] = [
  {
    id: 'S0-01',
    title: '구축형 구성 카드',
    narration: ['이 노트북 한 대를 사내 서버로 가정했습니다', 'AI 문장 분석은 GPU 없이 CPU로 돕니다'],
    // 시연용으로 바꾼 설정이 있을 때만 안내 줄을 보인다(설계 §14 · FR-DH9-3).
    dynamicDisclosure: (ctx) => {
      if (ctx.facts.governanceFallback) return '이번 시연은 데이터 통제 모드를 끈 상태입니다';
      if (ctx.facts.embeddingTimeoutMs !== ctx.facts.embeddingTimeoutDefault) return `문장 분석 대기 시간을 ${ctx.facts.embeddingTimeoutMs}ms로 늘렸습니다`;
      return undefined;
    },
    badges: ['ONPREM_INSTALL', 'CPU_ONLY'],
    budgetSec: 15,
    driver: 'UI',
    layout: 'card',
    core: true,
    skippable: false,
    capture: 'screenshot',
    async run(ctx) {
      await ctx.stage.showCard('system');
      const card = ctx.page.frameLocator('#card-frame');
      await card.getByRole('heading', { level: 1, name: /구축형 구성 확인/ }).waitFor({ state: 'visible', timeout: 15_000 });
      await card.getByRole('heading', { level: 2, name: '3 외부로 보내지 않음' }).waitFor({ state: 'visible', timeout: 15_000 });
    },
    async verify(ctx) {
      // 카드의 값 = 하네스 상태(값이 비면 항상 "확인 못함" 계열 문구 — 빈 값 0)
      const f = await readFacts(ctx);
      const text = await ctx.page.frameLocator('#card-frame').locator('body').innerText();
      const want = [f.device, f.latencyP95 === null ? '측정하지 못했습니다' : `${Math.round(f.latencyP95)}ms`, `${f.externalAddresses}개`];
      const missing = want.filter((w) => !text.includes(w));
      return { ok: missing.length === 0, expected: `카드에 ${want.join(' · ')}`, actual: missing.length === 0 ? '모두 표시' : `없음: ${missing.join(', ')}` };
    },
  },
  {
    id: 'S0-02',
    title: '데이터 지도',
    narration: ['데이터가 나가는 출구는', '같은 PC의 문장 분석 서버 1곳뿐입니다'],
    badges: ['NO_EXTERNAL_SEND'],
    budgetSec: 15,
    driver: 'UI',
    account: 'admin1',
    layout: 'console',
    console: () => '/settings/data-governance/map',
    core: false,
    skippable: true,
    capture: 'none',
    async run(ctx) {
      await showGovernanceMap(ctx);
    },
    async verify(ctx) {
      return verifyGovernanceMap(ctx);
    },
  },
];

export const openingSegment: Pick<SegmentDef, 'steps' | 'skipOrder'> = {
  steps,
  skipOrder: ['S0-02'],
};
