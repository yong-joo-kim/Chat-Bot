// 장면 2 · 상담원 인계(80초) — 설계 §10.3. 챗봇이 연속으로 답하지 못하면 상담원 화면에 경고가 뜨고, 상담원이 개입하면 챗봇 응답이 멈춘다.
import { CANNED_A, SCENE_TEXT } from '../data/dataset';
import { consoleUi, CONSOLE_TEXT } from '../selectors/console';
import { widget } from '../selectors/widget';
import type { SegmentDef, StepContext, StepDef } from '../scenario/types';
import { askWidget, norm } from './helpers';

const livePath = (ids: { A: { id: string } }) => `/handoff-console/${ids.A.id}/live`;

/** 진행 중 세션 목록에서 마지막 발화로 행을 찾는다(고유 문장 — 데이터셋이 보장). */
function liveRow(ctx: StepContext, lastMessage: string) {
  return ctx.console.getByRole('row').filter({ hasText: lastMessage }).first();
}

const steps: StepDef[] = [
  {
    id: 'S2-01',
    title: '첫 번째 못 알아들음',
    narration: ['고객이 사람과 이야기하고 싶어 합니다'],
    budgetSec: 10,
    driver: 'UI',
    account: 'admin1',
    layout: 'split',
    site: 'A',
    core: true,
    skippable: false,
    capture: 'none',
    async run(ctx) {
      // 새 대화 세션으로 시작한다 — 장면 1의 대화가 섞이지 않게 위젯 세션 저장소를 비우고 모형을 다시 연다
      await ctx.page.evaluate(() => {
        window.sessionStorage.clear();
        window.localStorage.clear();
      });
      await ctx.openSite(ctx.ids.A.slug);
      ctx.scratch.set('s2-01', await askWidget(ctx, SCENE_TEXT.handoff1));
    },
    async verify(ctx) {
      const said = String(ctx.scratch.get('s2-01') ?? '');
      return { ok: said.length > 0 && !said.includes('상담원이 연결'), expected: '챗봇이 답하지 못함', actual: said };
    },
  },
  {
    id: 'S2-02',
    title: '두 번째 못 알아들음',
    narration: ['같은 대화에서 두 번 연속 답하지 못했습니다'],
    budgetSec: 10,
    driver: 'UI',
    layout: 'split',
    core: true,
    skippable: false,
    capture: 'none',
    async run(ctx) {
      ctx.scratch.set('s2-02', await askWidget(ctx, SCENE_TEXT.handoff2));
    },
    async verify(ctx) {
      const first = norm(String(ctx.scratch.get('s2-01') ?? ''));
      const second = norm(String(ctx.scratch.get('s2-02') ?? ''));
      return { ok: second.length > 0 && second === first, expected: '두 번 모두 같은 "답하지 못함" 문구', actual: second };
    },
  },
  {
    id: 'S2-03',
    title: '경고 표시',
    narration: ['상담원 화면에 경고 표시된 대화가 나타납니다'],
    budgetSec: 12,
    driver: 'UI',
    account: 'agent',
    layout: 'split',
    console: livePath,
    core: true,
    skippable: false,
    capture: 'screenshot',
    async run(ctx) {
      // 목록은 5초마다 갱신된다 — 행이 나타날 때까지 대기(상한 15초)
      await ctx.waitFor(async () => (await liveRow(ctx, SCENE_TEXT.handoff2).count()) > 0, { timeoutMs: 15_000, intervalMs: 500, label: '진행 중 세션 목록의 경고 행' });
    },
    async verify(ctx) {
      const text = await liveRow(ctx, SCENE_TEXT.handoff2).innerText();
      return { ok: text.includes('경고'), expected: '행에 "경고" 표시', actual: norm(text).slice(0, 80) };
    },
  },
  {
    id: 'S2-04',
    title: '상담원 개입',
    narration: ['상담원이 대화를 맡으면 챗봇 응답이 멈춥니다'],
    budgetSec: 12,
    driver: 'UI',
    layout: 'split',
    core: true,
    skippable: false,
    capture: 'none',
    async run(ctx) {
      await liveRow(ctx, SCENE_TEXT.handoff2).getByRole('link').first().click();
      const intervene = ctx.console.getByRole('button', { name: '개입하기', exact: true }).first();
      await intervene.waitFor({ state: 'visible', timeout: 10_000 });
      await intervene.click();
      // 확인 대화상자의 같은 이름 버튼은 대화상자 범위로 한정한다
      await consoleUi.dialog(ctx.console).getByRole('button', { name: '개입하기', exact: true }).click();
      await ctx.console.getByRole('button', { name: '상담 종료', exact: true }).first().waitFor({ state: 'visible', timeout: 10_000 });
    },
  },
  {
    id: 'S2-05',
    title: '자주 쓰는 문장',
    narration: ['자주 쓰는 문장을 바로 넣을 수 있습니다'],
    budgetSec: 12,
    driver: 'UI',
    layout: 'split',
    core: false,
    skippable: true,
    capture: 'none',
    async run(ctx) {
      // 힌트 카드(문장 + 복사/입력창에 넣기 버튼)에서 단추를 찾는다 — 문장 텍스트에서 가장 가까운 버튼 포함 조상으로 한정
      const text = ctx.console.getByText(CANNED_A[0].body, { exact: true }).first();
      await text.waitFor({ state: 'visible', timeout: 10_000 });
      await text.locator('xpath=ancestor::*[.//button][1]').getByRole('button', { name: '입력창에 넣기', exact: true }).click();
    },
  },
  {
    id: 'S2-06',
    title: '상담원 메시지 도착',
    narration: ['상담원이 보낸 말이 고객 화면에 바로 도착합니다'],
    budgetSec: 14,
    driver: 'UI',
    layout: 'split',
    core: true,
    skippable: false,
    capture: 'gif-clip',
    async run(ctx) {
      const box = ctx.console.getByRole('textbox', { name: '메시지', exact: true });
      await box.waitFor({ state: 'visible', timeout: 10_000 });
      if (!(await box.inputValue())) await ctx.pace.type(box, CANNED_A[0].body);

      ctx.scratch.set('s2-06-sent', (await box.inputValue()).trim());
      await ctx.console.getByRole('button', { name: '전송', exact: true }).first().click();
      // 위젯은 상담 폴링으로 받는다(상한 15초)
      await ctx.waitFor(async () => (await widget.agentMessages(ctx.site).count()) > 0, { timeoutMs: 15_000, intervalMs: 500, label: '위젯의 상담원 말풍선' });
    },
    async verify(ctx) {
      const sent = norm(String(ctx.scratch.get('s2-06-sent') ?? ''));
      const got = norm((await widget.agentMessages(ctx.site).last().innerText()) ?? '');
      return { ok: got.includes(sent) && sent.length > 0, expected: sent, actual: got };
    },
    fallback: { caption: '연결이 지연되어 콘솔 화면으로 대신 보여 드립니다' },
  },
  {
    id: 'S2-07',
    title: '상담 종료와 이력',
    narration: ['상담 기록은 사내 데이터베이스에만 남습니다'],
    badges: ['ONPREM_STORAGE'],
    budgetSec: 10,
    driver: 'UI',
    layout: 'split',
    console: undefined,
    core: false,
    skippable: true,
    capture: 'none',
    async run(ctx) {
      await ctx.console.getByRole('button', { name: '상담 종료', exact: true }).first().click();
      await consoleUi.dialog(ctx.console).getByRole('button', { name: '상담 종료', exact: true }).click();
      await ctx.openConsole(`/handoff-console/${ctx.ids.A.id}/history`);
      await ctx.console.getByRole('row').nth(1).waitFor({ state: 'visible', timeout: 10_000 });
    },
  },
];

void CONSOLE_TEXT;

export const s2Segment: Pick<SegmentDef, 'steps' | 'skipOrder'> = {
  steps,
  skipOrder: ['S2-05', 'S2-07'],
};
