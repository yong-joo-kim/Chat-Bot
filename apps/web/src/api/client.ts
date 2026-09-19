import { ApiErrorSchema, type ApiErrorCode, type ApiErrorDetail } from '@chat-bot/shared-types';

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '/api';

/**
 * `ui-spec.md` §6.1 확장 요구사항: 서버 오류 응답 본문(`ApiErrorSchema`)을 파싱해
 * `code`/`details`를 실어 나른다. 파싱에 실패하면 상태코드 기반 기본 문구로 폴백한다.
 */
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: ApiErrorCode,
    public details?: ApiErrorDetail[],
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (res.status === 401) {
    // EX-X-1 / No.12 Phase 대비 훅 자리 — 현재는 재로그인 유도 없이 no-op.
    // 편집 중이던 내용은 각 화면의 로컬 상태(dirty)에 그대로 남아 있다.
  }

  if (!res.ok) {
    let code: ApiErrorCode | undefined;
    let details: ApiErrorDetail[] | undefined;
    let message = `요청 실패: ${res.status} ${res.statusText}`;
    try {
      const body: unknown = await res.json();
      const parsed = ApiErrorSchema.safeParse(body);
      if (parsed.success) {
        code = parsed.data.code;
        details = parsed.data.details;
        message = parsed.data.message;
      }
    } catch {
      // 본문이 JSON이 아니거나 비어 있으면 기본 문구를 사용한다.
    }
    throw new ApiError(res.status, message, code, details);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  return handleResponse<T>(res);
}

export const apiClient = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) => request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
  /**
   * `multipart/form-data` 전용 진입점(대량 업로드, ui-spec §0.3). `Content-Type`을 직접 지정하지
   * 않아야 브라우저가 `FormData`의 boundary를 자동으로 채워 넣는다 — `post`를 재사용하지 않는 이유.
   */
  postForm: <T>(path: string, formData: FormData) =>
    fetch(`${API_BASE_URL}${path}`, { method: 'POST', body: formData }).then((res) => handleResponse<T>(res)),
};
