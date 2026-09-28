import { parseIngestResponse } from './parse-ingest-response';

describe('parseIngestResponse — API_RAG.md 245~285행 응답 예시 픽스처', () => {
  it('비동기 접수(async_started + UUID task_id) → ACCEPTED', () => {
    const result = parseIngestResponse({
      networkError: false,
      httpStatus: 200,
      body: { status: 'async_started', task_id: '3f2a1b8c-5d6e-4f70-8a91-2b3c4d5e6f70', message: '...', task_type: 'rag_add' },
    });
    expect(result).toEqual({ outcome: 'ACCEPTED', taskId: '3f2a1b8c-5d6e-4f70-8a91-2b3c4d5e6f70' });
  });

  it('async_started인데 task_id가 UUID가 아니면 INVALID_TASK_ID(경로에 넣지 않음)', () => {
    const result = parseIngestResponse({ networkError: false, httpStatus: 200, body: { status: 'async_started', task_id: '../etc/passwd' } });
    expect(result).toEqual({ outcome: 'RESULT_CODE', resultCode: 'INVALID_TASK_ID', retryAfterMs: null });
  });

  it('동기 성공 { result: "...성공." } → SUCCEEDED', () => {
    const result = parseIngestResponse({ networkError: false, httpStatus: 200, body: { result: 'RAG Vector DB 추가 성공.' } });
    expect(result).toEqual({ outcome: 'SUCCEEDED' });
  });

  it('★ 200인데 실패 { result: "...실패." } → RAG_REPORTED_FAILURE(재시도 대상)', () => {
    const result = parseIngestResponse({ networkError: false, httpStatus: 200, body: { result: 'RAG Vector DB 추가 실패.' } });
    expect(result).toEqual({ outcome: 'RESULT_CODE', resultCode: 'RAG_REPORTED_FAILURE', retryAfterMs: null });
  });

  it('400(company/category/subcategory 누락) → HTTP_400(재시도 0)', () => {
    const result = parseIngestResponse({ networkError: false, httpStatus: 400, body: { status: 'error', message: '...' } });
    expect(result).toEqual({ outcome: 'RESULT_CODE', resultCode: 'HTTP_400', retryAfterMs: null });
  });

  it('429 → RATE_LIMITED(Retry-After 있으면 그 값을 함께 돌려준다 — 항목⑤)', () => {
    expect(parseIngestResponse({ networkError: false, httpStatus: 429, body: {} })).toEqual({ outcome: 'RESULT_CODE', resultCode: 'RATE_LIMITED', retryAfterMs: null });
    expect(parseIngestResponse({ networkError: false, httpStatus: 429, body: {}, retryAfterMs: 12_345 })).toEqual({
      outcome: 'RESULT_CODE',
      resultCode: 'RATE_LIMITED',
      retryAfterMs: 12_345,
    });
  });

  it('503 → OVERLOADED(Retry-After 전달)', () => {
    expect(parseIngestResponse({ networkError: false, httpStatus: 503, body: {}, retryAfterMs: 5000 })).toEqual({
      outcome: 'RESULT_CODE',
      resultCode: 'OVERLOADED',
      retryAfterMs: 5000,
    });
  });

  it('500 → UPSTREAM_ERROR', () => {
    expect(parseIngestResponse({ networkError: false, httpStatus: 500, body: {} })).toEqual({ outcome: 'RESULT_CODE', resultCode: 'UPSTREAM_ERROR', retryAfterMs: null });
  });

  it('네트워크 오류 → NETWORK_ERROR', () => {
    expect(parseIngestResponse({ networkError: true })).toEqual({ outcome: 'RESULT_CODE', resultCode: 'NETWORK_ERROR', retryAfterMs: null });
  });
});
