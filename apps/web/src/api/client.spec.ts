import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiClient, ApiError, registerSessionExpiredHandler } from './client';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/**
 * `apiClient`의 401 세션만료 훅 자동시험 — 1차 코드리뷰 지적("`postForm`은 별도 fetch라
 * 401 훅이 누락되기 쉽다")과 AC-U-9("대량 업로드 multipart 요청도 postForm 경로에서 인증 훅이
 * 정상 동작한다")를 커버한다. `request()`(JSON 경로)와 `postForm()`(multipart 경로) 양쪽이
 * 재로그인 성공 시 **원 요청을 정확히 1회 재시도**하는지, 재로그인 실패(취소) 시에는 원래의
 * 401 `ApiError`를 그대로 던지는지 검증한다.
 */
describe('apiClient — 401 세션만료 훅(L3)', () => {
  afterEach(() => {
    registerSessionExpiredHandler(null);
    vi.unstubAllGlobals();
  });

  it('GET 요청이 401을 받으면 재로그인 훅을 거쳐 원 요청을 1회 재시도해 성공한다', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(401, { statusCode: 401, code: 'SESSION_EXPIRED', message: '만료' }))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    registerSessionExpiredHandler(() => Promise.resolve(true));

    const result = await apiClient.get<{ ok: boolean }>('/chatbots');
    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('재로그인을 취소하면 원래의 401 ApiError를 그대로 던진다(재시도하지 않음)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(401, { statusCode: 401, code: 'SESSION_EXPIRED', message: '만료' }));
    vi.stubGlobal('fetch', fetchMock);
    registerSessionExpiredHandler(() => Promise.resolve(false));

    await expect(apiClient.get('/chatbots')).rejects.toMatchObject({ status: 401, code: 'SESSION_EXPIRED' } satisfies Partial<ApiError>);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('postForm(대량 업로드)이 401을 받아도 동일하게 재로그인 후 1회 재시도한다(Low #2 — postForm 누락 점검)', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(401, { statusCode: 401, code: 'SESSION_EXPIRED', message: '만료' }))
      .mockResolvedValueOnce(jsonResponse(200, { imported: 10 }));
    vi.stubGlobal('fetch', fetchMock);
    registerSessionExpiredHandler(() => Promise.resolve(true));

    const formData = new FormData();
    formData.append('file', new Blob(['a,b'], { type: 'text/csv' }), 'intents.csv');
    const result = await apiClient.postForm<{ imported: number }>('/intents/import/commit', formData);

    expect(result).toEqual({ imported: 10 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // 두 호출 모두 credentials:'include'가 실려 있어야 세션 쿠키가 전달된다(FR-U-9).
    for (const call of fetchMock.mock.calls) {
      expect((call[1] as RequestInit).credentials).toBe('include');
    }
    // multipart는 Content-Type을 직접 지정하지 않는다(브라우저가 boundary를 채운다).
    expect((fetchMock.mock.calls[0][1] as RequestInit).method).toBe('POST');
    expect((fetchMock.mock.calls[0][1] as RequestInit).body).toBe(formData);
  });

  it('postForm에서도 재로그인 취소 시 원래 401을 그대로 던진다', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(401, { statusCode: 401, code: 'SESSION_EXPIRED', message: '만료' }));
    vi.stubGlobal('fetch', fetchMock);
    registerSessionExpiredHandler(() => Promise.resolve(false));

    const formData = new FormData();
    await expect(apiClient.postForm('/intents/import/commit', formData)).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('/auth/* 경로는 401 훅 대상이 아니다(로그인 폼이 직접 처리한다)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(401, { statusCode: 401, code: 'INVALID_CREDENTIALS', message: '실패' }));
    vi.stubGlobal('fetch', fetchMock);
    const handler = vi.fn(() => Promise.resolve(true));
    registerSessionExpiredHandler(handler);

    await expect(apiClient.post('/auth/login', { email: 'a@b.com', password: 'x' })).rejects.toMatchObject({ status: 401 });
    expect(handler).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('동시에 여러 요청이 401을 받아도 재로그인 모달은 한 번만 뜬다(진행 중인 프라미스 공유)', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(401, { statusCode: 401, code: 'SESSION_EXPIRED', message: '만료' }))
      .mockResolvedValueOnce(jsonResponse(401, { statusCode: 401, code: 'SESSION_EXPIRED', message: '만료' }))
      .mockResolvedValueOnce(jsonResponse(200, { a: 1 }))
      .mockResolvedValueOnce(jsonResponse(200, { b: 2 }));
    vi.stubGlobal('fetch', fetchMock);
    const handler = vi.fn(() => Promise.resolve(true));
    registerSessionExpiredHandler(handler);

    const [a, b] = await Promise.all([apiClient.get('/chatbots'), apiClient.get('/users')]);
    expect(a).toEqual({ a: 1 });
    expect(b).toEqual({ b: 2 });
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
