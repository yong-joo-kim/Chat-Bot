import * as http from 'node:http';
import { bootHarness, eventually } from './helpers/ai-guardrails.harness';
import type { Harness } from './helpers/ai-guardrails.harness';

/**
 * L-5(2026-10-01 PM) — 저장·송신 마스킹의 날짜 제외 + 생년월일 문맥 예외를 공개 대화 경로로 확인한다(AC-L5-1·6·7).
 * - 대화 기록(`ConversationLog.userMessage`): 독립 날짜는 원문, 같은 메시지 안 생년월일 문맥 날짜는 `[계좌번호]`.
 * - 외부 RAG 질의 본문: 같은 규칙(저장·송신 경로가 `maskPii` 1벌을 공유).
 * 레거시 슬롯 값 송신은 슬롯 값에 문맥이 없는 점(U-12)만 단위 시험(pii-mask)으로 고정한다.
 */
function startCapturingRag(): Promise<{ url: string; bodies: string[]; close: () => Promise<void> }> {
  const bodies: string[] = [];
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const respond = (status: number, body: unknown): void => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(body));
      };
      if (req.method === 'GET' && req.url === '/api/status') {
        respond(200, { status: 'healthy', vllm_ready: true });
        return;
      }
      if (req.method === 'POST' && req.url === '/api/rag/query') {
        let raw = '';
        req.on('data', (c) => (raw += c));
        req.on('end', () => {
          bodies.push(raw);
          respond(200, { result: '답변입니다.', keywords: [], source_info: { total_sources: 1, common_metadata: { company: '테스트회사' }, sources: [] }, retrieval_success: 1 });
        });
        return;
      }
      respond(404, { detail: 'not found' });
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve({ url: `http://127.0.0.1:${port}`, bodies, close: () => new Promise((r) => server.close(() => r())) });
    });
  });
}

describe('저장·송신 마스킹 날짜 제외(L-5)', () => {
  let h: Harness;
  let rag: Awaited<ReturnType<typeof startCapturingRag>>;

  beforeAll(async () => {
    rag = await startCapturingRag();
    h = await bootHarness({ tmpPrefix: 'storage-mask-dates-', env: { RAG_BASE_URL: rag.url, RAG_STATUS_CACHE_MS: '600000' } });
  }, 90_000);

  afterAll(async () => {
    await h?.close();
    await rag?.close();
  }, 20_000);

  async function send(bot: { slug: string }, message: string): Promise<string> {
    const res = await h.pub<{ messageId: string }>('POST', `/public/chatbots/${bot.slug}/messages`, { sessionId: h.sessionUuid(), message });
    expect(res.status).toBe(200);
    const log = await eventually(() => h.prisma.conversationLog.findUnique({ where: { id: res.body.messageId } }));
    return log!.userMessage;
  }

  it('AC-L5-1·6·7: 대화 기록은 독립 날짜 원문 · 생년월일 문맥 날짜는 [계좌번호]', async () => {
    const bot = await h.createChatbot('날짜저장');
    expect(await send(bot, '2026-09-30 배송 문의 계좌 110-234-567890')).toBe('2026-09-30 배송 문의 계좌 [계좌번호]');
    expect(await send(bot, '생년월일 1990-05-12 로 조회')).toBe('생년월일 [계좌번호] 로 조회');
    expect(await send(bot, '발생일 2026-09-30 생일 선물 2026-10-01')).toBe('발생일 2026-09-30 생일 선물 2026-10-01');
    expect(await send(bot, '2026-13-01 확인')).toBe('[계좌번호] 확인');
  });

  it('AC-L5-10·11(2차): 확장된 문맥 표기는 [계좌번호], 목록 밖은 날짜 원문', async () => {
    const bot = await h.createChatbot('날짜저장2차');
    expect(await send(bot, '생년월일 (양력) 1990-05-12')).toBe('생년월일 (양력) [계좌번호]');
    expect(await send(bot, 'Birth date: 1990-05-12')).toBe('Birth date: [계좌번호]');
    expect(await send(bot, '생년월일 - 1990-05-12')).toBe('생년월일 - [계좌번호]');
    expect(await send(bot, '생일 ::::: 1990-05-12')).toBe('생일 ::::: 1990-05-12');
    expect(await send(bot, '1990-05-12 (생년월일)')).toBe('1990-05-12 (생년월일)');
  });

  it('AC-T5-1(규칙 v3): 구분자 없는 16자리 카드는 끝자리 노출 없이 [카드번호] · AMEX 공백형도 가려진다', async () => {
    const bot = await h.createChatbot('카드저장');
    expect(await send(bot, '카드 4111111111111111 결제 문의')).toBe('카드 [카드번호] 결제 문의');
    expect(await send(bot, '카드 3782 822463 10005 결제')).toBe('카드 [카드번호] 결제');
  });

  it('외부 RAG 질의 본문도 같은 규칙이다(일반 날짜 원문 · 생년월일 문맥 가림)', async () => {
    const ragBot = await h.createChatbot('날짜RAG');
    const put = await h.admin('PUT', `/chatbots/${ragBot.id}/answer-settings`, { semanticEnabled: false, ragEnabled: true, ragCompany: '테스트회사' });
    expect(put.status).toBe(200);

    await send(ragBot, '배송일 2026-09-30 계좌 110-234-567890 문의');
    await send(ragBot, '생년월일 1990-05-12 확인 요청');
    await eventually(async () => rag.bodies.length >= 2, 8000);

    const joined = rag.bodies.join('\n');
    expect(joined).toContain('배송일 2026-09-30 계좌 [계좌번호] 문의');
    expect(joined).toContain('생년월일 [계좌번호] 확인 요청');
    expect(joined).not.toContain('110-234-567890');
    expect(joined).not.toContain('1990-05-12');
  });
});
