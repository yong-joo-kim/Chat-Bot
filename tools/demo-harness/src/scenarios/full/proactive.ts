// [DT-2] 풀 투어 ⑨ 먼저 말 거는 안내(70) — 설계 §9.7 · ui-spec §16.7. 챗봇 D 전용 모형 페이지(삽입 코드에 data-proactive="on" — 하네스가 콘솔과 같은 변환으로 넣음).
// 제품 DOM 위에 하네스 요소를 덧씌우지 않는다 — 말풍선이 뜨기 전 5~15초는 자막이 먼저 알린다(별도 카운트다운 없음).
// 검증: 말풍선 문구·버튼 · 패널 자동 열림 0 · 버튼으로 대화 · 콘솔 규칙·집계(표시/클릭은 브라우저 보고라 조건 대기) · 끄기는 OPTED_OUT 집계 +1 · 런처 포커스.
import { BOT_D, PROACTIVE_RULE_D } from '../../data/dataset-full';
import { CONSOLE_TEXT } from '../../selectors/console';
import { widget, WIDGET_TEXT } from '../../selectors/widget';
import type { SegmentDef, StepContext, StepDef } from '../../scenario/types';
import { freshWidgetSession, norm } from '../helpers';
import { FALLBACK_TEXTS, SP01_DISCLOSURE } from './text';

const P = CONSOLE_TEXT.proactive;

const kstDay = (): string => new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10);

function dId(ctx: StepContext): { id: string; slug: string; ruleId: string } {
  const D = ctx.ids.D;
  if (!D) throw new Error('챗봇 D가 없습니다(풀 투어 데이터 생성 필요)');
  return { id: D.id, slug: D.slug, ruleId: D.proactiveRuleId };
}

/** 오늘의 선제 안내 집계(챗봇 D · 규칙 1개). */
async function proactiveTotals(ctx: StepContext): Promise<{ shown: number; clicked: number; dismissed: number; optedOut: number }> {
  const d = kstDay();
  const r = (await ctx.api.admin1.get(`/chatbots/${dId(ctx).id}/proactive/stats`, { query: { from: d, to: d } })).body as { totals?: Array<{ ruleId: string; shown: number; clicked: number; dismissed: number; optedOut: number }> };
  const t = (r.totals ?? []).find((x) => x.ruleId === dId(ctx).ruleId);
  return { shown: t?.shown ?? 0, clicked: t?.clicked ?? 0, dismissed: t?.dismissed ?? 0, optedOut: t?.optedOut ?? 0 };
}

/** 말풍선 표시 조건 대기 — 체류 5초 + 설정 조회 + 판정 주기(1초) + 여유 = 상한 15초. */
async function waitBubble(ctx: StepContext): Promise<void> {
  await widget.paBubble(ctx.site).waitFor({ state: 'visible', timeout: 15_000 });
}

const sp01: StepDef = {
  id: 'SP-01',
  title: '말풍선 표시',
  narration: ['고객이 페이지에 머물자 챗봇이 먼저 말을 겁니다'],
  disclosure: SP01_DISCLOSURE,
  budgetSec: 25,
  driver: 'UI',
  layout: 'split',
  site: 'D',
  core: true,
  skippable: false,
  capture: 'gif-clip',
  async run(ctx) {
    const d = dId(ctx);
    await freshWidgetSession(ctx, d.slug);
    await waitBubble(ctx);
    ctx.scratch.set('sp-01-text', (await widget.paBubble(ctx.site).innerText()).trim());
  },
  async verify(ctx) {
    const text = String(ctx.scratch.get('sp-01-text') ?? '');
    const ruleText = PROACTIVE_RULE_D.text;
    const labels = PROACTIVE_RULE_D.buttons.map((b) => b.label);
    const buttonsOk = await Promise.all(labels.map(async (l) => widget.paButton(ctx.site, l).isVisible()));
    const panelOpen = await widget.input(ctx.site).isVisible().catch(() => false);
    return {
      ok: norm(text).includes(norm(ruleText)) && buttonsOk.every(Boolean) && !panelOpen,
      expected: `말풍선 "${ruleText}" · 버튼 ${labels.join('·')} · 패널은 닫힌 채`,
      actual: `문구 ${norm(text).includes(norm(ruleText)) ? '일치' : text.slice(0, 40)} · 버튼 ${buttonsOk.every(Boolean) ? '표시' : '없음'} · 패널 ${panelOpen ? '열림' : '닫힘'}`,
    };
  },
  fallback: {
    // 말풍선이 뜨지 않으면(창 최소화로 체류 시간이 쌓이지 않은 경우 등) 관리자 화면의 선제 안내 구역으로 대신 보인다(무인 점검은 실패)
    caption: FALLBACK_TEXTS.SP01.caption,
    async render(ctx) {
      if (ctx.mode === 'headless-check') throw new Error('무인 점검에서는 대체하지 않습니다(실패로 기록)');
      await ctx.openConsole(`/chatbots/${dId(ctx).id}/channels`);
      const entry = ctx.console.getByRole('button', { name: P.entryButton, exact: true }).first();
      await entry.waitFor({ state: 'visible', timeout: 15_000 });
      if ((await entry.getAttribute('aria-expanded')) !== 'true') await entry.click();
    },
  },
};

const sp02: StepDef = {
  id: 'SP-02',
  title: '버튼으로 대화',
  narration: ['창은 고객이 누를 때만 열립니다'],
  budgetSec: 15,
  driver: 'UI',
  layout: 'split',
  core: true,
  skippable: false,
  capture: 'none',
  async run(ctx) {
    const first = PROACTIVE_RULE_D.buttons[0];
    await widget.paButton(ctx.site, first.label).click();
    await widget.input(ctx.site).waitFor({ state: 'visible', timeout: 10_000 });
    await ctx.waitFor(async () => (await widget.botMessages(ctx.site).count()) > 0, { timeoutMs: 15_000, intervalMs: 300, label: '봇 답(버튼 메시지 뒤)' });
    const all = await widget.botMessages(ctx.site).allInnerTexts();
    ctx.scratch.set('sp-02-answer', (all[all.length - 1] ?? '').trim());
    ctx.scratch.set('sp-02-user', (await widget.userMessages(ctx.site).last().innerText().catch(() => '')).trim());
  },
  async verify(ctx) {
    const said = String(ctx.scratch.get('sp-02-answer') ?? '');
    const user = String(ctx.scratch.get('sp-02-user') ?? '');
    const want = BOT_D.intents.delivery.answer;
    const first = PROACTIVE_RULE_D.buttons[0];
    return { ok: norm(said) === norm(want) && norm(user).includes(norm(first.value)), expected: `사용자 말풍선 "${first.value}" · 봇 답 = 배송조회 답`, actual: `사용자 "${user.slice(0, 30)}" · 봇 "${said.slice(0, 40)}"` };
  },
};

const sp03: StepDef = {
  id: 'SP-03',
  title: '콘솔 규칙과 집계',
  narration: ['개인을 식별하지 않고 규칙별 숫자만 저장합니다'],
  budgetSec: 20,
  driver: 'UI',
  account: 'admin1',
  layout: 'console',
  console: (ids) => `/chatbots/${ids.D!.id}/channels`,
  core: true,
  skippable: false,
  capture: 'screenshot',
  async run(ctx) {
    const entry = ctx.console.getByRole('button', { name: P.entryButton, exact: true }).first();
    await entry.waitFor({ state: 'visible', timeout: 15_000 });
    if ((await entry.getAttribute('aria-expanded')) !== 'true') await entry.click();
    // 규칙 목록 머리 글자 "선제 안내 규칙 (n/20 · 켜짐 n/10)"(표 캡션이 아니라 문단) + 규칙 행 + 통계 보기(목록 위 단일 버튼)
    await ctx.console.getByText(new RegExp(`^${P.listCaptionPrefix}`)).first().waitFor({ state: 'visible', timeout: 15_000 });
    const ruleRow = ctx.console.getByRole('row').filter({ hasText: PROACTIVE_RULE_D.name }).first();
    await ruleRow.waitFor({ state: 'visible', timeout: 10_000 });
    await ruleRow.scrollIntoViewIfNeeded();
    await ctx.console.getByRole('button', { name: P.statsButton, exact: true }).first().click();
    await ctx.console.getByText(P.statsTitle, { exact: false }).first().waitFor({ state: 'visible', timeout: 15_000 });
  },
  async verify(ctx) {
    // 집계는 브라우저가 보고하는 비동기 수집이라 조건 대기(상한 10초 — 표시 ≥ 1 · 클릭 ≥ 1)
    const t = await ctx
      .waitFor(
        async () => {
          const x = await proactiveTotals(ctx);
          return x.shown >= 1 && x.clicked >= 1 ? x : false;
        },
        { timeoutMs: 10_000, intervalMs: 500, label: '선제 안내 집계(표시·클릭)' },
      )
      .catch(async () => proactiveTotals(ctx));
    const full = ctx.full;
    if (full) full.record.proactive = { shown: t.shown, clicked: t.clicked, optedOut: t.optedOut };
    return { ok: t.shown >= 1 && t.clicked >= 1, expected: '오늘 표시 ≥ 1 · 클릭 ≥ 1', actual: `표시 ${t.shown} · 클릭 ${t.clicked} · 닫기 ${t.dismissed} · 끄기 ${t.optedOut}` };
  },
};

const sp04: StepDef = {
  id: 'SP-04',
  title: '이번 방문 동안 끄기',
  narration: ['고객이 끄면 이번 방문 동안 다시 뜨지 않습니다'],
  budgetSec: 10,
  driver: 'UI',
  layout: 'split',
  site: 'D',
  core: false,
  skippable: true,
  capture: 'none',
  async run(ctx) {
    ctx.scratch.set('sp-04-before', (await proactiveTotals(ctx)).optedOut);
    await freshWidgetSession(ctx, dId(ctx).slug);
    await waitBubble(ctx);
    await widget.paBubble(ctx.site).getByRole('button', { name: WIDGET_TEXT.paOptOut, exact: true }).click();
    await widget.paBubble(ctx.site).waitFor({ state: 'hidden', timeout: 10_000 });
  },
  async verify(ctx) {
    // 끄기 효과 = 말풍선 닫힘 · 포커스가 런처로 이동 · OPTED_OUT 집계 +1(세션당 표시 상한 1이라 재표시 0은 끄기와 구분되지 않는다 — A-DX-5)
    const launcher = widget.launcher(ctx.site);
    const focused = await launcher.evaluate((el) => (el.getRootNode() as Document | ShadowRoot).activeElement === el).catch(() => false);
    const before = Number(ctx.scratch.get('sp-04-before') ?? 0);
    const after = await ctx
      .waitFor(
        async () => {
          const n = (await proactiveTotals(ctx)).optedOut;
          return n >= before + 1 ? n : false;
        },
        { timeoutMs: 10_000, intervalMs: 500, label: '선제 안내 끄기 집계' },
      )
      .catch(async () => (await proactiveTotals(ctx)).optedOut);
    const full = ctx.full;
    if (full && full.record.proactive) full.record.proactive.optedOut = after;
    return { ok: focused && after >= before + 1, expected: '말풍선 닫힘 · 포커스 = 런처 · 끄기 집계 +1', actual: `포커스 ${focused ? '런처' : '다른 곳'} · 끄기 ${before} -> ${after}` };
  },
};

export const proactiveSegment: Pick<SegmentDef, 'steps' | 'skipOrder'> = {
  steps: [sp01, sp02, sp03, sp04],
  skipOrder: ['SP-04'],
};

