// [DT-2] 풀 투어 ⑥ 개인정보와 안전(100) — 설계 §9.4. DT-1 S6-01~06 그대로(S6-05는 계획별 기대 출구로 변형) + S6-07 "기록만" 규칙 · S6-08 가드레일 현황.
// 위기·자해 분류는 쓰지 않는다(FR-DH4-9). S6-07의 질문은 DT-1 질문(S6-01·S6-03)에 걸리지 않는 표현이라 S6-04 검증("1건")이 불변이다.
import { GUARDRAIL_A } from '../../data/dataset';
import { MONITOR_QUESTION } from '../../data/dataset-full';
import { CONSOLE_TEXT } from '../../selectors/console';
import type { SegmentDef, StepContext, StepDef } from '../../scenario/types';
import { askWidget, norm } from '../helpers';
import { s6Segment } from '../s6';
import { derive } from './derive';
import { verifyGovernanceMapPlan } from './opening-full';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function kstRange(): { from: string; to: string } {
  const kstToday = new Date(Date.now() + 9 * 3_600_000);
  const to = kstToday.toISOString().slice(0, 10);
  const from = new Date(kstToday.getTime() - 6 * 86_400_000).toISOString().slice(0, 10);
  return { from, to };
}

/** 걸린 기록 중 동작별 건수(API · 최근 7일). */
async function eventCount(ctx: StepContext, action: 'MONITOR' | 'REPLACE'): Promise<number> {
  const r = (await ctx.api.admin1.get(`/chatbots/${ctx.ids.A.id}/guardrails/events`, { query: { ...kstRange(), pageSize: 100 } })).body as { items?: Array<{ appliedAction?: string }> };
  return (r.items ?? []).filter((e) => e.appliedAction === action).length;
}

const s606: StepDef = {
  id: 'S6-07',
  title: '기록만 하는 규칙',
  narration: ['기록만 하는 규칙은 답을 막지 않고 남기기만 합니다'],
  budgetSec: 15,
  driver: 'UI',
  account: 'admin1',
  layout: 'split',
  site: 'A',
  core: false,
  skippable: true,
  capture: 'none',
  async run(ctx) {
    ctx.scratch.set('s6-07-before', await eventCount(ctx, 'MONITOR'));
    ctx.scratch.set('s6-07-answer', await askWidget(ctx, MONITOR_QUESTION, 15_000));
  },
  async verify(ctx) {
    const said = String(ctx.scratch.get('s6-07-answer') ?? '');
    // 기록만(MONITOR) 규칙은 답을 막지 않는다 — 안전 문구로 대체되지 않고 정상 답(또는 폴백)이 나온다
    const notReplaced = said.length > 0 && norm(said) !== norm(GUARDRAIL_A.replacementText);
    const before = Number(ctx.scratch.get('s6-07-before') ?? 0);
    // 걸린 기록은 응답 뒤에 쌓인다 — 조건 대기
    const after = await ctx.waitFor(async () => {
      const n = await eventCount(ctx, 'MONITOR');
      return n >= before + 1 ? n : false;
    }, { timeoutMs: 15_000, intervalMs: 500, label: '걸린 기록(기록만) 1건 추가' }).catch(() => before);
    return { ok: notReplaced && after >= before + 1, expected: '답은 막히지 않음 · 기록만 1건 추가', actual: `${notReplaced ? '정상 답' : '안전 문구로 대체됨'} · 기록만 ${before} -> ${after}건` };
  },
};

const s608: StepDef = {
  id: 'S6-08',
  title: '가드레일 현황',
  narration: ['모델 판정 없이 정해 둔 규칙으로만 동작합니다'],
  budgetSec: 15,
  driver: 'UI',
  account: 'admin1',
  layout: 'console',
  console: (ids) => `/chatbots/${ids.A.id}/guardrails/overview`,
  core: true,
  skippable: false,
  capture: 'screenshot',
  async run(ctx) {
    const G = CONSOLE_TEXT.guardrailOverview;
    await ctx.console.getByRole('heading', { name: G.title }).first().waitFor({ state: 'visible', timeout: 15_000 });
    const label = ctx.console.getByText(G.replacedLabel, { exact: false }).first();
    await label.waitFor({ state: 'visible', timeout: 15_000 });
    await label.scrollIntoViewIfNeeded();
  },
  async verify(ctx) {
    // API 현황: 규칙 2개 · 안전 문구로 바뀜 ≥ 1(S6-03) · 기록만 = S6-07을 실행했으면 ≥ 1
    const o = (await ctx.api.admin1.get(`/chatbots/${ctx.ids.A.id}/guardrails/overview`)).body as Json;
    const rules = (o.rules ?? []) as Array<{ currentAction: string | null; deleted: boolean }>;
    const live = rules.filter((r) => !r.deleted).length;
    const ranMonitor = ctx.scratch.has('s6-07-answer');
    const ok = live >= 2 && Number(o.totals?.replaced ?? 0) >= 1 && (!ranMonitor || Number(o.totals?.monitored ?? 0) >= 1);
    return { ok, expected: `규칙 2 · 안전 문구로 바뀜 ≥ 1${ranMonitor ? ' · 기록만 ≥ 1' : ''}`, actual: `규칙 ${live} · 바뀜 ${o.totals?.replaced} · 기록만 ${o.totals?.monitored}` };
  },
};

export const s6FullSegment: Pick<SegmentDef, 'steps' | 'skipOrder'> = {
  steps: [
    ...s6Segment.steps.map((st) =>
      st.id === 'S6-05'
        ? derive(st, {
            narration: ['외부 출구는 모두 이 PC 안의 서버뿐입니다'],
            async verify(ctx) {
              return verifyGovernanceMapPlan(ctx);
            },
          })
        : st,
    ),
    s606,
    s608,
  ],
  skipOrder: ['S6-07', 'S6-06', 'S6-04', 'S6-05'],
};
