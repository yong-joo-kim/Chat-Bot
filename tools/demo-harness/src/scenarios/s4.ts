// 장면 4 · 학습 개선 루프(95초) — 설계 §10.5. 챗봇이 못 알아들은 질문을 사람이 확인해 예문으로 확정하고, 회귀 시험으로 개선을 확인한다(자동 반영 없음).
import { INTENTS_A, SCENE_TEXT } from '../data/dataset';
import { consoleUi, CONSOLE_TEXT } from '../selectors/console';
import type { SegmentDef, StepContext, StepDef } from '../scenario/types';
import { runValidationAndWait } from '../data/generator';

const learningPath = (ids: { A: { id: string } }) => `/chatbots/${ids.A.id}/stats/learning`;

/** 규칙 기반 생성(G1)은 결정적이지만 예문이 바뀌면 후보가 달라질 수 있다 — 리허설로 고정한 허용 목록에 든 후보만 승인한다(설계 A-9). */
const AUGMENT_ALLOW = ['송장 번호로 조회할래요', '배송 조회'];

function queueRow(ctx: StepContext) {
  return ctx.console.getByRole('row').filter({ hasText: SCENE_TEXT.notYetArrived }).first();
}

const steps: StepDef[] = [
  {
    id: 'S4-01',
    title: '미응답 큐',
    narration: ['챗봇이 못 알아들었던 질문이 쌓여 있습니다'],
    budgetSec: 15,
    driver: 'UI',
    account: 'admin1',
    layout: 'console',
    console: learningPath,
    core: true,
    skippable: false,
    capture: 'screenshot',
    async run(ctx) {
      // 미응답 수집은 응답 뒤 비동기 — 행이 나타날 때까지 새로고침 없이 대기(상한 15초, 목록은 주기 갱신이 없어 필요하면 다시 연다)
      await ctx.waitFor(
        async () => {
          if ((await queueRow(ctx).count()) > 0) return true;
          await ctx.openConsole(learningPath(ctx.ids));
          return false;
        },
        { timeoutMs: 20_000, intervalMs: 1000, label: '미응답 큐의 "물건이 아직 안 왔어요" 행' },
      );
    },
    async verify(ctx) {
      const text = await queueRow(ctx).innerText();
      return { ok: text.includes('배송조회'), expected: '행 존재(추천 의도 배송조회)', actual: text.replace(/\s+/g, ' ').slice(0, 100) };
    },
  },
  {
    id: 'S4-02',
    title: '사람이 반영',
    narration: ['관리자가 확인하고 예문으로 확정합니다', '자동으로 반영되는 것은 없습니다'],
    badges: ['HUMAN_APPROVAL'],
    budgetSec: 20,
    driver: 'UI',
    layout: 'console',
    core: true,
    skippable: false,
    capture: 'none',
    async run(ctx) {
      await queueRow(ctx).getByRole('button', { name: '반영', exact: true }).click();
      const dlg = consoleUi.dialog(ctx.console);
      await dlg.waitFor({ state: 'visible', timeout: 10_000 });
      const field = dlg.getByLabel('반영할 의도');
      await ctx.pace.type(field, INTENTS_A[0].name);
      await dlg.getByText('기존 의도', { exact: false }).first().waitFor({ state: 'visible', timeout: 10_000 });
      await dlg.getByRole('button', { name: '반영', exact: true }).click();
      await ctx.console.getByText(/반영 완료|학습 대기열/).first().waitFor({ state: 'visible', timeout: 10_000 });
    },
    async verify(ctx) {
      const r = (await ctx.api.admin1.get(`/chatbots/${ctx.ids.A.id}/intents/${ctx.ids.A.intents.delivery.intentId}`)).body as { intent?: { examples?: string[] }; examples?: string[] };
      const examples = r.intent?.examples ?? r.examples ?? [];
      return { ok: examples.includes(SCENE_TEXT.notYetArrived), expected: `예문에 "${SCENE_TEXT.notYetArrived}"`, actual: `예문 ${examples.length}개` };
    },
  },
  {
    id: 'S4-03',
    title: '예문 늘리기(규칙)',
    narration: ['규칙으로 만든 후보 중 사람이 고른 것만 넣습니다', 'AI가 만든 문장이 아닙니다'],
    badges: ['HUMAN_APPROVAL', 'NO_EXTERNAL_SEND'],
    budgetSec: 20,
    driver: 'UI',
    layout: 'console',
    console: (ids) => `/chatbots/${ids.A.id}/dialogue/intents`,
    core: false,
    skippable: true,
    capture: 'none',
    async run(ctx) {
      await consoleUi.nameButton(ctx.console, INTENTS_A[0].name).click();
      const dlg = consoleUi.dialog(ctx.console);
      await dlg.waitFor({ state: 'visible', timeout: 10_000 });
      // 접이식 패널의 토글 버튼(이름: "예문 증강 (제안 없음)" — 앞의 ▸ 기호는 접근성 이름에서 빠진다)
      await dlg.getByRole('button', { name: /^예문 증강/ }).click();
      await dlg.getByRole('button', { name: /(새로|다시) 생성하기/ }).click();
      await dlg.getByText(/생성이 완료되었습니다/).first().waitFor({ state: 'visible', timeout: 45_000 });
      // 허용 목록에 든 후보만 승인한다(최대 2건)
      let approved = 0;
      for (const text of AUGMENT_ALLOW) {
        if (approved >= 2) break;
        const row = dlg.getByRole('row').filter({ hasText: text }).first();
        if ((await row.count()) === 0) continue;
        await row.getByRole('button', { name: '승인', exact: true }).click();
        const confirm = ctx.console.getByRole('dialog').filter({ hasText: '예문 추가' }).last();
        if (await confirm.isVisible().catch(() => false)) await confirm.getByRole('button', { name: /추가|확인/ }).last().click();
        approved++;
      }
      ctx.scratch.set('s4-03-approved', approved);
      if (approved === 0) throw new Error('허용 목록의 후보가 하나도 나오지 않았습니다(A-9)');
    },
  },
  {
    id: 'S4-04',
    title: '검증 실행',
    narration: ['회귀 시험 15문항을 다시 돌립니다'],
    budgetSec: 15,
    driver: 'MIXED',
    layout: 'console',
    core: true,
    skippable: false,
    capture: 'none',
    async run(ctx) {
      // 시작·완료 대기는 API, 결과 화면은 UI(비동기 진행 막대 대기를 장면에서 빼기 위함)
      const runId = await runValidationAndWait(ctx.api.admin1, ctx.ids.A.id, ctx.ids.A.testSetId, { log: (m) => ctx.log(m), signal: ctx.signal });
      ctx.scratch.set('s4-runId', runId);
      await ctx.openConsole(`/chatbots/${ctx.ids.A.id}/validation/runs/${runId}`);
    },
    async verify(ctx) {
      const runId = String(ctx.scratch.get('s4-runId'));
      const run = (await ctx.api.admin1.get(`/chatbots/${ctx.ids.A.id}/test-runs/${runId}`)).body as { summary?: { a?: { pass: number; fail: number } } };
      return { ok: (run.summary?.a?.fail ?? 1) === 0, expected: '실패 0', actual: `통과 ${run.summary?.a?.pass} / 실패 ${run.summary?.a?.fail}` };
    },
    fallback: {
      caption: '시험이 아직 진행 중이어서 이전 결과를 보여 드립니다',
      async render(ctx) {
        await ctx.openConsole(`/chatbots/${ctx.ids.A.id}/validation/runs/${ctx.ids.A.baselineRunId}`);
      },
    },
  },
  {
    id: 'S4-05',
    title: '통과 화면',
    narration: ['15문항 모두 통과했습니다', '기준 실행보다 1문항이 좋아졌습니다'],
    budgetSec: 15,
    driver: 'UI',
    layout: 'console',
    core: true,
    skippable: false,
    capture: 'screenshot',
    async run(ctx) {
      await ctx.console.getByText(/통과\s*15/).first().waitFor({ state: 'visible', timeout: 10_000 });
    },
  },
  {
    id: 'S4-06',
    title: '실행 비교',
    narration: ['변경 전후를 문항 단위로 비교합니다'],
    budgetSec: 10,
    driver: 'UI',
    layout: 'console',
    core: false,
    skippable: true,
    capture: 'none',
    async run(ctx) {
      const runId = String(ctx.scratch.get('s4-runId') ?? '');
      await ctx.openConsole(`/chatbots/${ctx.ids.A.id}/validation/compare?baseRunId=${ctx.ids.A.baselineRunId}&targetRunId=${runId}`);
      await ctx.console.getByText(/실행 비교/).first().waitFor({ state: 'visible', timeout: 10_000 });
    },
  },
];

void CONSOLE_TEXT;

export const s4Segment: Pick<SegmentDef, 'steps' | 'skipOrder'> = {
  steps,
  skipOrder: ['S4-03', 'S4-06'],
};
