import { csvOf, multipartBody, startHarness, topicSentences } from './helpers/utterance-analysis.harness';
import type { Harness } from './helpers/utterance-analysis.harness';

/**
 * 발화 묶음 분석(No.21) 통합 시험 — 문장 분석 서비스(임베딩)가 설정되지 않은 서버(설계서 §7.4 ③ · C-12 · EX-DC-1).
 * 군집은 벡터 없이 성립하지 않으므로 대화의 "저하 모드" 같은 대체 경로가 없다 — 요청은 `503 EMBEDDING_UNAVAILABLE`이고
 * 분석 행은 만들어지지 않는다. 양식·목록·조회는 그대로 동작한다.
 */

type Any = Record<string, any>;
const BASE = (chatbotId: string) => `/chatbots/${chatbotId}/utterance-analyses`;

describe('발화 묶음 분석(No.21) 통합 시험 — 임베딩 미설정 서버', () => {
  let h: Harness;
  let bot: string;

  beforeAll(async () => {
    h = await startHarness({ noEmbedding: true });
    bot = await h.createChatbot('임베딩 없는 봇');
  }, 120_000);

  afterAll(async () => {
    await h?.close();
  }, 30_000);

  it('capability — embeddingAvailable=false', async () => {
    const res = await h.api<Any>('GET', `${BASE(bot)}/capability`);
    expect(res.status).toBe(200);
    expect(res.body.embeddingAvailable).toBe(false);
  });

  it('요청·미리보기 = 503 EMBEDDING_UNAVAILABLE · 분석 행 0', async () => {
    const start = await h.startAnalysis(bot, { name: 'a.csv', content: csvOf([...topicSentences('환불'), ...topicSentences('배송')]) }, {});
    expect({ status: start.status, code: (start.body as Any).code }).toEqual({ status: 503, code: 'EMBEDDING_UNAVAILABLE' });
    expect((start.body as Any).message).toContain('문장 분석 서비스에 연결할 수 없습니다');
    const preview = await h.api<Any>('POST', `${BASE(bot)}/preview`, { raw: multipartBody({ name: 'a.csv', content: csvOf(topicSentences('환불')) }) });
    expect({ status: preview.status, code: preview.body.code }).toEqual({ status: 503, code: 'EMBEDDING_UNAVAILABLE' });
    expect(await h.prisma.utteranceAnalysis.count()).toBe(0);
  });

  it('양식·목록·조회는 그대로 동작한다', async () => {
    expect((await h.api('GET', `${BASE(bot)}/template?format=csv`)).status).toBe(200);
    const list = await h.api<Any>('GET', BASE(bot));
    expect(list.status).toBe(200);
    expect(list.body.total).toBe(0);
  });

  it('검증 오류는 임베딩 가용성 검사(③)보다 먼저 나온다(②) — 조건이 틀리면 400', async () => {
    const res = await h.startAnalysis(bot, { name: 'a.csv', content: csvOf(topicSentences('환불')) }, { targetClusterCount: 1 });
    expect({ status: res.status, code: (res.body as Any).code }).toEqual({ status: 400, code: 'VALIDATION_FAILED' });
  });
});
