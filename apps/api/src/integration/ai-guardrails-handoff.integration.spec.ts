import type { GuardrailRule } from '@chat-bot/shared-types';
import { bootHarness, eventually } from './helpers/ai-guardrails.harness';
import type { Harness } from './helpers/ai-guardrails.harness';
import { waitForLiveSessionRef } from './helpers/eventual.helper';

/**
 * AC-AG3-3(ai-guardrails-설계.md §18.6) — 상담 개입 중인 세션은 상담원에게 그대로 전달되고 가드레일은 적용되지 않는다(이벤트 0).
 * 하이브리드 CS 게이트(②.7)가 입구 판정(③.6)보다 앞서므로, 규칙 표현이 든 발화가 대체 문구로 바뀌지 않아야 한다.
 */
const REPLACEMENT = '지금은 안내드릴 수 없어요. 전문 상담 기관에 연락해 주세요.';

describe('AI 거버넌스·가드레일(No.36) × 하이브리드 CS 통합 시험', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await bootHarness({ tmpPrefix: 'ai-guardrails-handoff-test-', env: {} });
  }, 90_000);

  afterAll(async () => {
    await h?.close();
  }, 20_000);

  it('AC-AG3-3: 상담 개입 중 세션에서 규칙 표현을 입력해도 대체 문구·이벤트가 없고 상담 연결 응답이 나간다', async () => {
    const bot = await h.createChatbot('상담개입');
    const settings = await h.admin('PUT', `/chatbots/${bot.id}/handoff-settings`, {
      enabled: true,
      cautionThreshold: 1,
      warningThreshold: 2,
      activeWindowMinutes: 10,
      userIdleMinutes: 10,
      agentNoReplyMinutes: 5,
      connectNotice: '상담원이 연결되었어요.',
      endNotice: '상담이 종료되었어요.',
      failNotice: '연결이 어려워요.',
    });
    expect(settings.status).toBe(200);
    const rule = await h.admin<GuardrailRule>('POST', `/chatbots/${bot.id}/guardrails/rules`, {
      name: '위기규칙',
      category: 'CRISIS_SELF_HARM',
      expressions: ['위험표현'],
      appliesTo: 'INBOUND',
      action: 'REPLACE',
      replacementText: REPLACEMENT,
    });
    expect(rule.status).toBe(201);

    const sessionId = h.sessionUuid();
    // 미응답 턴 1건으로 진행 중 상담 목록에 세션을 올린다(규칙 표현이 없는 발화).
    await h.pub('POST', `/public/chatbots/${bot.slug}/messages`, { sessionId, message: '이해할 수 없는 질문입니다' });
    const sessionRef = await waitForLiveSessionRef(() => h.admin<{ items?: Array<{ sessionRef: string }> }>('GET', `/chatbots/${bot.id}/live-sessions`));
    const intervened = await h.admin<{ id: string }>('POST', `/chatbots/${bot.id}/live-sessions/${sessionRef}/handoff`, {});
    expect(intervened.status).toBe(201);

    // 개입 중 규칙 표현 입력 — 상담 게이트가 먼저 처리한다.
    const res = await h.pub<{ messageId: string; outputs: Array<{ payload?: { text?: string } }>; handoff?: { status: string } }>('POST', `/public/chatbots/${bot.slug}/messages`, {
      sessionId,
      message: '위험표현이 들어간 문장',
      features: ['handoff-v1'],
    });
    expect(res.status).toBe(200);
    const handoffMessageId = res.body.messageId;
    expect(res.body.handoff?.status).toBe('CONNECTED');
    expect(res.body.outputs.map((o) => o.payload?.text ?? '').join('\n')).not.toContain(REPLACEMENT);

    // 대조군: 개입 중이 아닌 다른 세션은 같은 표현에 대체 문구가 나간다(규칙이 실제로 켜져 있음을 확인).
    const control = await h.pub<{ messageId: string; outputs: Array<{ payload?: { text?: string } }> }>('POST', `/public/chatbots/${bot.slug}/messages`, { sessionId: h.sessionUuid(), message: '위험표현이 들어간 문장' });
    expect(control.body.outputs.map((o) => o.payload?.text ?? '').join(' ')).toContain(REPLACEMENT);
    // 대조군 이벤트 1건이 적재될 때까지 기다린 뒤(fire-and-forget), 개입 세션 턴의 이벤트·INBOUND 표식은 0인지 확인한다.
    await eventually(async () => (await h.prisma.guardrailEvent.count({ where: { messageId: control.body.messageId } })) > 0);
    expect(await h.prisma.guardrailEvent.count({ where: { messageId: handoffMessageId } })).toBe(0);
    expect(await h.prisma.guardrailEvent.count({ where: { chatbotId: bot.id } })).toBe(1);
    const logs = await h.prisma.conversationLog.findMany({ where: { chatbotId: bot.id, guardrailStage: 'INBOUND' }, select: { id: true } });
    expect(logs.map((l) => l.id)).not.toContain(handoffMessageId);
  });
});
