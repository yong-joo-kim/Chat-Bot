// 장면 1 · 챗봇 구축과 위젯 대화(90초) — 설계 §10.2. 의미 매칭을 켜기 전후로 같은 질문이 어떻게 달라지는지 보인다.
import { BOT_A, INTENTS_A, SCENE_TEXT } from '../data/dataset';
import { consoleUi, CONSOLE_TEXT } from '../selectors/console';
import type { SegmentDef, StepContext, StepDef } from '../scenario/types';
import { askWidget, norm } from './helpers';

const intentsPath = (ids: { A: { id: string } }) => `/chatbots/${ids.A.id}/dialogue/intents`;

async function toggleSemantic(ctx: StepContext): Promise<void> {
  const box = ctx.console.getByRole('checkbox', { name: CONSOLE_TEXT.answerSettings.semanticLabel });
  await box.waitFor({ state: 'visible', timeout: 10_000 });
  if (!(await box.isChecked())) await box.check();
  await ctx.console.getByRole('button', { name: CONSOLE_TEXT.common.save, exact: true }).first().click();
  await consoleUi.toast(ctx.console, CONSOLE_TEXT.answerSettings.saveSuccess).waitFor({ state: 'visible', timeout: 10_000 });
}

const steps: StepDef[] = [
  {
    id: 'S1-01',
    title: '의도 화면',
    narration: ['관리자가 질문 유형(의도)과 예문을 등록해 둔 상태입니다'],
    budgetSec: 10,
    driver: 'UI',
    account: 'admin1',
    layout: 'split',
    site: 'A',
    console: intentsPath,
    core: false,
    skippable: true,
    capture: 'none',
    async run(ctx) {
      for (const it of INTENTS_A) await consoleUi.nameButton(ctx.console, it.name).waitFor({ state: 'visible', timeout: 10_000 });
    },
  },
  {
    id: 'S1-02',
    title: '대화 노드 화면',
    narration: ['질문 유형마다 답변 흐름을 연결합니다'],
    budgetSec: 10,
    driver: 'UI',
    layout: 'split',
    console: (ids) => `/chatbots/${ids.A.id}/dialogue/nodes`,
    core: false,
    skippable: true,
    capture: 'none',
    async run(ctx) {
      await ctx.console.getByText(CONSOLE_TEXT.nodes.totalLabel(INTENTS_A.length + 2), { exact: false }).first().waitFor({ state: 'visible', timeout: 10_000 });
    },
  },
  {
    id: 'S1-03',
    title: '꺼진 상태에서 질문',
    narration: ['등록된 예문과 표현이 달라 규칙만으로는 못 알아듣습니다'],
    budgetSec: 15,
    driver: 'UI',
    layout: 'split',
    site: 'A',
    core: true,
    skippable: false,
    capture: 'screenshot',
    async run(ctx) {
      const said = await askWidget(ctx, SCENE_TEXT.notYetArrived);
      ctx.scratch.set('s1-03-answer', said);
    },
    async verify(ctx) {
      const said = String(ctx.scratch.get('s1-03-answer') ?? '');
      return { ok: norm(said) === norm(BOT_A.fallback), expected: BOT_A.fallback, actual: said };
    },
  },
  {
    id: 'S1-04',
    title: '의미 매칭 켜기',
    narration: ['사내 CPU 문장 분석을 켭니다'],
    disclosure: '외부 AI를 부르지 않습니다',
    badges: ['CPU_ONLY'],
    budgetSec: 15,
    driver: 'UI',
    account: 'admin1',
    layout: 'split',
    console: (ids) => `/chatbots/${ids.A.id}/answer-settings`,
    core: true,
    skippable: false,
    capture: 'none',
    async run(ctx) {
      await toggleSemantic(ctx);
    },
    async verify(ctx) {
      const s = (await ctx.api.admin1.get(`/chatbots/${ctx.ids.A.id}/answer-settings`)).body as { semanticEnabled?: boolean };
      return { ok: s.semanticEnabled === true, expected: 'semanticEnabled=true', actual: String(s.semanticEnabled) };
    },
  },
  {
    id: 'S1-05',
    title: '켠 뒤 같은 질문',
    narration: ['같은 질문을 뜻으로 알아듣고 배송 조회 안내로 답합니다'],
    disclosure: '사내 CPU로 문장을 분석합니다',
    badges: ['CPU_ONLY'],
    budgetSec: 15,
    driver: 'UI',
    layout: 'split',
    site: 'A',
    core: true,
    skippable: false,
    capture: 'gif-clip',
    async run(ctx) {
      const said = await askWidget(ctx, SCENE_TEXT.notYetArrived, 15_000);
      ctx.scratch.set('s1-05-answer', said);
    },
    async verify(ctx) {
      const said = String(ctx.scratch.get('s1-05-answer') ?? '');
      const expected = INTENTS_A[0].answer;
      return { ok: norm(said) === norm(expected), expected, actual: said };
    },
    fallback: { stepId: 'S1-07', caption: '실시간 응답이 늦어 시뮬레이터 결과로 대신 보여 드립니다' },
  },
  {
    id: 'S1-06',
    title: '예문 한 개 추가',
    narration: ['예문은 화면에서 바로 추가할 수 있습니다'],
    budgetSec: 15,
    driver: 'UI',
    account: 'admin1',
    layout: 'split',
    console: intentsPath,
    core: false,
    skippable: true,
    capture: 'none',
    async run(ctx) {
      await consoleUi.nameButton(ctx.console, INTENTS_A[0].name).click();
      const dlg = consoleUi.dialog(ctx.console);
      await dlg.waitFor({ state: 'visible', timeout: 10_000 });
      await ctx.pace.type(dlg.getByRole('textbox', { name: CONSOLE_TEXT.intents.newExampleLabel }), SCENE_TEXT.addedExample);
      await dlg.getByRole('button', { name: CONSOLE_TEXT.intents.addExample, exact: true }).click();
      await dlg.getByRole('button', { name: CONSOLE_TEXT.common.save, exact: true }).click();
      await dlg.waitFor({ state: 'hidden', timeout: 10_000 });
    },
    async verify(ctx) {
      const r = (await ctx.api.admin1.get(`/chatbots/${ctx.ids.A.id}/intents/${ctx.ids.A.intents.delivery.intentId}`)).body as { intent?: { examples?: string[] }; examples?: string[] };
      const examples = r.intent?.examples ?? r.examples ?? [];
      return { ok: examples.includes(SCENE_TEXT.addedExample), expected: SCENE_TEXT.addedExample, actual: `예문 ${examples.length}개` };
    },
  },
  {
    id: 'S1-07',
    title: '시뮬레이터',
    narration: ['배포 전에 시뮬레이터로 근거를 확인합니다'],
    budgetSec: 10,
    driver: 'UI',
    layout: 'split',
    console: (ids) => `/chatbots/${ids.A.id}/simulator`,
    core: false,
    skippable: true,
    capture: 'none',
    async run(ctx) {
      await ctx.pace.type(ctx.console.getByLabel(CONSOLE_TEXT.simulator.composerLabel), SCENE_TEXT.addedExample);
      await ctx.console.getByRole('button', { name: CONSOLE_TEXT.simulator.send, exact: true }).click();
      await ctx.console.getByText(/배송조회/).first().waitFor({ state: 'visible', timeout: 10_000 });
    },
  },
];

export const s1Segment: Pick<SegmentDef, 'steps' | 'skipOrder'> = {
  steps,
  skipOrder: ['S1-06', 'S1-07', 'S1-02', 'S1-01'],
};
