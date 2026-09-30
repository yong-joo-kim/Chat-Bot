import { bootHarness, startFakeRag } from './helpers/ai-guardrails.harness';
import type { FakeRag, Harness } from './helpers/ai-guardrails.harness';
import { runParityScript } from './helpers/ai-guardrails-parity';
import { PARITY_GOLDEN } from './helpers/ai-guardrails-parity.golden';

/**
 * 가드레일(No.36) 바이트 동일 — `GUARDRAILS_ENABLED=false`(서버 긴급 스위치 = 도입 전 동작). 짝 파일
 * `ai-guardrails-byte-parity.integration.spec.ts`(기본 설정)와 **같은 골든**에 맞아야 한다 — 두 설정이 서로 같은 응답·저장값을 낸다는 뜻이다.
 * 이 설정에서는 관리 API가 그대로 동작하고(`serverEnabled=false` 표시) 판정만 꺼진다.
 */
describe('가드레일(No.36) 바이트 동일 — GUARDRAILS_ENABLED=false', () => {
  let h: Harness;
  let rag: FakeRag;

  beforeAll(async () => {
    rag = await startFakeRag();
    h = await bootHarness({ tmpPrefix: 'ai-guardrails-parity-off-', env: { RAG_BASE_URL: rag.url, RAG_STATUS_CACHE_MS: '600000', GUARDRAILS_ENABLED: 'false' } });
  }, 90_000);

  afterAll(async () => {
    await h?.close();
    await rag?.close();
  }, 20_000);

  it('공개 대화 · 보류 폴링 · 저장 userMessage/botResponse가 골든과 같다', async () => {
    const records = await runParityScript(h, rag);
    expect(records).toEqual(PARITY_GOLDEN);
  });

  it('스위치가 꺼져도 관리 API는 동작하고 서버 꺼짐을 표시하며, 규칙이 있어도 판정하지 않는다', async () => {
    const bot = await h.createChatbot('스위치꺼짐');
    const created = await h.admin('POST', `/chatbots/${bot.id}/guardrails/rules`, { name: '대체', category: 'OTHER', expressions: ['위험표현'], appliesTo: 'INBOUND', action: 'REPLACE', replacementText: '안전 문구' });
    expect(created.status).toBe(201);
    const list = await h.admin<{ meta: { serverEnabled: boolean } }>('GET', `/chatbots/${bot.id}/guardrails/rules`);
    expect(list.body.meta.serverEnabled).toBe(false);

    const res = await h.pub<{ outputs: Array<{ payload?: { text?: string } }> }>('POST', `/public/chatbots/${bot.slug}/messages`, { sessionId: h.sessionUuid(), message: '위험표현 문의' });
    expect(res.body.outputs[0].payload?.text).not.toBe('안전 문구');
    expect(await h.prisma.guardrailEvent.count({ where: { chatbotId: bot.id } })).toBe(0);
  });
});
