import { eventually } from './ai-guardrails.harness';
import type { FakeRag, Harness } from './ai-guardrails.harness';

/**
 * 가드레일(No.36) 바이트 동일 시험의 공용 스크립트 — 규칙 0 · 가림 종류 기본(주민번호·카드 — 입력에 없음)인 챗봇의 공개 대화·보류 폴링
 * 응답과 저장 `userMessage`/`botResponse`가 `GUARDRAILS_ENABLED=false`(도입 전 동작)와 같은지 골든으로 고정한다.
 * `ConfigModule` 스냅샷 때문에 두 설정은 서로 다른 프로세스(spec 파일)에서 각각 같은 골든과 비교한다(CLAUDE.md 규약).
 */

interface Step {
  message: string;
  useRag: boolean;
}

export interface ParityRecord {
  message: string;
  status: number;
  outputTexts: string[];
  outputTypes: string[];
  keys: string[];
  stateReset: boolean;
  pending: boolean;
  poll: { status: string; outputTexts: string[]; keys: string[] } | null;
  storedUserMessage: string | null;
  storedBotResponse: string | null;
  isAnswered: boolean | null;
  answeredByRag: boolean | null;
  guardrailStage: string | null;
}

const RAG_ANSWER = 'RAG 답변 본문입니다. 문의는 010-1234-5678 로, 날짜는 2026-09-30 입니다.';

export async function runParityScript(h: Harness, rag: FakeRag): Promise<ParityRecord[]> {
  rag.answer = RAG_ANSWER;

  const engine = await h.createChatbot('바이트동일-엔진');
  const keyword = `동일키워드${engine.id.slice(0, 6)}`;
  const kw = await h.admin<{ id: string }>('POST', `/chatbots/${engine.id}/keywords`, { name: keyword, synonyms: [] });
  await h.admin('POST', `/chatbots/${engine.id}/dialog-nodes`, { name: '응답', nodeType: 'NORMAL', keywordIds: [kw.body.id], outputs: [{ type: 'TEXT', payload: { text: '엔진 답변입니다.' } }] });

  const ragBot = await h.createChatbot('바이트동일-RAG');
  const put = await h.admin('PUT', `/chatbots/${ragBot.id}/answer-settings`, { semanticEnabled: false, ragEnabled: true, ragCompany: '테스트회사' });
  if (put.status !== 200) throw new Error(`answer-settings 저장 실패: ${put.status}`);

  const steps: Array<Step & { bot: { id: string; slug: string } }> = [
    { message: `${keyword} 문의`, useRag: false, bot: engine },
    { message: '연락처 010-1234-5678 주민 901231-1234567 입니다', useRag: false, bot: engine },
    { message: '문서에서 찾아줄 질문입니다', useRag: true, bot: ragBot },
  ];

  const norm = (value: string | null): string | null => (value === null ? null : value.split(keyword).join('{KW}'));
  const records: ParityRecord[] = [];
  for (const step of steps) {
    const res = await h.pub<{ messageId: string; outputs: Array<{ type: string; payload?: { text?: string } }>; stateReset: boolean; pendingAnswer?: unknown }>('POST', `/public/chatbots/${step.bot.slug}/messages`, {
      sessionId: h.sessionUuid(),
      message: step.message,
    });
    let poll: ParityRecord['poll'] = null;
    if (res.body.pendingAnswer) {
      const done = await eventually(async () => {
        const r = await h.pub<{ status: string; outputs: Array<{ payload?: { text?: string } }> }>('GET', `/public/chatbots/${step.bot.slug}/messages/${res.body.messageId}`);
        return r.body.status !== 'PENDING' ? r : null;
      }, 8000);
      if (done) poll = { status: done.body.status, outputTexts: done.body.outputs.map((o) => o.payload?.text ?? ''), keys: Object.keys(done.body) };
    }
    const log = await eventually(() => h.prisma.conversationLog.findUnique({ where: { id: res.body.messageId } }));
    records.push({
      message: norm(step.message) as string,
      status: res.status,
      outputTexts: res.body.outputs.map((o) => o.payload?.text ?? ''),
      outputTypes: res.body.outputs.map((o) => o.type),
      keys: Object.keys(res.body),
      stateReset: res.body.stateReset,
      pending: !!res.body.pendingAnswer,
      poll,
      storedUserMessage: norm(log?.userMessage ?? null),
      storedBotResponse: log?.botResponse ?? null,
      isAnswered: log?.isAnswered ?? null,
      answeredByRag: log?.answeredByRag ?? null,
      guardrailStage: log?.guardrailStage ?? null,
    });
  }
  return records;
}
