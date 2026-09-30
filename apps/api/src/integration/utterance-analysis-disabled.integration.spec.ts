import { randomUUID } from 'node:crypto';
import { csvOf, multipartBody, startHarness, topicSentences } from './helpers/utterance-analysis.harness';
import type { Harness } from './helpers/utterance-analysis.harness';

/**
 * 발화 묶음 분석(No.21) 통합 시험 — `UTTERANCE_ANALYSIS_ENABLED=false`(설계서 §12 · §18.1). 13개 핸들러가 전부
 * `404`이고(콘솔은 capability `404`면 메뉴를 숨긴다) 분석 행이 생기지 않으며 다른 기능은 영향이 없다.
 */

type Any = Record<string, any>;
const BASE = (chatbotId: string) => `/chatbots/${chatbotId}/utterance-analyses`;

describe('발화 묶음 분석(No.21) 통합 시험 — 기능 끔', () => {
  let h: Harness;
  let bot: string;

  beforeAll(async () => {
    h = await startHarness({ env: { UTTERANCE_ANALYSIS_ENABLED: 'false' } });
    bot = await h.createChatbot('기능 끔 봇');
  }, 120_000);

  afterAll(async () => {
    await h?.close();
  }, 30_000);

  it('13개 핸들러가 전부 404(권한이 있어도)', async () => {
    const id = randomUUID();
    const file = { name: 'a.csv', content: csvOf([...topicSentences('환불'), ...topicSentences('배송')]) };
    const calls: Array<[string, string, { raw?: { contentType: string; body: Buffer }; json?: unknown }]> = [
      ['GET', `${BASE(bot)}/template?format=xlsx`, {}],
      ['GET', `${BASE(bot)}/capability`, {}],
      ['POST', `${BASE(bot)}/preview`, { raw: multipartBody(file) }],
      ['POST', BASE(bot), { raw: multipartBody(file, { conditions: '{}' }) }],
      ['GET', BASE(bot), {}],
      ['GET', `${BASE(bot)}/${id}`, {}],
      ['GET', `${BASE(bot)}/${id}/utterances`, {}],
      ['PATCH', `${BASE(bot)}/${id}/clusters/${id}`, { json: { customName: '이름' } }],
      ['GET', `${BASE(bot)}/${id}/export`, {}],
      ['POST', `${BASE(bot)}/${id}/apply/preview`, { json: { utteranceIds: [id], target: { kind: 'NEW', intentName: '가나' } } }],
      ['POST', `${BASE(bot)}/${id}/apply`, { json: { utteranceIds: [id], target: { kind: 'NEW', intentName: '가나' } } }],
      ['POST', `${BASE(bot)}/${id}/cancel`, {}],
      ['DELETE', `${BASE(bot)}/${id}`, {}],
    ];
    expect(calls).toHaveLength(13);
    for (const [method, path, opts] of calls) {
      const res = await h.api<Any>(method, path, opts);
      expect({ method, path, status: res.status }).toEqual({ method, path, status: 404 });
    }
    expect(await h.prisma.utteranceAnalysis.count()).toBe(0);
  });

  it('다른 기능은 영향이 없다(챗봇 조회 200)', async () => {
    expect((await h.api('GET', `/chatbots/${bot}`)).status).toBe(200);
    expect((await h.api('GET', `/chatbots/${bot}/intents`)).status).toBe(200);
  });
});
