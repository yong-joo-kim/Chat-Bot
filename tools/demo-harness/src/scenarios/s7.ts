// 장면 7 · 발화 묶음 분석(70초) — 설계 §10.8. 상담 녹취를 글로 옮긴 발화 파일을 올려 비슷한 말끼리 묶고, 사람이 고른 문장만 의도 예문으로 넣는다.
// 보이는 시연은 새 분석을 시작하지 않는다(A-13): 파일 검사 화면까지만 보이고 결과는 같은 파일로 미리 분석해 둔 것을 보인다. 무인 점검은 실제로 분석해서 그 결과로 이어 간다.
import { INTENTS_A } from '../data/dataset';
import { consoleUi, CONSOLE_TEXT } from '../selectors/console';
import type { SegmentDef, StepContext, StepDef } from '../scenario/types';
import { readFileSync } from 'node:fs';

const A_ = CONSOLE_TEXT.analysis;
const POINTS_INTENT = INTENTS_A.find((i) => i.key === 'points')!;
const listPath = (ids: { A: { id: string } }) => `/chatbots/${ids.A.id}/stats/utterance-analyses`;

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** 이번 장면이 보는 분석 ID — 무인 점검에서 새로 만든 분석이 있으면 그것, 아니면 준비 단계의 사전 분석. */
function analysisId(ctx: StepContext): string {
  const id = (ctx.scratch.get('s7-analysis-id') as string | undefined) ?? ctx.ids.A.preAnalysisId;
  if (!id) throw new Error('볼 수 있는 분석이 없습니다(사전 분석 실패)');
  return id;
}

async function analysisDetail(ctx: StepContext, id: string): Promise<Json> {
  return (await ctx.api.admin1.get(`/chatbots/${ctx.ids.A.id}/utterance-analyses/${id}`)).body as Json;
}

/** 의도 예문 목록(API). */
async function intentExamples(ctx: StepContext, intentId: string): Promise<string[]> {
  const r = (await ctx.api.admin1.get(`/chatbots/${ctx.ids.A.id}/intents/${intentId}`)).body as { intent?: { examples?: string[] }; examples?: string[] };
  return r.intent?.examples ?? r.examples ?? [];
}

/** 파일 검사 응답(API) — 화면의 "분석할 발화는 N개입니다"와 대조할 기대값. */
async function previewValidCount(ctx: StepContext): Promise<number> {
  const form = new FormData();
  form.append('file', new Blob([readFileSync(ctx.paths.fixtureCsv)], { type: 'text/csv' }), 'utterances-demo.csv');
  const r = (await ctx.api.admin1.request('POST', `/chatbots/${ctx.ids.A.id}/utterance-analyses/preview`, { form })).body as Json;
  return Number(r.validCount);
}

/** 파일을 올리고 검사 결과 문구가 나올 때까지 기다린다(대화상자 없이 `setInputFiles`). */
async function uploadAndPreview(ctx: StepContext): Promise<number> {
  const expected = await previewValidCount(ctx);
  await ctx.console.getByLabel(A_.fileInputLabel).setInputFiles(ctx.paths.fixtureCsv);
  await ctx.console.getByText(A_.previewDone(expected), { exact: false }).first().waitFor({ state: 'visible', timeout: 30_000 });
  return expected;
}

/** 포인트 묶음(대표 키워드·이름에 "포인트"·"적립"이 든 묶음)의 번호. */
function pointsClusterNo(detail: Json): string {
  const clusters = (detail.clusters ?? []) as Array<{ ordinal: number; unassigned: boolean; displayName: string; keywords: Array<{ term: string }> }>;
  const hit =
    clusters.find((c) => !c.unassigned && (c.displayName.includes('포인트') || c.keywords.some((k) => k.term.includes('포인트')))) ??
    clusters.find((c) => !c.unassigned && (c.displayName.includes('적립') || c.keywords.some((k) => k.term.includes('적립'))));
  if (!hit) throw new Error('포인트 묶음을 찾지 못했습니다(묶음 이름·키워드에 "포인트"·"적립"이 없음)');
  return String(hit.ordinal);
}

const steps: StepDef[] = [
  {
    id: 'S7-01',
    title: '파일 올리기와 검사',
    narration: ['상담 녹취를 글로 옮긴 발화 파일을 올립니다'],
    disclosure: '올린 파일은 가려진 문장만 저장합니다',
    budgetSec: 15,
    driver: 'UI',
    account: 'admin1',
    layout: 'console',
    console: (ids) => `${listPath(ids)}/new`,
    core: false,
    skippable: true,
    capture: 'none',
    async run(ctx) {
      ctx.scratch.set('s7-01-valid', await uploadAndPreview(ctx));
    },
    // 무인 점검: 검사 뒤 "분석 시작"까지 눌러 실제로 분석하고(사내 CPU) 그 결과로 이어 간다(P-6 · 상한 120초).
    async headless(ctx) {
      ctx.scratch.set('s7-01-valid', await uploadAndPreview(ctx));
      const before = ((await ctx.api.admin1.get(`/chatbots/${ctx.ids.A.id}/utterance-analyses`)).body as { items: Array<{ id: string }> }).items.map((i) => i.id);
      await ctx.console.getByRole('button', { name: A_.submit, exact: true }).click();
      const created = await ctx.waitFor(
        async () => {
          const list = ((await ctx.api.admin1.get(`/chatbots/${ctx.ids.A.id}/utterance-analyses`)).body as { items: Array<{ id: string }> }).items;
          return list.find((i) => !before.includes(i.id))?.id ?? false;
        },
        { timeoutMs: 20_000, intervalMs: 500, label: '새 분석 생성' },
      );
      await ctx.waitFor(
        async () => {
          const d = await analysisDetail(ctx, created);
          if (d.status === 'FAILED') throw new Error(`분석 실패: ${d.failureReason ?? ''}`);
          return d.status === 'SUCCEEDED' ? d : false;
        },
        { timeoutMs: 120_000, intervalMs: 1000, label: '발화 묶음 분석 완료', isFatal: (e) => e instanceof Error && /분석 실패/.test(e.message) },
      );
      ctx.scratch.set('s7-analysis-id', created);
    },
    waitMaxMs: 180_000,
    async verify(ctx) {
      const shown = Number(ctx.scratch.get('s7-01-valid'));
      return { ok: shown > 0, expected: '검사 결과 "분석할 발화" 1개 이상', actual: `${shown}개` };
    },
  },
  {
    id: 'S7-02',
    title: '분석 결과',
    narration: ['같은 파일을 분석한 결과를 묶음별로 봅니다'],
    // 보이는 시연은 미리 분석해 둔 결과를 보인다 — 사실 그대로 공개한다(FR-DH9-2). 무인 점검은 방금 실제로 분석한 결과다.
    dynamicDisclosure: async (ctx) => {
      if (ctx.scratch.get('s7-analysis-id')) return undefined;
      const id = ctx.ids.A.preAnalysisId;
      if (!id) return undefined;
      const d = await analysisDetail(ctx, id);
      const sec = Math.round(Number(d.durationMs ?? 0) / 1000);
      return sec > 0 ? `미리 같은 파일로 실행해 둔 결과입니다(사내 CPU 약 ${sec}초)` : '미리 같은 파일로 실행해 둔 결과입니다';
    },
    badges: ['CPU_ONLY'],
    budgetSec: 15,
    driver: 'UI',
    account: 'admin1',
    layout: 'console',
    core: true,
    skippable: false,
    capture: 'gif-clip',
    async run(ctx) {
      await ctx.openConsole(`${listPath(ctx.ids)}/${analysisId(ctx)}`);
      const table = ctx.console.getByRole('table', { name: A_.clusterCaption });
      await table.waitFor({ state: 'visible', timeout: 20_000 });
      await ctx.console.getByRole('button', { name: /묶음의 발화 보기$/ }).first().waitFor({ state: 'visible', timeout: 20_000 });
      // 콘솔 칸은 높이가 제한돼 있어 묶음 표가 보이도록 내린다
      await table.scrollIntoViewIfNeeded();
    },
    async verify(ctx) {
      const d = await analysisDetail(ctx, analysisId(ctx));
      const n = ((d.clusters ?? []) as Json[]).filter((c) => !c.unassigned).length;
      return { ok: d.status === 'SUCCEEDED' && n >= 3, expected: '완료 · 묶음 3개 이상', actual: `${d.status} · 묶음 ${n}개` };
    },
  },
  {
    id: 'S7-03',
    title: '발화 고르기',
    narration: ['사람이 확인해 넣을 문장만 고릅니다'],
    badges: ['HUMAN_APPROVAL'],
    budgetSec: 15,
    driver: 'UI',
    layout: 'console',
    core: true,
    skippable: false,
    capture: 'none',
    async run(ctx) {
      const no = pointsClusterNo(await analysisDetail(ctx, analysisId(ctx)));
      ctx.scratch.set('s7-points-no', no);
      await ctx.console.getByRole('button', { name: A_.showUtterances(no), exact: true }).click();
      await ctx.console.getByLabel(A_.filterUnapplied).check();
      const table = ctx.console.getByRole('table', { name: A_.utteranceCaption });
      await table.waitFor({ state: 'visible', timeout: 15_000 });
      await table.scrollIntoViewIfNeeded();
      const rows = table.getByRole('row');
      await ctx.waitFor(async () => (await rows.count()) >= 4, { timeoutMs: 15_000, intervalMs: 300, label: '발화 표(머리 + 3행 이상)' });
      // 앞에서부터 선택 가능한 행 3개를 고른다(이미 넣었거나 금지어가 든 행은 체크박스가 없다)
      const picked: string[] = [];
      for (let i = 1, n = await rows.count(); i < n && picked.length < 3; i++) {
        const row = rows.nth(i);
        const box = row.getByRole('checkbox');
        if ((await box.count()) === 0) continue;
        const text = (await row.getByRole('cell').nth(1).innerText()).trim();
        await box.check();
        picked.push(text);
      }
      if (picked.length < 3) throw new Error(`고를 수 있는 발화가 ${picked.length}개뿐입니다`);
      ctx.scratch.set('s7-picked', picked);
      await ctx.console.getByText(A_.selectionCount(3, 50), { exact: false }).first().waitFor({ state: 'visible', timeout: 10_000 });
    },
  },
  {
    id: 'S7-04',
    title: '예문으로 넣기',
    narration: ["고른 문장만 '포인트문의'", '예문이 됩니다'],
    badges: ['HUMAN_APPROVAL'],
    budgetSec: 15,
    driver: 'UI',
    layout: 'console',
    core: true,
    skippable: false,
    capture: 'screenshot',
    async run(ctx) {
      ctx.scratch.set('s7-04-before', (await intentExamples(ctx, ctx.ids.A.intents.points.intentId)).length);
      await ctx.console.getByRole('button', { name: A_.applyOpen, exact: true }).click();
      const dlg = consoleUi.dialog(ctx.console);
      await dlg.getByRole('radio', { name: A_.applyTargetExisting }).check();
      const picker = dlg.getByLabel(A_.applyIntentPickerLabel);
      await ctx.pace.type(picker, POINTS_INTENT.name);
      await dlg.getByRole('option', { name: POINTS_INTENT.name }).first().click();
      await dlg.getByRole('button', { name: A_.applyPreviewButton, exact: true }).click();
      await dlg.getByText(A_.applyStep2, { exact: false }).first().waitFor({ state: 'visible', timeout: 15_000 });
      const confirm = dlg.getByRole('button', { name: /^예문 \d+개 넣기$/ });
      await confirm.waitFor({ state: 'visible', timeout: 10_000 });
      const included = Number(/(\d+)/.exec(await confirm.innerText())?.[1] ?? 0);
      ctx.scratch.set('s7-04-included', included);
      await confirm.click();
      await dlg.getByText(A_.applyStep3, { exact: false }).first().waitFor({ state: 'visible', timeout: 20_000 });
      await dlg.getByText(A_.applyResultPrefix, { exact: false }).first().waitFor({ state: 'visible', timeout: 10_000 });
    },
    async verify(ctx) {
      const before = Number(ctx.scratch.get('s7-04-before'));
      const included = Number(ctx.scratch.get('s7-04-included'));
      const after = (await intentExamples(ctx, ctx.ids.A.intents.points.intentId)).length;
      // 이전 + 미리보기에서 "넣는 문장"으로 보인 수(같은 문장·다른 의도와 겹친 것은 규칙대로 빠진다)
      return { ok: included >= 1 && after === before + included, expected: `포인트문의 예문 ${before} + ${included}`, actual: `${after}개` };
    },
  },
  {
    id: 'S7-05',
    title: '반영 확인',
    narration: ['바로 다음 대화부터 적용됩니다'],
    budgetSec: 10,
    driver: 'UI',
    layout: 'console',
    console: (ids) => `/chatbots/${ids.A.id}/dialogue/intents`,
    core: false,
    skippable: true,
    capture: 'none',
    async run(ctx) {
      // 결과 대화상자는 다음 화면 이동으로 사라진다. 의도 화면에서 포인트문의를 열어 방금 넣은 예문을 확인한다.
      await consoleUi.nameButton(ctx.console, POINTS_INTENT.name).click();
      const dlg = consoleUi.dialog(ctx.console);
      await dlg.waitFor({ state: 'visible', timeout: 10_000 });
      const added = ((await intentExamples(ctx, ctx.ids.A.intents.points.intentId)) as string[]).filter((e) => !POINTS_INTENT.examples.includes(e));
      const probe = added[0];
      if (!probe) throw new Error('방금 넣은 예문을 API에서 찾지 못했습니다');
      // 예문은 칩(글자 + 지우기 버튼)으로 보이므로 부분 일치로 찾는다
      const chip = dlg.getByText(probe, { exact: false }).first();
      await chip.waitFor({ state: 'visible', timeout: 10_000 });
      await chip.scrollIntoViewIfNeeded();
    },
  },
];

export const s7Segment: Pick<SegmentDef, 'steps' | 'skipOrder'> = {
  steps,
  skipOrder: ['S7-01', 'S7-05'],
};
