// [DT-2] 풀 투어 ⑩ 사내 소형 생성 모델(120) — 설계 §9.9 · ui-spec §16.8. `--with-local-llm`일 때만 활성(비활성이면 장면 수 N=9).
// 3050(4GB)에서는 음성 인식(GPU)과 생성 모델을 동시에 올리지 않는다 — SE-01이 음성 인식을 내리고(VRAM 회수 확인) 생성 모델을 올린다(순차 적재 · 숨기지 않고 카드로 보인다).
// 문장 품질을 평가하는 문구를 어디에도 쓰지 않는다(FR-0-318) — "동작 확인 수준 · 사람이 고른 문장만 예문"만 말한다.
import { INTENTS_A } from '../../data/dataset';
import { LIVE_GENERATION_INTENT_KEY, PREPARED_GENERATION } from '../../data/dataset-full';
import { consoleUi } from '../../selectors/console';
import type { FullStepEnv } from '../../scenario/full-env';
import type { SegmentDef, StepContext, StepDef } from '../../scenario/types';
import { FALLBACK_TEXTS, SE01_DISCLOSURE, SE02_DISCLOSURE, se01Narration } from './text';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function need(ctx: StepContext): FullStepEnv {
  if (!ctx.full) throw new Error('풀 투어 실행 환경이 없습니다');
  return ctx.full;
}

const intentOf = (key: string) => {
  const it = INTENTS_A.find((i) => i.key === key);
  if (!it) throw new Error(`의도 ${key}가 없습니다`);
  return it;
};

/** 의도의 증강 목록(대기 중 후보 + 최근 생성 요약). */
async function augmentList(ctx: StepContext, intentId: string): Promise<{ items: Array<{ id: string; text: string; conflictIntent?: unknown; stale?: boolean }>; runResult?: Json }> {
  const r = (await ctx.api.admin1.get(`/chatbots/${ctx.ids.A.id}/intents/${intentId}/augmentations`, { query: { status: 'PENDING', pageSize: 50 } })).body as Json;
  return { items: (r.items ?? []) as Array<{ id: string; text: string; conflictIntent?: unknown; stale?: boolean }>, runResult: r.runResult as Json | undefined };
}

async function intentExamples(ctx: StepContext, intentId: string): Promise<string[]> {
  const r = (await ctx.api.admin1.get(`/chatbots/${ctx.ids.A.id}/intents/${intentId}`)).body as { intent?: { examples?: string[] }; examples?: string[] };
  return r.intent?.examples ?? r.examples ?? [];
}

const se01: StepDef = {
  id: 'SE-01',
  title: 'GPU 전환',
  narration: ['사내 소형 생성 모델을 이 노트북 GPU에 올립니다'],
  dynamicNarration: (ctx) => se01Narration(ctx.plan),
  disclosure: SE01_DISCLOSURE,
  facts: ['GPU_USED', 'CHECKED_ONLY'],
  budgetSec: 25,
  driver: 'UI',
  layout: 'card',
  core: true,
  skippable: false,
  capture: 'screenshot',
  async run(ctx) {
    const full = need(ctx);
    await ctx.stage.showCard('gpu');
    const stop = await full.gpu.stopSpeech();
    if (!stop.ok) {
      ctx.scratch.set('se-mode', 'prepared');
      throw new Error(`음성 인식을 내리지 못했습니다: ${stop.reason ?? '회수 확인 실패'}`);
    }
    const load = await full.gpu.loadOllama();
    if (!load.ok) {
      ctx.scratch.set('se-mode', 'prepared');
      throw new Error(`생성 모델을 올리지 못했습니다: ${load.reason ?? '적재 확인 실패'}`);
    }
  },
  async verify(ctx) {
    const g = need(ctx).stageFacts.gpu;
    return { ok: g?.phase === 'done' && g.ollamaActive === true, expected: '음성 인식 내림 · 생성 모델 적재 확인(관찰값 · 판정 아님)', actual: `단계 ${g?.phase ?? '?'} · 생성 모델 ${g?.ollamaActive ? '올라감' : '없음'}` };
  },
  fallback: {
    caption: FALLBACK_TEXTS.SE01.caption,
    notice: FALLBACK_TEXTS.SE01.notice,
    async render(ctx) {
      // 카드가 실패 행을 보이고 SE-02는 사전 결과 모드로 간다(무인 점검에서도 대체로 이어 가되 단계 결과는 FALLBACK으로 남는다)
      ctx.scratch.set('se-mode', 'prepared');
    },
  },
};

const se02: StepDef = {
  id: 'SE-02',
  title: '예문 늘리기(로컬)',
  narration: ['사내 소형 모델이 예문 후보를 만듭니다'],
  dynamicDisclosure: (ctx) => (ctx.scratch.get('se-mode') === 'prepared' ? FALLBACK_TEXTS.SE02_PREPARED.notice : SE02_DISCLOSURE),
  badges: ['NO_EXTERNAL_SEND'],
  facts: ['GPU_USED', 'CHECKED_ONLY'],
  budgetSec: 60,
  driver: 'UI',
  account: 'admin1',
  layout: 'console',
  console: (ids) => `/chatbots/${ids.A.id}/dialogue/intents`,
  core: true,
  skippable: false,
  capture: 'screenshot',
  waitMaxMs: 100_000,
  async run(ctx) {
    const full = need(ctx);
    const prepared = full.prepared;
    const mode: 'live' | 'prepared' = ctx.scratch.get('se-mode') === 'prepared' ? 'prepared' : 'live';
    const key = mode === 'live' ? LIVE_GENERATION_INTENT_KEY : PREPARED_GENERATION.intentKey;
    const it = intentOf(key);
    const intentId = ctx.ids.A.intents[key].intentId;
    ctx.scratch.set('se-intent', { key, id: intentId, name: it.name, mode });
    await consoleUi.nameButton(ctx.console, it.name).click();
    const dlg = consoleUi.dialog(ctx.console);
    await dlg.waitFor({ state: 'visible', timeout: 10_000 });
    // 접이식 패널의 토글 버튼(이름: "예문 증강 (…)" — 앞의 기호는 접근성 이름에서 빠진다)
    await dlg.getByRole('button', { name: /^예문 증강/ }).click();
    if (mode === 'live') {
      const t0 = Date.now();
      await dlg.getByRole('button', { name: /(새로|다시) 생성하기/ }).click();
      await dlg.getByText(/생성이 완료되었습니다/).first().waitFor({ state: 'visible', timeout: 50_000 });
      const elapsedMs = Date.now() - t0;
      const list = await augmentList(ctx, intentId);
      const rr = list.runResult ?? {};
      ctx.scratch.set('se-degraded', rr.degraded === true || rr.providerId !== 'local');
      full.record.live = {
        providerId: String(rr.providerId ?? '?'),
        degraded: rr.degraded === true,
        fallbackFrom: (rr.fallbackFrom as string | undefined) ?? null,
        candidates: list.items.length,
        elapsedMs,
        source: 'LIVE',
        intentName: it.name,
      };
    } else {
      // 사전 결과 — 준비 단계에서 같은 모델로 만들어 둔 후보가 이미 패널에 있다
      await dlg.getByRole('button', { name: '승인', exact: true }).first().waitFor({ state: 'visible', timeout: 15_000 });
      if (prepared) full.record.live = { ...prepared.record, source: 'PREPARED' };
    }
  },
  async verify(ctx) {
    const info = ctx.scratch.get('se-intent') as { key: string; id: string; name: string; mode: 'live' | 'prepared' };
    const list = await augmentList(ctx, info.id);
    const rr = list.runResult ?? {};
    if (info.mode === 'prepared') {
      return { ok: list.items.length >= 1 && rr.providerId === 'local', expected: '사전 결과: local 후보 1개 이상', actual: `${rr.providerId ?? '?'} · 후보 ${list.items.length}개` };
    }
    // 정상 = local ∧ 폴백 아님 ∧ 후보 ≥ 1 · rule(폴백)이면 대체(사실 그대로 공개)
    const ok = rr.providerId === 'local' && rr.degraded !== true && list.items.length >= 1;
    return { ok, expected: 'providerId=local · degraded=false · 후보 ≥ 1', actual: `${rr.providerId ?? '?'} · degraded ${rr.degraded === true} · 후보 ${list.items.length}개${rr.fallbackFrom ? ` · 폴백 전 ${rr.fallbackFrom}` : ''}` };
  },
  fallback: {
    caption: FALLBACK_TEXTS.SE02_PREPARED.caption,
    notice: FALLBACK_TEXTS.SE02_PREPARED.notice,
    captionFor(ctx) {
      // 로컬 0건 → 규칙 기반 폴백(사실 그대로) / 시간 초과 등 → 사전 결과
      return ctx.scratch.get('se-degraded') === true ? { caption: FALLBACK_TEXTS.SE02_DEGRADED.caption } : { caption: FALLBACK_TEXTS.SE02_PREPARED.caption, notice: FALLBACK_TEXTS.SE02_PREPARED.notice };
    },
    async render(ctx) {
      const full = need(ctx);
      if (ctx.scratch.get('se-degraded') === true) return; // 규칙 기반 후보가 이미 화면에 있다 — 그대로 보인다
      // 생성 시간 초과 등: 사전 결과(다른 의도)를 보이고 SE-03이 그 의도에 적용한다
      if (!full.prepared) throw new Error('사전 결과가 없어 대체할 화면이 없습니다');
      ctx.scratch.set('se-mode', 'prepared');
      await ctx.openConsole(`/chatbots/${ctx.ids.A.id}/dialogue/intents`);
      const it = intentOf(PREPARED_GENERATION.intentKey);
      await consoleUi.nameButton(ctx.console, it.name).click();
      const dlg = consoleUi.dialog(ctx.console);
      await dlg.waitFor({ state: 'visible', timeout: 10_000 });
      await dlg.getByRole('button', { name: /^예문 증강/ }).click();
      await dlg.getByRole('button', { name: '승인', exact: true }).first().waitFor({ state: 'visible', timeout: 15_000 });
      ctx.scratch.set('se-intent', { key: PREPARED_GENERATION.intentKey, id: ctx.ids.A.intents[PREPARED_GENERATION.intentKey].intentId, name: it.name, mode: 'prepared' });
      full.record.live = { ...full.prepared.record, source: 'PREPARED' };
    },
  },
};

const se03: StepDef = {
  id: 'SE-03',
  title: '사람이 고르기',
  narration: ['사람이 확인한 문장만 예문으로 넣습니다'],
  badges: ['HUMAN_APPROVAL'],
  facts: ['GPU_USED', 'CHECKED_ONLY'],
  budgetSec: 25,
  driver: 'UI',
  layout: 'console',
  core: true,
  skippable: false,
  capture: 'none',
  async run(ctx) {
    const info = ctx.scratch.get('se-intent') as { key: string; id: string; name: string };
    const dlg = consoleUi.dialog(ctx.console);
    ctx.scratch.set('se-03-before', (await intentExamples(ctx, info.id)).length);
    // 형식 검사를 통과한 앞의 후보 2개를 사람이 고른다(빈 값 아님 · 60자 이하 · 기존 예문과 중복 아님 · 충돌 없음) — DT-1 허용 목록은 쓰지 않는다(비결정적)
    const existing = new Set((await intentExamples(ctx, info.id)).map((e) => e.trim()));
    const list = await augmentList(ctx, info.id);
    const picks = list.items.filter((c) => !c.stale && !c.conflictIntent && c.text.trim().length > 0 && [...c.text.trim()].length <= 60 && !existing.has(c.text.trim())).slice(0, 2);
    let approved = 0;
    for (const c of picks) {
      const row = dlg.getByRole('row').filter({ hasText: c.text.trim() }).first();
      if ((await row.count()) === 0) continue;
      await row.getByRole('button', { name: '승인', exact: true }).click();
      const confirm = ctx.console.getByRole('dialog').filter({ hasText: '예문 추가' }).last();
      if (await confirm.isVisible().catch(() => false)) await confirm.getByRole('button', { name: /추가|확인/ }).last().click();
      approved += 1;
    }
    ctx.scratch.set('se-03-approved', approved);
    if (approved === 0) throw new Error('형식 검사를 통과해 승인할 수 있는 후보가 없습니다');
  },
  async verify(ctx) {
    const info = ctx.scratch.get('se-intent') as { id: string };
    const before = Number(ctx.scratch.get('se-03-before') ?? 0);
    const approved = Number(ctx.scratch.get('se-03-approved') ?? 0);
    const after = await ctx.waitFor(async () => {
      const n = (await intentExamples(ctx, info.id)).length;
      return n > before ? n : false;
    }, { timeoutMs: 10_000, intervalMs: 500, label: '예문 수 증가' }).catch(async () => (await intentExamples(ctx, info.id)).length);
    return { ok: approved >= 1 && after > before, expected: '승인 ≥ 1 · 예문 수 증가', actual: `승인 ${approved}개 · 예문 ${before} -> ${after}` };
  },
};

const se04: StepDef = {
  id: 'SE-04',
  title: '모델 내리기',
  narration: ['사내 소형 생성 모델을 내립니다'],
  budgetSec: 10,
  driver: 'API',
  layout: 'console',
  core: true,
  skippable: false,
  capture: 'none',
  async run(ctx) {
    const full = need(ctx);
    // 해제 실패는 경고(정리 단계가 재시도) — 단계는 통과한다
    const r = await full.gpu.unloadOllama();
    if (!r.ok) ctx.log(`[주의] 생성 모델 해제를 확인하지 못했습니다(정리 단계에서 다시 시도합니다): ${r.reason ?? ''}`);
  },
};

export const edgeSegment: Pick<SegmentDef, 'steps' | 'skipOrder'> = {
  steps: [se01, se02, se03, se04],
  skipOrder: [],
};

