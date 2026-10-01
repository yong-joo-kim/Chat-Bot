// 시나리오 공용 동작 — 위젯 대화·확인 대기. 고정 지연 없이 조건 대기만 쓴다(H-S2).
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
