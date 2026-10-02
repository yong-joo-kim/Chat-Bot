// 시나리오 공용 동작 — 위젯 대화·확인 대기. 고정 지연 없이 조건 대기만 쓴다(H-S2).
import { randomUUID } from 'node:crypto';
import { BOT_A } from '../data/dataset';
import { widget } from '../selectors/widget';
import type { StepContext } from '../scenario/types';

/** 위젯 패널이 닫혀 있으면 런처를 눌러 연다(이미 열려 있으면 그대로). 입력창이 보이면 열린 것이다(인사말 말풍선은 없다). */
export async function openWidget(ctx: StepContext): Promise<void> {
  const input = widget.input(ctx.site);
  if (await input.isVisible().catch(() => false)) return;
  await widget.launcher(ctx.site).waitFor({ state: 'visible', timeout: 10_000 });
  await widget.launcher(ctx.site).click();
  await input.waitFor({ state: 'visible', timeout: 10_000 });
}

/** 위젯에 문장을 입력해 보내고, 새 봇 말풍선이 생길 때까지 기다린 뒤 그 문구를 돌려준다. */
export async function askWidget(ctx: StepContext, text: string, timeoutMs = 10_000): Promise<string> {
  await openWidget(ctx);
  const before = await widget.botMessages(ctx.site).count();
  const input = widget.input(ctx.site);
  await ctx.pace.type(input, text);
  await widget.sendButton(ctx.site).click();
  await ctx.waitFor(async () => (await widget.botMessages(ctx.site).count()) > before, { timeoutMs, label: `위젯 응답("${text}")` });
  const all = await widget.botMessages(ctx.site).allInnerTexts();
  const said = (all[all.length - 1] ?? '').trim();
  countTurn(ctx, said);
  return said;
}

/** 텍스트 비교용 정규화(공백 접기). */
export function norm(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/** 이번 공연에서 위젯으로 보낸 턴 수(통계 반영 확인용) — 장면 3의 대조 근거. */
export function countTurn(ctx: StepContext, botAnswer: string): void {
  ctx.scratch.set('widgetTurns', Number(ctx.scratch.get('widgetTurns') ?? 0) + 1);
  if (norm(botAnswer) === norm(BOT_A.fallback)) ctx.scratch.set('widgetUnanswered', Number(ctx.scratch.get('widgetUnanswered') ?? 0) + 1);
}

/** 위젯 대화 세션을 새로 시작한다 — 이전 장면의 대화가 섞이지 않게 모형 출처(무대와 같은 출처)의 저장소를 비우고 모형을 다시 연다. */
export async function freshWidgetSession(ctx: StepContext, slug: string): Promise<void> {
  await ctx.page.evaluate(() => {
    window.sessionStorage.clear();
    window.localStorage.clear();
  });
  await ctx.openSite(slug);
}

export interface EnvStatusLite {
  prod: { versionId: string; versionNo: number };
  staging: { versionId: string; versionNo: number } | null;
}

/** 환경 분리 챗봇의 운영·스테이징 포인터(API). */
export async function envStatus(ctx: StepContext, botId: string): Promise<EnvStatusLite> {
  return (await ctx.api.admin1.get(`/chatbots/${botId}/environment`)).body as EnvStatusLite;
}

/** 공개 대화 API로 한 번 묻고 첫 응답 문장을 돌려준다(별도 세션 · 화면에는 나타나지 않는다). */
export async function publicAnswer(ctx: StepContext, slug: string, message: string): Promise<string> {
  const res = await fetch(`${ctx.urls.publicApi}/public/chatbots/${slug}/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ctx.urls.stage },
    body: JSON.stringify({ sessionId: randomUUID(), message }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await res.json().catch(() => ({}))) as { outputs?: Array<{ payload?: { text?: string } }> };
  return body.outputs?.[0]?.payload?.text ?? '';
}
