// 마무리 · 로드맵(15초) — 설계 §10.9. 오늘 보여 드리지 않는 기능을 하네스가 만든 정적 페이지 1장으로 정직하게 안내한다(목업 0 · 일정 약속 0).
// [DT-2 FR-DX0-1] 로드맵 행은 `data/roadmap.ts` 한 곳에서 오며, 구현이 끝난 기능(No.32)은 "시연 불가"로 쓰지 않는다.
import { ROADMAP, ROADMAP_STATUS_LABEL } from '../data/roadmap';
import type { SegmentDef, StepDef } from '../scenario/types';

/** 로드맵 슬라이드의 "시연 완료" 목록 항목 수(장면 1~7). */
const DONE_LIST_ITEMS = 7;

const steps: StepDef[] = [
  {
    id: 'S9-01',
    title: '로드맵',
    narration: ['오늘 보여 드리지 않는 기능입니다', '개발 상태만 안내합니다'],
    disclosure: '출시 일정은 약속하지 않습니다',
    budgetSec: 12,
    driver: 'UI',
    layout: 'card',
    core: true,
    skippable: false,
    capture: 'screenshot',
    async run(ctx) {
      await ctx.stage.showCard('roadmap');
      const card = ctx.page.frameLocator('#card-frame');
      await card.getByRole('heading', { level: 1, name: /마무리/ }).waitFor({ state: 'visible', timeout: 15_000 });
      await card.getByRole('listitem').first().waitFor({ state: 'visible', timeout: 15_000 });
    },
    async verify(ctx) {
      // 행 수 = 데이터 파일의 행 수 + 시연 완료 7개 / 각 행의 상태 칩 문구가 데이터와 같다
      const card = ctx.page.frameLocator('#card-frame');
      const items = await card.getByRole('listitem').allInnerTexts();
      const expectedCount = DONE_LIST_ITEMS + ROADMAP.length;
      const missing = ROADMAP.filter((r) => !items.some((t) => t.includes(`No.${r.featureNo}`) && t.includes(ROADMAP_STATUS_LABEL[r.status])));
      return {
        ok: items.length === expectedCount && missing.length === 0,
        expected: `목록 ${expectedCount}개 · 로드맵 ${ROADMAP.length}행 모두 데이터와 같은 상태 문구`,
        actual: `목록 ${items.length}개${missing.length > 0 ? ` · 불일치 ${missing.map((m) => `No.${m.featureNo}`).join(', ')}` : ''}`,
      };
    },
  },
  {
    id: 'S9-02',
    title: '예약 실행 재확인',
    narration: ['예약 결과를 확인합니다'],
    budgetSec: 3,
    driver: 'API',
    layout: 'card',
    core: false,
    skippable: true,
    capture: 'none',
    async run(ctx) {
      // 장면 5의 예약 단계가 대체 화면이었다면, 공연 중에 예약이 실제로 실행됐는지 한 번 조회해 보고서에 남긴다(화면 변화 없음).
      const live = ctx.state.liveSchedule;
      if (!live || live.status !== 'CREATED' || !live.scheduleId || live.finalStatus === 'SUCCEEDED') return;
      const s = (await ctx.api.admin1.get(`/chatbots/${ctx.ids.C.id}/deploy-schedules/${live.scheduleId}`)).body as { status?: string };
      live.finalStatus = s.status ?? 'UNKNOWN';
    },
  },
];

export const closingSegment: Pick<SegmentDef, 'steps' | 'skipOrder'> = {
  steps,
  skipOrder: ['S9-02'],
};
