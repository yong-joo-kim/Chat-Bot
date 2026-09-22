import { ConfigService } from '@nestjs/config';
import { RagHttpClient } from './rag-http.client';

/**
 * `RagHttpClient`(ADR-0022, J-5/J-6 — 외부 RAG 서버로 나가는 유일한 출구) 단위 시험.
 * `rag-allowlist.spec.ts`는 저장소 전체의 **문자열 정적 검사**(파괴적 엔드포인트 0건)만 하고,
 * `rag-answer.service.spec.ts`는 `RagHttpClient` 자체를 모킹해 오케스트레이션만 검증한다 —
 * "실제로 나가는 HTTP 요청의 모양"(AC-N2-2: `provider`/`Content-Type`, FR-N2-9/10)을 검증하는
 * 테스트가 없었다.
 */
function makeConfig(overrides: Record<string, unknown> = {}): ConfigService {
  return { get: (key: string) => (key in overrides ? overrides[key] : undefined) } as unknown as ConfigService;
}

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) } as Response;
}

describe('RagHttpClient', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it('RAG_BASE_URL이 설정돼 있으면 isConfigured()가 true다', () => {
    const client = new RagHttpClient(makeConfig({ RAG_BASE_URL: 'http://rag.example.test' }));
    expect(client.isConfigured()).toBe(true);
  });

  it('RAG_BASE_URL이 없으면 isConfigured()가 false이고, query()도 fetch 없이 즉시 networkError를 반환한다', async () => {
    const client = new RagHttpClient(makeConfig());
    expect(client.isConfigured()).toBe(false);
    const result = await client.query({ question: '질문', company: '회사' }, 120_000);
    expect(result).toEqual({ networkError: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('AC-N2-2: query()는 POST /api/rag/query로 provider="pdf" 고정값과 Content-Type 헤더를 함께 보낸다', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ result: '답변', keywords: [], source_info: null, retrieval_success: 1 }));
    const client = new RagHttpClient(makeConfig({ RAG_BASE_URL: 'http://rag.example.test' }));

    await client.query({ question: '배송 언제 오나요', company: '테스트기관', category: '배송', subcategory: '조회' }, 120_000);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://rag.example.test/api/rag/query');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({
      question: '배송 언제 오나요',
      company: '테스트기관',
      provider: 'pdf',
      category: '배송',
      subcategory: '조회',
    });
  });

  it('FR-N2-8: similarityThreshold를 지정하지 않으면 similarity_threshold 필드 자체를 보내지 않는다', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ result: '답변', keywords: [], source_info: null, retrieval_success: 1 }));
    const client = new RagHttpClient(makeConfig({ RAG_BASE_URL: 'http://rag.example.test' }));

    await client.query({ question: '질문', company: '회사' }, 120_000);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body).not.toHaveProperty('similarity_threshold');
  });

  it('FR-N2-10: question/company/category/subcategory는 200자를 초과해 보내지 않는다', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ result: '답변', keywords: [], source_info: null, retrieval_success: 1 }));
    const client = new RagHttpClient(makeConfig({ RAG_BASE_URL: 'http://rag.example.test' }));
    const longText = '가'.repeat(250);

    await client.query({ question: longText, company: longText }, 120_000);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as { question: string; company: string };
    expect(body.question).toHaveLength(200);
    expect(body.company).toHaveLength(200);
  });

  it('AC-N2-1류: status()/documentMetadata()는 allowlist 경로(GET /api/status, GET /api/documents/metadata)만 호출한다', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ status: 'healthy', vllm_ready: true }));
    fetchMock.mockResolvedValueOnce(jsonResponse({ result: 'metadata text' }));
    const client = new RagHttpClient(makeConfig({ RAG_BASE_URL: 'http://rag.example.test' }));

    await client.status();
    await client.documentMetadata();

    expect(fetchMock.mock.calls[0][0]).toBe('http://rag.example.test/api/status');
    expect(fetchMock.mock.calls[0][1].method).toBe('GET');
    expect(fetchMock.mock.calls[1][0]).toBe('http://rag.example.test/api/documents/metadata');
    expect(fetchMock.mock.calls[1][1].method).toBe('GET');
  });

  it('네트워크 예외(타임아웃 포함)는 networkError:true로 수렴하고 예외를 전파하지 않는다', async () => {
    fetchMock.mockRejectedValueOnce(new DOMException('The operation was aborted', 'AbortError'));
    const client = new RagHttpClient(makeConfig({ RAG_BASE_URL: 'http://rag.example.test' }));

    const result = await client.query({ question: '질문', company: '회사' }, 100);
    expect(result).toEqual({ networkError: true });
  });

  it('HTTP 오류 상태(503)는 networkError:false와 함께 상태코드·본문을 그대로 전달한다(판정은 상위 계층 책임)', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ code: 'SERVER_OVERLOAD' }, 503));
    const client = new RagHttpClient(makeConfig({ RAG_BASE_URL: 'http://rag.example.test' }));

    const result = await client.query({ question: '질문', company: '회사' }, 120_000);
    expect(result).toEqual({ networkError: false, httpStatus: 503, body: { code: 'SERVER_OVERLOAD' } });
  });

  it('본문이 JSON으로 파싱되지 않으면(HTML/평문 응답) body가 undefined다(SCHEMA_INVALID 판정은 상위 계층 책임)', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, text: async () => '<html>error</html>' } as Response);
    const client = new RagHttpClient(makeConfig({ RAG_BASE_URL: 'http://rag.example.test' }));

    const result = await client.query({ question: '질문', company: '회사' }, 120_000);
    expect(result).toEqual({ networkError: false, httpStatus: 200, body: undefined });
  });
});
