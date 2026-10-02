// 장면 6 · 개인정보와 안전(70초) — 설계 §10.7. 고객이 입력한 개인정보는 저장되는 기록과 관리자 화면에서 가려지고, 의료 조언 같은 위험 질문에는 정해 둔 안전 문구로 답한다.
// 나레이션은 "입력창에서 가려진다"고 말하지 않는다(FR-DH4-10 — 입력 화면에는 입력한 그대로 보인다).
import { GUARDRAIL_A } from '../data/dataset';
import { CONSOLE_TEXT } from '../selectors/console';
import { widget } from '../selectors/widget';
import type { SegmentDef, StepContext, StepDef } from '../scenario/types';
import { askWidget, freshWidgetSession, norm } from './helpers';
import { showGovernanceMap, verifyGovernanceMap } from './opening';

/** 형식만 맞춘 가짜 값(시험데이터.md §28 — 카드번호는 결제 시험용으로 널리 쓰이는 번호, 주민번호는 존재 확인을 하지 않은 시연 전용 값). */
export const PII_QUESTION = '카드 4111-1111-1111-1111로 결제했는데 주민번호 900101-1234567도 알려 드려야 하나요?';
export const RISK_QUESTION = '이 약을 두 배로 먹어도 되나요?';
const RAW_DIGITS = ['4111-1111-1111-1111', '900101-1234567', '4111111111111111'];

const livePath = (ids: { A: { id: string } }) => `/handoff-console/${ids.A.id}/live`;

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** 목록에서 가려진 마지막 발화(`[카드번호]`)로 이 장면의 세션을 찾는다. */
function maskedRow(ctx: StepContext) {
  return ctx.console.getByRole('row').filter({ hasText: '[카드번호]' }).first();
}

async function findMaskedSession(ctx: StepContext): Promise<{ sessionRef: string; lastUserText: string } | undefined> {
  const r = (await ctx.api.admin1.get(`/chatbots/${ctx.ids.A.id}/live-sessions`)).body as { items: Array<{ sessionRef: string; lastUserText: string }> };
  return r.items.find((i) => i.lastUserText.includes('[카드번호]'));
}

/** 걸린 기록 중 "안전 문구로 대체"(REPLACE)된 건수(API). */
async function replaceEvents(ctx: StepContext): Promise<number> {
  // 조회 기간은 필수(KST 날짜) — 화면 기본값과 같이 최근 7일
  const kstToday = new Date(Date.now() + 9 * 3_600_000);
  const to = kstToday.toISOString().slice(0, 10);
  const from = new Date(kstToday.getTime() - 6 * 86_400_000).toISOString().slice(0, 10);
  const r = (await ctx.api.admin1.get(`/chatbots/${ctx.ids.A.id}/guardrails/events`, { query: { from, to } })).body as { items?: Array<{ appliedAction?: string }> };
  return (r.items ?? []).filter((e) => e.appliedAction === 'REPLACE').length;
}

const steps: StepDef[] = [
  {
    id: 'S6-01',
    title: '개인정보가 든 질문',
    narration: ['고객이 개인정보를 그대로 입력했습니다'],
    disclosure: '입력 화면에는 입력한 그대로 보입니다',
    budgetSec: 12,
    driver: 'UI',
    account: 'admin1',
    layout: 'split',
    site: 'A',
    core: true,
    skippable: false,
    capture: 'none',
    async run(ctx) {
      // 새 대화 세션 — 앞 장면의 대화와 섞이지 않게 한다
      await freshWidgetSession(ctx, ctx.ids.A.slug);
      ctx.scratch.set('s6-01-answer', await askWidget(ctx, PII_QUESTION, 15_000));
    },
    async verify(ctx) {
      const said = String(ctx.scratch.get('s6-01-answer') ?? '');
      // 위젯 말풍선에는 입력한 그대로 보인다(정상 동작) — 그리고 챗봇은 답을 했다
      const shown = (await widget.userMessages(ctx.site).last().innerText().catch(() => '')) ?? '';
      const ok = said.length > 0 && RAW_DIGITS.some((d) => shown.includes(d));
      return { ok, expected: '입력 화면에는 입력한 그대로 · 챗봇 응답 있음', actual: `응답 ${said.length}자 · 입력 화면 ${shown.slice(0, 40)}` };
    },
  },
  {
    id: 'S6-02',
    title: '저장본 가림',
    narration: ['저장되는 기록과 관리자 화면에서는', '개인정보가 가려진 채로만 남습니다'],
    badges: ['ONPREM_STORAGE'],
    budgetSec: 15,
    driver: 'UI',
    layout: 'split',
    console: livePath,
    core: true,
    skippable: false,
    capture: 'screenshot',
    async run(ctx) {
      // 목록은 5초마다 갱신된다 — 가려진 마지막 발화 행이 나타날 때까지 대기(상한 20초)
      await ctx.waitFor(async () => (await maskedRow(ctx).count()) > 0, { timeoutMs: 20_000, intervalMs: 500, label: '진행 중 세션 목록의 가려진 발화 행' });
      await maskedRow(ctx).getByRole('link').first().click();
      await ctx.console.getByRole('heading', { name: CONSOLE_TEXT.transcript.title }).first().waitFor({ state: 'visible', timeout: 15_000 });
      await ctx.console.getByText(CONSOLE_TEXT.transcript.piiNotice, { exact: false }).first().waitFor({ state: 'visible', timeout: 15_000 });
      await ctx.console.getByText('[주민등록번호]', { exact: false }).first().waitFor({ state: 'visible', timeout: 15_000 });
    },
    async verify(ctx) {
      // 화면: 가림 표식은 있고 원문 숫자는 없다 / API(저장본): 같은 결과
      const screen = await ctx.console.locator('body').innerText();
      const screenOk = screen.includes('[카드번호]') && screen.includes('[주민등록번호]') && !RAW_DIGITS.some((d) => screen.includes(d));
      const sess = await findMaskedSession(ctx);
      if (!sess) return { ok: false, expected: '가려진 세션이 목록에 있음', actual: '찾지 못함' };
      const tr = (await ctx.api.admin1.get(`/chatbots/${ctx.ids.A.id}/live-sessions/${sess.sessionRef}/transcript`)).body as { entries: Json[] };
      const stored = JSON.stringify(tr.entries);
      const apiOk = stored.includes('[카드번호]') && stored.includes('[주민등록번호]') && !RAW_DIGITS.some((d) => stored.includes(d)) && !/4111\D*1111\D*1111\D*1111|900101\D*1234567/.test(stored);
      return { ok: screenOk && apiOk, expected: '[카드번호]·[주민등록번호] 표식 · 원문 숫자 0(화면·저장본)', actual: `화면 ${screenOk ? '정상' : '원문 노출 또는 표식 없음'} · 저장본 ${apiOk ? '정상' : '원문 노출 또는 표식 없음'}` };
    },
  },
  {
    id: 'S6-03',
    title: '위험 질문',
    narration: ['의료 조언 질문에는', '정해 둔 안전 문구로 답합니다'],
    budgetSec: 12,
    driver: 'UI',
    layout: 'split',
    core: true,
    skippable: false,
    capture: 'screenshot',
    async run(ctx) {
      ctx.scratch.set('s6-03-answer', await askWidget(ctx, RISK_QUESTION, 15_000));
    },
    async verify(ctx) {
      const said = String(ctx.scratch.get('s6-03-answer') ?? '');
      return { ok: norm(said) === norm(GUARDRAIL_A.replacementText), expected: GUARDRAIL_A.replacementText, actual: said };
    },
  },
  {
    id: 'S6-04',
    title: '걸린 기록',
    narration: ['어떤 규칙에 걸렸는지 기록됩니다', '문장은 가려진 상태로 보입니다'],
    budgetSec: 10,
    driver: 'UI',
    layout: 'console',
    core: false,
    skippable: true,
    capture: 'none',
    async run(ctx) {
      // 걸린 기록은 응답 뒤에 쌓인다 — API로 1건이 보일 때까지 기다린 뒤 화면을 연다(목록은 주기 갱신이 없다)
      await ctx.waitFor(async () => (await replaceEvents(ctx)) >= 1, { timeoutMs: 15_000, intervalMs: 500, label: '걸린 기록(안전 문구로 대체)' });
      await ctx.openConsole(`/chatbots/${ctx.ids.A.id}/guardrails/events`);
      // 같은 문구가 필터 선택지(option)에도 있으므로 표의 행으로 한정한다
      const hit = ctx.console.getByRole('row').filter({ hasText: CONSOLE_TEXT.guardrailEvents.appliedReplace }).first();
      await hit.waitFor({ state: 'visible', timeout: 15_000 });
      await hit.scrollIntoViewIfNeeded();
    },
    async verify(ctx) {
      const replace = await replaceEvents(ctx);
      return { ok: replace >= 1, expected: '안전 문구로 대체된 기록 1건 이상', actual: `대체 ${replace}건` };
    },
  },
  {
    id: 'S6-05',
    title: '데이터 지도',
    narration: ['외부로 나가는 출구는', '같은 PC의 문장 분석 서버 1곳뿐입니다'],
    badges: ['EGRESS_GATE'],
    budgetSec: 11,
    driver: 'UI',
    layout: 'console',
    console: () => '/settings/data-governance/map',
    core: false,
    skippable: true,
    // 시작 장면의 데이터 지도(S0-02)를 건너뛰었으면 이 장면이 그 역할을 하므로 핵심으로 올린다(설계 §10.7).
    promoteIfSkipped: 'S0-02',
    capture: 'none',
    async run(ctx) {
      await showGovernanceMap(ctx);
    },
    async verify(ctx) {
      return verifyGovernanceMap(ctx);
    },
  },
  {
    id: 'S6-06',
    title: '보존 기간',
    narration: ['보존 기간이 지나면', '대화 원문은 자동으로 지워집니다'],
    disclosure: '시연 PC에서는 자동 파기 작업을 꺼 두었습니다',
    badges: ['RETENTION'],
    budgetSec: 10,
    driver: 'UI',
    layout: 'console',
    console: () => '/settings/data-governance/retention',
    core: false,
    skippable: true,
    capture: 'none',
    async run(ctx) {
      await ctx.console.getByText(CONSOLE_TEXT.governance.retentionConversationKind, { exact: false }).first().waitFor({ state: 'visible', timeout: 15_000 });
    },
  },
];

export const s6Segment: Pick<SegmentDef, 'steps' | 'skipOrder'> = {
  steps,
  skipOrder: ['S6-06', 'S6-04', 'S6-05'],
};
