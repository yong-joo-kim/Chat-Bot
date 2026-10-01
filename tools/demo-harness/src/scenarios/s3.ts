// 장면 3 · 통계와 대시보드(55초) — 설계 §10.4. 방금 나눈 대화가 바로 집계된다는 것을 API 수치와 화면으로 함께 확인한다(로그 적재는 발사 후 망각이라 조건 대기).
import type { SegmentDef, StepContext, StepDef } from '../scenario/types';

interface StatsTotals {
  turnCount: number;
  unansweredCount: number;
}

/** 공연 시작 직전에 runShow가 기록한 통계 기준값(없으면 0 — `--only s3`처럼 앞 장면을 안 돌린 경우). */
function baseline(ctx: StepContext): StatsTotals {
  const b = (ctx.state as { statsBaseline?: StatsTotals }).statsBaseline;
  return b ?? { turnCount: 0, unansweredCount: 0 };
}

async function currentTotals(ctx: StepContext): Promise<StatsTotals> {
  const r = (await ctx.api.admin1.get(`/stats/summary`, { query: { chatbotId: ctx.ids.A.id } })).body as { totals: StatsTotals };
  return r.totals;
}

const steps: StepDef[] = [
  {
    id: 'S3-01',
    title: '반영 확인',
    narration: ['방금 나눈 대화가 집계에 들어왔는지 확인합니다'],
    budgetSec: 5,
    driver: 'API',
    account: 'admin1',
    layout: 'console',
    core: true,
    skippable: false,
    capture: 'none',
    async run(ctx) {
      const base = baseline(ctx);
      const turns = Number(ctx.scratch.get('widgetTurns') ?? 0);
      const unanswered = Number(ctx.scratch.get('widgetUnanswered') ?? 0);
      // 로그 적재는 응답 뒤에 일어난다 — 조건 대기(상한 10초)
      const t = await ctx.waitFor(
        async () => {
          const cur = await currentTotals(ctx);
          return cur.turnCount >= base.turnCount + turns && cur.unansweredCount >= base.unansweredCount + unanswered ? cur : false;
        },
        { timeoutMs: 10_000, intervalMs: 500, label: '통계 반영(대화 수·미응답 수)' },
      );
      ctx.scratch.set('s3-totals', t);
    },
  },
  {
    id: 'S3-02',
    title: '대시보드',
    narration: ['방금 나눈 대화가 바로 집계됩니다'],
    disclosure: '지난 14일 그래프는 시연용 과거 데이터입니다',
    budgetSec: 20,
    driver: 'UI',
    layout: 'console',
    console: (ids) => `/chatbots/${ids.A.id}/dashboard`,
    core: true,
    skippable: false,
    capture: 'screenshot',
    async run(ctx) {
      await ctx.console.getByText('접속수', { exact: true }).first().waitFor({ state: 'visible', timeout: 10_000 });
      await ctx.console.getByText(/집계 \d+건/).first().waitFor({ state: 'visible', timeout: 10_000 });
    },
    async verify(ctx) {
      const text = await ctx.console.getByText(/집계 \d+건/).first().innerText();
      const shown = Number(/집계 (\d+)건/.exec(text)?.[1] ?? NaN);
      const api = (await ctx.api.admin1.get(`/stats/dashboard`, { query: { chatbotId: ctx.ids.A.id } })).body as { totalLogCount: number };
      return { ok: shown === api.totalLogCount && shown > 0, expected: `집계 ${api.totalLogCount}건(API)`, actual: `화면 ${shown}건` };
    },
  },
  {
    id: 'S3-03',
    title: '응답 출처 분포',
    narration: ['규칙·FAQ·의미 매칭·답하지 못함 비율을 봅니다'],
    budgetSec: 15,
    driver: 'UI',
    layout: 'console',
    console: (ids) => `/chatbots/${ids.A.id}/stats/overview`,
    core: true,
    skippable: false,
    capture: 'screenshot',
    async run(ctx) {
      const heading = ctx.console.getByText('응답 출처 분포', { exact: true }).first();
      await heading.waitFor({ state: 'visible', timeout: 15_000 });
      await heading.scrollIntoViewIfNeeded();
    },
  },
  {
    id: 'S3-04',
    title: '통합 통계',
    narration: ['여러 챗봇을 한 화면에서 비교합니다'],
    budgetSec: 15,
    driver: 'UI',
    layout: 'console',
    console: () => '/',
    core: false,
    skippable: true,
    capture: 'none',
    async run(ctx) {
      await ctx.console.getByRole('heading', { name: '통합 통계' }).first().waitFor({ state: 'visible', timeout: 10_000 });
    },
  },
];

export const s3Segment: Pick<SegmentDef, 'steps' | 'skipOrder'> = {
  steps,
  skipOrder: ['S3-04'],
};
