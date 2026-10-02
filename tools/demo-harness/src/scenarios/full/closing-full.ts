// [DT-2] 풀 투어 끝(20) — 설계 §9.10. S9-01 로드맵은 풀 투어 변형(`/roadmap?preset=full`): 활성 장면 목록 + 오늘 시연한 기능 번호를 뺀 로드맵 행 + "이 PC 구성에서 생략한 장면" 띠.
// S9-02(예약 재확인)는 DT-1 그대로. 고객 화면의 생략 사유에는 옵션 이름·포트를 쓰지 않는다(보고서 내부판에만).
import { ROADMAP, ROADMAP_STATUS_LABEL } from '../../data/roadmap';
import type { SegmentDef, StepContext, StepDef } from '../../scenario/types';
import { closingSegment } from '../closing';
import { derive, pick } from './derive';

interface PlanFactsLite {
  plan?: { sceneTitles: string[]; omittedLines: string[]; demonstratedNos: number[] };
}

async function readPlan(ctx: StepContext): Promise<NonNullable<PlanFactsLite['plan']> | null> {
  const res = await fetch(`${ctx.urls.stage}/__facts`, { signal: AbortSignal.timeout(5_000) });
  const j = (await res.json()) as PlanFactsLite;
  return j.plan ?? null;
}

const s901 = derive(pick(closingSegment.steps, 'S9-01'), {
  budgetSec: 17,
  async run(ctx) {
    await ctx.stage.showCard('roadmap', { preset: 'full' });
    const card = ctx.page.frameLocator('#card-frame');
    await card.getByRole('heading', { level: 1, name: /마무리/ }).waitFor({ state: 'visible', timeout: 15_000 });
    await card.getByRole('listitem').first().waitFor({ state: 'visible', timeout: 15_000 });
  },
  async verify(ctx) {
    // 목록 수 = 활성 장면 수 + 로드맵 행 수 + 생략 줄 수(없으면 "생략한 장면은 없습니다" 1줄) · 각 로드맵 행의 상태 칩 문구 = 데이터
    const plan = await readPlan(ctx);
    if (!plan) return { ok: false, expected: '계획 요약(/__facts.plan)', actual: '없음' };
    const rows = ROADMAP.filter((r) => !plan.demonstratedNos.includes(r.featureNo));
    const card = ctx.page.frameLocator('#card-frame');
    const items = await card.getByRole('listitem').allInnerTexts();
    const expectedCount = plan.sceneTitles.length + rows.length + Math.max(1, plan.omittedLines.length);
    const missing = rows.filter((r) => !items.some((t) => t.includes(`No.${r.featureNo}`) && t.includes(ROADMAP_STATUS_LABEL[r.status])));
    const omitMissing = plan.omittedLines.filter((l) => !items.some((t) => t.includes(l)));
    return {
      ok: items.length === expectedCount && missing.length === 0 && omitMissing.length === 0,
      expected: `목록 ${expectedCount}개(장면 ${plan.sceneTitles.length} + 로드맵 ${rows.length} + 생략 ${Math.max(1, plan.omittedLines.length)}) · 상태 문구 일치`,
      actual: `목록 ${items.length}개${missing.length > 0 ? ` · 불일치 ${missing.map((m) => `No.${m.featureNo}`).join(', ')}` : ''}${omitMissing.length > 0 ? ` · 생략 줄 없음 ${omitMissing.length}` : ''}`,
    };
  },
});

const s902: StepDef = pick(closingSegment.steps, 'S9-02');

export const closingFullSegment: Pick<SegmentDef, 'steps' | 'skipOrder'> = {
  steps: [s901, s902],
  skipOrder: ['S9-02'],
};
