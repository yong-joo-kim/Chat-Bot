// 장면 5 · 버전과 배포 통제(95초) — 설계 §10.6. 운영 전환은 두 번째 관리자의 승인이 있어야 실행되고, 문제가 생기면 직전 버전으로 즉시 되돌린다.
// 챗봇 B = 라이브(요청 → 승인 → 위젯 답 변경 → 즉시 되돌리기), 챗봇 C = 예약 전용(공연 시작 T0에 만든 예약이 실행되는 것을 확인).
import { BOT_B } from '../data/dataset';
import { consoleUi, CONSOLE_TEXT } from '../selectors/console';
import type { SegmentDef, StepContext, StepDef } from '../scenario/types';
import { askWidget, envStatus, norm, publicAnswer } from './helpers';

const envPath = (ids: { B: { id: string } }) => `/chatbots/${ids.B.id}/environment`;
const E = CONSOLE_TEXT.environment;

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** 대화상자 안의 체크박스(경고 확인 등)를 모두 켠다 — 경고가 없으면 아무 것도 하지 않는다. */
async function checkAllInDialog(ctx: StepContext): Promise<void> {
  const boxes = consoleUi.dialog(ctx.console).getByRole('checkbox');
  const n = await boxes.count();
  for (let i = 0; i < n; i++) {
    const box = boxes.nth(i);
    if (!(await box.isChecked())) await box.check();
  }
}

/** 챗봇 C의 환경 화면을 열어 전환 이력에 "예약 전환 실행" 행이 나타난 것을 보인다(`targetVersionId`가 있으면 운영 버전이 그것인지도 API로 확인). */
async function showScheduledRow(ctx: StepContext, targetVersionId?: string): Promise<void> {
  await ctx.openConsole(`/chatbots/${ctx.ids.C.id}/environment`);
  const row = ctx.console.getByRole('row').filter({ hasText: E.historyScheduled }).first();
  await row.waitFor({ state: 'visible', timeout: 15_000 });
  await row.scrollIntoViewIfNeeded();
  if (targetVersionId) {
    const env = await envStatus(ctx, ctx.ids.C.id);
    if (env.prod.versionId !== targetVersionId) throw new Error('예약 실행 뒤 운영 버전이 대상 버전과 다릅니다');
  }
}

async function scheduleStatus(ctx: StepContext, botId: string, scheduleId: string): Promise<string | undefined> {
  const s = (await ctx.api.admin1.get(`/chatbots/${botId}/deploy-schedules/${scheduleId}`)).body as Json;
  return s.status as string | undefined;
}

const steps: StepDef[] = [
  {
    id: 'S5-01',
    title: '환경 현황',
    narration: ['운영·스테이징·초안이 나뉘어 있습니다', '운영 전환에는 두 사람이 필요합니다'],
    budgetSec: 10,
    driver: 'UI',
    account: 'admin1',
    layout: 'split',
    site: 'B',
    console: envPath,
    core: true,
    skippable: false,
    capture: 'none',
    async run(ctx) {
      const { v1, v2 } = ctx.ids.B;
      await ctx.console.getByText(E.headerBadge(v1.versionNo, v2.versionNo), { exact: false }).first().waitFor({ state: 'visible', timeout: 15_000 });
      await ctx.console.getByText(E.policyOnPrefix, { exact: false }).first().waitFor({ state: 'visible', timeout: 15_000 });
    },
    async verify(ctx) {
      const env = await envStatus(ctx, ctx.ids.B.id);
      const policy = ((await ctx.api.admin1.get(`/chatbots/${ctx.ids.B.id}/environment/approval`)).body as Json).policy as Json;
      const ok = env.prod.versionNo === ctx.ids.B.v1.versionNo && env.staging?.versionNo === ctx.ids.B.v2.versionNo && policy.required === true;
      return { ok, expected: `운영 v${ctx.ids.B.v1.versionNo} · 스테이징 v${ctx.ids.B.v2.versionNo} · 2인 승인 켜짐`, actual: `운영 v${env.prod.versionNo} · 스테이징 v${env.staging?.versionNo} · 2인 승인 ${policy.required ? '켜짐' : '꺼짐'}` };
    },
  },
  {
    id: 'S5-02',
    title: '운영 전환 요청',
    narration: ['관리자 1이 운영 전환을 요청합니다', '승인되기 전에는 운영이 바뀌지 않습니다'],
    badges: ['HUMAN_APPROVAL'],
    budgetSec: 15,
    driver: 'UI',
    layout: 'split',
    core: true,
    skippable: false,
    capture: 'none',
    async run(ctx) {
      await ctx.console.getByRole('button', { name: E.requestButton, exact: true }).click();
      const dlg = consoleUi.dialog(ctx.console);
      const send = dlg.getByRole('button', { name: E.requestConfirm(ctx.ids.B.v2.versionNo) });
      await send.waitFor({ state: 'visible', timeout: 15_000 });
      await checkAllInDialog(ctx);
      await send.click();
      await consoleUi.toast(ctx.console, E.requestSuccess).waitFor({ state: 'visible', timeout: 15_000 });
    },
    async verify(ctx) {
      const st = (await ctx.api.admin1.get(`/chatbots/${ctx.ids.B.id}/environment/approval`)).body as Json;
      const p = st.pending as Json | null;
      const ok = !!p && p.status === 'PENDING' && p.target?.versionId === ctx.ids.B.v2.versionId && p.requestedBy?.email === ctx.ids.accounts.admin1.email;
      if (p?.id) ctx.scratch.set('s5-02-request', p.id);
      return { ok, expected: '승인 대기 요청 1건(요청자 관리자 1 · 대상 v2)', actual: p ? `${p.status} · ${p.requestedBy?.email}` : '대기 요청 없음' };
    },
  },
  {
    id: 'S5-03',
    title: '두 번째 관리자 승인',
    narration: ['다른 관리자(관리자 2)가 승인합니다', '본인이 요청한 건은 본인이 승인할 수 없습니다'],
    badges: ['HUMAN_APPROVAL'],
    budgetSec: 20,
    driver: 'UI',
    account: 'admin2',
    layout: 'split',
    console: () => '/environment-approvals',
    core: true,
    skippable: false,
    capture: 'screenshot',
    async run(ctx) {
      const link = ctx.console.getByRole('link', { name: CONSOLE_TEXT.approvals.detailLinkLabel(ctx.ids.B.name) }).first();
      await link.waitFor({ state: 'visible', timeout: 15_000 });
      await link.click();
      const approve = ctx.console.getByRole('button', { name: CONSOLE_TEXT.approvals.approveNow, exact: true });
      await approve.waitFor({ state: 'visible', timeout: 15_000 });
      // 지금 기준으로 다시 확인한 경고가 있으면 확인 체크가 필요하다(없으면 건너뜀)
      const ack = ctx.console.getByRole('checkbox');
      for (let i = 0, n = await ack.count(); i < n; i++) if (!(await ack.nth(i).isChecked())) await ack.nth(i).check();
      await approve.click();
      await consoleUi.dialog(ctx.console).getByRole('button', { name: CONSOLE_TEXT.approvals.approveConfirm, exact: true }).click();
      await ctx.console.getByText(CONSOLE_TEXT.approvals.appliedBanner(ctx.ids.B.v2.versionNo), { exact: false }).first().waitFor({ state: 'visible', timeout: 20_000 });
    },
    async verify(ctx) {
      const env = await envStatus(ctx, ctx.ids.B.id);
      return { ok: env.prod.versionNo === ctx.ids.B.v2.versionNo, expected: `운영 v${ctx.ids.B.v2.versionNo}`, actual: `운영 v${env.prod.versionNo}` };
    },
  },
  {
    id: 'S5-04',
    title: '위젯 답 변경',
    narration: ['고객 화면의 답이 새 버전으로 바뀌었습니다'],
    budgetSec: 12,
    driver: 'UI',
    layout: 'split',
    core: true,
    skippable: false,
    capture: 'gif-clip',
    async run(ctx) {
      // 서버가 새 버전 응답을 내기 시작한 것을 먼저 확인한 뒤 화면에서 묻는다(번들 캐시 대비 — 별도 세션이라 화면 대화에 섞이지 않는다)
      await ctx.waitFor(async () => norm(await publicAnswer(ctx, ctx.ids.B.slug, BOT_B.question)) === norm(BOT_B.answerV2), { timeoutMs: 15_000, intervalMs: 500, label: '운영 v2 응답(공개 대화)' });
      ctx.scratch.set('s5-04-answer', await askWidget(ctx, BOT_B.question));
    },
    async verify(ctx) {
      const said = String(ctx.scratch.get('s5-04-answer') ?? '');
      return { ok: norm(said) === norm(BOT_B.answerV2), expected: BOT_B.answerV2, actual: said };
    },
  },
  {
    id: 'S5-05',
    title: '즉시 되돌리기',
    narration: ['문제가 있으면 직전 버전으로 즉시 되돌립니다', '되돌린 기록이 남습니다'],
    badges: ['AUDIT_TRAIL'],
    budgetSec: 15,
    driver: 'UI',
    account: 'admin1',
    layout: 'split',
    console: envPath,
    core: true,
    skippable: false,
    capture: 'none',
    async run(ctx) {
      const { v1, v2 } = ctx.ids.B;
      // 운영이 v2인 상태로 열렸는지 확인한 뒤 되돌린다 — 다 끝나면 머리 배지가 다시 "운영 v1"이 된다
      await ctx.console.getByText(E.headerBadge(v2.versionNo, v2.versionNo), { exact: false }).first().waitFor({ state: 'visible', timeout: 15_000 });
      await ctx.console.getByRole('button', { name: E.rollbackButton, exact: true }).click();
      const dlg = consoleUi.dialog(ctx.console);
      const confirm = dlg.getByRole('button', { name: E.soloConfirm(v1.versionNo) });
      await confirm.waitFor({ state: 'visible', timeout: 15_000 });
      // 승인 없이 바로 실행됨을 이해했다는 확인(필수)과, 경고가 있으면 경고 확인을 모두 켠다
      await dlg.getByRole('checkbox', { name: E.soloAck }).check();
      await checkAllInDialog(ctx);
      await confirm.click();
      await dlg.waitFor({ state: 'hidden', timeout: 20_000 });
      await ctx.console.getByText(E.headerBadge(v1.versionNo, v2.versionNo), { exact: false }).first().waitFor({ state: 'visible', timeout: 15_000 });
    },
    async verify(ctx) {
      const env = await envStatus(ctx, ctx.ids.B.id);
      const said = await ctx.waitFor(async () => {
        const t = await publicAnswer(ctx, ctx.ids.B.slug, BOT_B.question);
        return norm(t) === norm(BOT_B.answerV1) ? t : false;
      }, { timeoutMs: 15_000, intervalMs: 500, label: '운영 v1 응답(되돌린 뒤)' }).catch(() => '(v1 응답을 확인하지 못함)');
      return { ok: env.prod.versionNo === ctx.ids.B.v1.versionNo && norm(said) === norm(BOT_B.answerV1), expected: `운영 v${ctx.ids.B.v1.versionNo} · 응답 "${BOT_B.answerV1}"`, actual: `운영 v${env.prod.versionNo} · 응답 "${said}"` };
    },
  },
  {
    id: 'S5-06',
    title: '감사 기록',
    narration: ['누가 요청하고 누가 승인했는지', '감사 기록에 남습니다'],
    badges: ['AUDIT_TRAIL'],
    budgetSec: 10,
    driver: 'UI',
    layout: 'console',
    console: (ids) => `/settings/audit-logs?chatbotId=${ids.B.id}&chatbotName=${encodeURIComponent(ids.B.name)}`,
    core: true,
    skippable: false,
    capture: 'screenshot',
    async run(ctx) {
      const rows = ctx.console.getByRole('row').filter({ hasText: CONSOLE_TEXT.auditTargetApproval });
      await ctx.waitFor(async () => (await rows.count()) >= 2, { timeoutMs: 15_000, intervalMs: 500, label: '감사 기록의 운영 전환 승인 요청 행' });
      await rows.first().scrollIntoViewIfNeeded();
    },
    async verify(ctx) {
      const r = (await ctx.api.admin1.get('/audit-logs', { query: { chatbotId: ctx.ids.B.id, targetType: 'ProdSwitchApprovalRequest', pageSize: 50 } })).body as { items: Array<{ actorEmail: string | null }> };
      const actors = new Set(r.items.map((i) => i.actorEmail));
      const ok = actors.has(ctx.ids.accounts.admin1.email) && actors.has(ctx.ids.accounts.admin2.email);
      return { ok, expected: '요청자(관리자 1)와 승인자(관리자 2)의 기록', actual: `수행자 ${[...actors].join(', ') || '없음'}` };
    },
  },
  {
    id: 'S5-07',
    title: '예약 배포',
    narration: ['예약한 시각에 운영 챗봇이 자동으로 교체됩니다'],
    disclosure: '예약과 두 번째 관리자의 사전 승인은 시작 때 미리 처리했습니다',
    budgetSec: 13,
    driver: 'UI',
    layout: 'split',
    console: undefined,
    core: false,
    skippable: true,
    capture: 'none',
    // 무인 점검에서 실행까지 기다리는 경우(--wait-live-schedule)를 위해 단계 전체 상한을 넓힌다.
    waitMaxMs: 8 * 60_000,
    async run(ctx) {
      const live = ctx.state.liveSchedule;
      const hist = ctx.ids.C.historySchedule;
      // 보여 주는 화면은 챗봇 C의 환경 화면 "전환 이력"(방식 = 예약 전환 실행)이다 — 예약 상세 화면(/deploy-schedules/:id)은 제품이 실제 응답(ISO 문자열)을
      // 날짜 객체로 가정해 열자마자 RangeError로 빈 화면이 되므로(결함 후보 DHX-5) 쓰지 않는다.
      if (!live || live.status !== 'CREATED' || !live.scheduleId) {
        if (live?.status === 'FAILED') throw new Error(`라이브 예약을 만들지 못했습니다: ${live.error ?? '원인 미상'}`);
        // 무인 점검 기본(라이브 예약 생략): 준비 단계에서 이미 실행된 이력 예약 C-1의 실행 기록을 확인한다
        if (!hist) throw new Error('확인할 예약이 없습니다(--no-history-schedule · 라이브 예약 생략)');
        await showScheduledRow(ctx);
        ctx.scratch.set('s5-07-mode', 'history');
        return;
      }
      const status = await scheduleStatus(ctx, ctx.ids.C.id, live.scheduleId);
      const remainingMs = new Date(live.scheduledAt ?? 0).getTime() - Date.now();
      // 보이는 시연: 남은 대기가 25초(폴링 5초 포함)를 넘으면 기다리지 않고 이력 화면으로 대체한다(설계 §7.6)
      if (ctx.mode === 'visible' && status !== 'SUCCEEDED' && remainingMs + 5_000 > 25_000) {
        throw new Error(`예약 실행까지 ${Math.round(remainingMs / 1000)}초 남아 기다리지 않습니다`);
      }
      const limit = Math.min(Math.max(remainingMs, 0) + 35_000, ctx.mode === 'visible' ? 55_000 : 8 * 60_000);
      await ctx.waitFor(async () => (await scheduleStatus(ctx, ctx.ids.C.id, live.scheduleId!)) === 'SUCCEEDED', { timeoutMs: limit, intervalMs: 1000, label: '라이브 예약 실행' });
      await showScheduledRow(ctx, live.targetVersionId);
      live.finalStatus = 'SUCCEEDED';
      ctx.scratch.set('s5-07-mode', 'live');
    },
    async verify(ctx) {
      const live = ctx.state.liveSchedule;
      if (ctx.scratch.get('s5-07-mode') === 'history') {
        const s = await scheduleStatus(ctx, ctx.ids.C.id, ctx.ids.C.historySchedule!.scheduleId);
        return { ok: s === 'SUCCEEDED', expected: '이력 예약 실행 성공', actual: String(s) };
      }
      const env = await envStatus(ctx, ctx.ids.C.id);
      const want = live?.targetVersionId;
      return { ok: !!want && env.prod.versionId === want, expected: '운영 버전 = 예약 대상 버전', actual: `운영 ${env.prod.versionId.slice(0, 8)} / 대상 ${want?.slice(0, 8) ?? '없음'}` };
    },
    fallback: {
      caption: '예약 기록 화면입니다',
      notice: '준비 단계에서 같은 방식으로 실행된 기록입니다',
      async render(ctx) {
        await ctx.openConsole(`/chatbots/${ctx.ids.C.id}/environment`);
      },
    },
  },
];

export const s5Segment: Pick<SegmentDef, 'steps' | 'skipOrder'> = {
  steps,
  skipOrder: ['S5-07'],
};
