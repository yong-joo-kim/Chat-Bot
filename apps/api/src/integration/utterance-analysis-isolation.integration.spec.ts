import { LegacyApiHttpClient } from '../legacy-api/legacy-api-http.client';
import { RagHttpClient } from '../rag/rag-http.client';
import { WorkflowHttpSender } from '../workflow/dispatch/workflow-http.sender';
import { UNRELATED_SENTENCES, buildCsvFile, startHarness, topicSentences } from './helpers/utterance-analysis.harness';
import type { Harness } from './helpers/utterance-analysis.harness';

/**
 * 발화 묶음 분석(No.21) 통합 시험 — 대화 경로 격리 보강(AC-DC1-4 통계 응답 동일 · AC-DC4-2 외부 시스템 호출 0).
 * (`docs/02-spec/deep-clustering-설계.md` §20.7 — 기존 핵심 흐름 스펙에 없던 두 단언만 별도 파일로 둔다.)
 */

type Any = Record<string, any>;

describe('발화 묶음 분석(No.21) 통합 시험 — 통계·외부 호출 격리', () => {
  let h: Harness;
  let chatbotId: string;

  beforeAll(async () => {
    h = await startHarness({ env: { RAG_BASE_URL: 'http://127.0.0.1:1' } });
    chatbotId = await h.createChatbot('격리 시험봇');
    const faq = await h.api('POST', `/chatbots/${chatbotId}/faqs`, { json: { category: 'FAQ', question: '환불 신청은 어떻게 하나요', answer: '마이페이지에서 신청합니다.' } });
    expect(faq.status).toBe(201);
  }, 120_000);

  afterAll(async () => {
    await h?.close();
  }, 30_000);

  it('분석 전후 /stats/summary·/stats/dashboard 응답이 같고 RAG·레거시·웹훅 호출이 0회다(AC-DC1-4 · AC-DC4-2)', async () => {
    const to = new Date();
    const from = new Date(to.getTime() - 7 * 86_400_000);
    const range = `from=${from.toISOString()}&to=${to.toISOString()}`;
    const stats = async () => {
      const summary = await h.api<Any>('GET', `/stats/summary?chatbotId=${chatbotId}&${range}`);
      const dashboard = await h.api<Any>('GET', `/stats/dashboard?chatbotId=${chatbotId}&${range}`);
      expect(summary.status).toBe(200);
      expect(dashboard.status).toBe(200);
      return { summary: summary.body, dashboard: { ...dashboard.body, generatedAt: undefined } };
    };
    const strip = (v: Any) => JSON.parse(JSON.stringify(v, (k, x) => (k === 'generatedAt' || k === 'computedAt' ? undefined : x)));

    const rag = jest.spyOn(RagHttpClient.prototype, 'query');
    const legacy = jest.spyOn(LegacyApiHttpClient.prototype as Any, 'send' as never).mockImplementation(() => {
      throw new Error('레거시 API 호출 금지');
    });
    const webhook = jest.spyOn(WorkflowHttpSender.prototype as Any, 'send' as never).mockImplementation(() => {
      throw new Error('웹훅 호출 금지');
    });
    try {
      const before = strip(await stats());
      const sentences = ['환불 신청은 어떻게 하나요', ...UNRELATED_SENTENCES, ...topicSentences('환불').slice(1, 4)];
      const res = await h.startAnalysis(chatbotId, { name: 'u.csv', content: buildCsvFile(sentences.map((s) => [s])) }, { targetClusterCount: 2, minClusterSize: 2 });
      expect(res.status).toBe(202);
      const done = await h.waitForTerminal(chatbotId, res.body.analysisId);
      expect(done.status).toBe('SUCCEEDED');
      expect(done.probe.status).toBe('DONE');
      expect(strip(await stats())).toEqual(before);
      expect(rag).not.toHaveBeenCalled();
      expect(legacy).not.toHaveBeenCalled();
      expect(webhook).not.toHaveBeenCalled();
    } finally {
      jest.restoreAllMocks();
    }
  }, 120_000);
});
