import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseContentDispositionFilename, utteranceAnalysesApi } from './utteranceAnalyses';

const CHATBOT = '33333333-3333-4333-8333-333333333333';
const ANALYSIS = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function mockFetch(response: Partial<Response> & { jsonBody?: unknown; headers?: Headers }): ReturnType<typeof vi.fn> {
  const fn = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: new Headers(),
    json: async () => response.jsonBody ?? {},
    blob: async () => new Blob(['x']),
    ...response,
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => vi.unstubAllGlobals());

describe('utteranceAnalysesApi — 경로·쿼리·본문(13개 핸들러 계약, 화면 설계서 §8.1)', () => {
  it('목록: 상태는 콤마로, 값이 없거나 false는 보내지 않는다', async () => {
    const fn = mockFetch({ jsonBody: { items: [], total: 0, page: 1, pageSize: 20 } });
    await utteranceAnalysesApi.list(CHATBOT, { page: 2, pageSize: 20, status: ['QUEUED', 'RUNNING'] });

    expect(fn.mock.calls[0][0]).toBe(`/api/v1/chatbots/${CHATBOT}/utterance-analyses?page=2&pageSize=20&status=QUEUED%2CRUNNING`);
  });

  it('발화 목록: candidateOnly·unappliedOnly는 true일 때만 "true" 문자열로 보낸다', async () => {
    const fn = mockFetch({ jsonBody: { items: [], total: 0, page: 1, pageSize: 50 } });
    await utteranceAnalysesApi.listUtterances(CHATBOT, ANALYSIS, { clusterId: 'c1', candidateOnly: true, unappliedOnly: false, q: '환불', page: 1, pageSize: 50 });

    const url = new URL(fn.mock.calls[0][0] as string, 'http://x');
    expect(url.pathname).toBe(`/api/v1/chatbots/${CHATBOT}/utterance-analyses/${ANALYSIS}/utterances`);
    expect(url.searchParams.get('candidateOnly')).toBe('true');
    expect(url.searchParams.has('unappliedOnly')).toBe(false);
    expect(url.searchParams.get('q')).toBe('환불');
  });

  it('분석 요청: multipart로 file과 conditions(JSON 문자열)를 보낸다', async () => {
    const fn = mockFetch({ status: 202, jsonBody: { analysisId: ANALYSIS, status: 'QUEUED' } });
    const file = new File(['x'], 'a.xlsx');
    const conditions = {
      targetClusterCount: 10,
      minClusterSize: 5,
      keywordCount: 10,
      nounsOnly: true,
      probe: { enabled: true, target: 'SERVING' as const, scoreThreshold: null },
      nameSuggest: false,
    };
    await utteranceAnalysesApi.create(CHATBOT, file, conditions);

    const [url, init] = fn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/v1/chatbots/${CHATBOT}/utterance-analyses`);
    expect(init.method).toBe('POST');
    const form = init.body as FormData;
    expect((form.get('file') as File).name).toBe('a.xlsx');
    expect(JSON.parse(form.get('conditions') as string)).toEqual(conditions);
    // Content-Type을 직접 지정하지 않는다(브라우저가 boundary를 채운다).
    expect(init.headers).toBeUndefined();
  });

  it('파일 검사: 최소 발화 수는 쿼리로, 없으면 쿼리 없이', async () => {
    const fn = mockFetch({ jsonBody: {} });
    await utteranceAnalysesApi.preview(CHATBOT, new File(['x'], 'a.csv'), 7);
    await utteranceAnalysesApi.preview(CHATBOT, new File(['x'], 'a.csv'));

    expect(fn.mock.calls[0][0]).toBe(`/api/v1/chatbots/${CHATBOT}/utterance-analyses/preview?minClusterSize=7`);
    expect(fn.mock.calls[1][0]).toBe(`/api/v1/chatbots/${CHATBOT}/utterance-analyses/preview`);
  });

  it('묶음 이름: PATCH에 customName(null 포함)을 그대로 실어 보낸다', async () => {
    const fn = mockFetch({ jsonBody: {} });
    await utteranceAnalysesApi.renameCluster(CHATBOT, ANALYSIS, 'c1', { customName: null });

    const [url, init] = fn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/v1/chatbots/${CHATBOT}/utterance-analyses/${ANALYSIS}/clusters/c1`);
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body as string)).toEqual({ customName: null });
  });

  it('취소는 POST /cancel, 삭제는 DELETE(204 = 본문 없음)', async () => {
    const fn = mockFetch({ status: 204 });
    await utteranceAnalysesApi.cancel(CHATBOT, ANALYSIS);
    await utteranceAnalysesApi.remove(CHATBOT, ANALYSIS);

    expect(fn.mock.calls[0][0]).toBe(`/api/v1/chatbots/${CHATBOT}/utterance-analyses/${ANALYSIS}/cancel`);
    expect((fn.mock.calls[0][1] as RequestInit).method).toBe('POST');
    expect((fn.mock.calls[1][1] as RequestInit).method).toBe('DELETE');
  });

  it('예문 넣기 미리보기·확정은 각자의 경로로 같은 본문을 보낸다', async () => {
    const fn = mockFetch({ jsonBody: {} });
    const dto = { utteranceIds: ['u1'], target: { kind: 'NEW' as const, intentName: '환불' } };
    await utteranceAnalysesApi.previewApply(CHATBOT, ANALYSIS, dto);
    await utteranceAnalysesApi.apply(CHATBOT, ANALYSIS, dto);

    expect(fn.mock.calls[0][0]).toBe(`/api/v1/chatbots/${CHATBOT}/utterance-analyses/${ANALYSIS}/apply/preview`);
    expect(fn.mock.calls[1][0]).toBe(`/api/v1/chatbots/${CHATBOT}/utterance-analyses/${ANALYSIS}/apply`);
  });

  it('capability·상세 경로', async () => {
    const fn = mockFetch({ jsonBody: {} });
    await utteranceAnalysesApi.capability(CHATBOT);
    await utteranceAnalysesApi.get(CHATBOT, ANALYSIS);

    expect(fn.mock.calls[0][0]).toBe(`/api/v1/chatbots/${CHATBOT}/utterance-analyses/capability`);
    expect(fn.mock.calls[1][0]).toBe(`/api/v1/chatbots/${CHATBOT}/utterance-analyses/${ANALYSIS}`);
  });
});

describe('utteranceAnalysesApi — 파일 내려받기(양식·엑셀)', () => {
  it('Content-Disposition의 파일 이름을 그대로 쓴다(filename*=UTF-8 우선)', async () => {
    mockFetch({ headers: new Headers({ 'Content-Disposition': `attachment; filename="a.xlsx"; filename*=UTF-8''%EB%B0%9C%ED%99%94.xlsx` }) });
    const file = await utteranceAnalysesApi.exportXlsx(CHATBOT, ANALYSIS);

    expect(file.filename).toBe('발화.xlsx');
  });

  it('헤더가 없으면 기본 이름을 쓴다', async () => {
    mockFetch({});
    const file = await utteranceAnalysesApi.downloadTemplate(CHATBOT, 'csv');

    expect(file.filename).toBe('utterance-template.csv');
  });

  it('양식 요청은 format 쿼리를 붙인다', async () => {
    const fn = mockFetch({});
    await utteranceAnalysesApi.downloadTemplate(CHATBOT, 'xlsx');

    expect(fn.mock.calls[0][0]).toBe(`/api/v1/chatbots/${CHATBOT}/utterance-analyses/template?format=xlsx`);
  });

  it('오류 응답은 ApiError(code 포함)로 던진다 — 화면은 서버 문구가 아니라 코드로 분기한다', async () => {
    mockFetch({ ok: false, status: 409, statusText: 'Conflict', jsonBody: { statusCode: 409, code: 'INVALID_STATUS_TRANSITION', message: '내부 문구' } });

    await expect(utteranceAnalysesApi.exportXlsx(CHATBOT, ANALYSIS)).rejects.toMatchObject({ status: 409, code: 'INVALID_STATUS_TRANSITION' });
  });

  it('parseContentDispositionFilename: 형식이 없으면 폴백', () => {
    expect(parseContentDispositionFilename(null, 'x.xlsx')).toBe('x.xlsx');
    expect(parseContentDispositionFilename('attachment; filename="b.csv"', 'x')).toBe('b.csv');
  });
});
