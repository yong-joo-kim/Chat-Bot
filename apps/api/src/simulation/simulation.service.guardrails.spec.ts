import type { OutboundVerdict } from '../guardrails/lib/types';
import { SimulationService } from './simulation.service';

/**
 * [신규 No.36] 시뮬레이터의 RAG 답 미리보기(`matchTrace.ragPreview`, ai-guardrails-설계.md §9 · D-2) — `buildMatchTrace()`만 검증한다.
 * 가드레일이 주입되지 않은 기존 시험(`simulation.service.spec.ts`)은 무수정이며 이 파일이 새 경로를 덮는다.
 */
type BuildMatchTrace = (
  semantic: { ranked: unknown[] },
  thresholds: { accept: number; low: number; margin: number },
  settings: Record<string, unknown>,
  useRag: boolean,
  questionText: string | undefined,
  chatbotId: string,
  fallbackText: string,
) => Promise<{ ragUsed: boolean; ragPreview?: unknown; ragSourceCount?: number }>;

const RAG_RESPONSE = { result: `가림 대상 901231-1234567 안내입니다.`, keywords: [], source_info: { total_sources: 2, sources: [] }, retrieval_success: 1 };

function makeService(guardrails?: { evaluateOutbound: jest.Mock; toRagPreview: jest.Mock }) {
  const ragHttpClient = { isConfigured: () => true, query: jest.fn().mockResolvedValue({ networkError: false, httpStatus: 200, body: RAG_RESPONSE, retryAfterMs: null }) };
  const ragGate = { tryAcquire: () => true, release: jest.fn(), recordSuccess: jest.fn(), recordFailure: jest.fn() };
  const args: unknown[] = new Array(14).fill(undefined);
  args[3] = undefined; // answerSettingsCache — 이 경로에서 쓰지 않는다.
  args[4] = ragHttpClient;
  args[5] = ragGate;
  args[13] = guardrails;
  const service = new SimulationService(...(args as ConstructorParameters<typeof SimulationService>));
  return { service, ragHttpClient, build: (service as unknown as { buildMatchTrace: BuildMatchTrace }).buildMatchTrace.bind(service) };
}

const settings = { ragEnabled: true, ragCompany: '테스트회사', ragCategory: null, ragSubcategory: null, ragSimilarityThreshold: null, ragTimeoutMs: 120000 };
const thresholds = { accept: 0.8, low: 0.6, margin: 0.05 };

describe('SimulationService.buildMatchTrace — ragPreview', () => {
  it('가드레일이 주입되지 않으면 ragPreview 키가 생기지 않는다(기존 응답과 동일)', async () => {
    const { build } = makeService();
    const trace = await build({ ranked: [] }, thresholds, settings, true, '질문입니다', 'bot-1', '폴백');
    expect(trace.ragUsed).toBe(true);
    expect('ragPreview' in trace).toBe(false);
  });

  it('RAG 답이 성공하면 운영과 같은 절단 뒤 출구 판정을 하고 미리보기를 싣는다(이벤트 기록은 하지 않는다)', async () => {
    const verdict: OutboundVerdict = { kind: 'MASKED', text: '가림 대상 [주민등록번호] 안내입니다.', hits: [], piiCounts: { RRN: 1 } };
    const guardrails = {
      evaluateOutbound: jest.fn().mockResolvedValue(verdict),
      toRagPreview: jest.fn().mockResolvedValue({ outcome: 'MASKED', finalText: verdict.text, ruleNames: [], piiCounts: { RRN: 1 } }),
      recordEvents: jest.fn(),
    };
    const { build } = makeService(guardrails);
    const trace = await build({ ranked: [] }, thresholds, settings, true, '질문입니다', 'bot-1', '기본 폴백 문구');

    expect(guardrails.evaluateOutbound).toHaveBeenCalledWith('bot-1', RAG_RESPONSE.result);
    expect(guardrails.toRagPreview).toHaveBeenCalledWith(verdict, RAG_RESPONSE.result, '기본 폴백 문구');
    expect(trace.ragPreview).toMatchObject({ outcome: 'MASKED', finalText: '가림 대상 [주민등록번호] 안내입니다.' });
    expect(guardrails.recordEvents).not.toHaveBeenCalled();
  });

  it('2,000자를 넘는 답은 운영과 같이 절단한 텍스트로 판정한다', async () => {
    const guardrails = {
      evaluateOutbound: jest.fn().mockResolvedValue({ kind: 'PASS', text: '', hits: [], piiCounts: {} }),
      toRagPreview: jest.fn().mockResolvedValue({ outcome: 'PASS', finalText: '', ruleNames: [], piiCounts: {} }),
    };
    const { build, ragHttpClient } = makeService(guardrails);
    ragHttpClient.query.mockResolvedValue({ networkError: false, httpStatus: 200, body: { ...RAG_RESPONSE, result: '가'.repeat(2500) }, retryAfterMs: null });
    await build({ ranked: [] }, thresholds, settings, true, '질문입니다', 'bot-1', '폴백');
    const judged = guardrails.evaluateOutbound.mock.calls[0][1] as string;
    expect(judged).toHaveLength(2001);
    expect(judged.endsWith('…')).toBe(true);
  });

  it('useRag=false(입구 대체·AI로 안 보냄이면 호출부가 false로 넘긴다)이면 RAG도 미리보기도 없다', async () => {
    const guardrails = { evaluateOutbound: jest.fn(), toRagPreview: jest.fn() };
    const { build, ragHttpClient } = makeService(guardrails);
    const trace = await build({ ranked: [] }, thresholds, settings, false, '질문입니다', 'bot-1', '폴백');
    expect(ragHttpClient.query).not.toHaveBeenCalled();
    expect(trace.ragUsed).toBe(false);
    expect(guardrails.evaluateOutbound).not.toHaveBeenCalled();
  });
});
