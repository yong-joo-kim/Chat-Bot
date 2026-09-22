import { ApiErrorSchema, type ApiErrorCode, type ApiErrorDetail } from '@chat-bot/shared-types';

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '/api/v1';

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

/**
 * `security-audit-ui-spec.md` §3.4(L3) 계약: 인증된 화면에서 `401`을 받으면 이 훅이
 * 세션 만료 재로그인 모달을 띄운다. `true`(재로그인 성공)를 반환하면 호출부(request())가
 * 원 요청을 자동으로 1회 재시도하고, `false`(취소)면 원래의 401 `ApiError`를 그대로 던진다.
 * 화면 컴포넌트는 이 로직을 알 필요가 없다 — `AuthProvider`가 부팅 시 1회 등록한다.
 */
type SessionExpiredHandler = () => Promise<boolean>;
let sessionExpiredHandler: SessionExpiredHandler | null = null;
let pendingSessionExpiredPromise: Promise<boolean> | null = null;

export function registerSessionExpiredHandler(handler: SessionExpiredHandler | null): void {
  sessionExpiredHandler = handler;
}

/** 동시에 여러 요청이 401을 받아도 모달은 하나만 뜬다(§3.4) — 진행 중인 프라미스를 공유한다. */
function triggerSessionExpired(): Promise<boolean> {
  if (!sessionExpiredHandler) return Promise.resolve(false);
  if (!pendingSessionExpiredPromise) {
    const handler = sessionExpiredHandler;
    pendingSessionExpiredPromise = handler().finally(() => {
      pendingSessionExpiredPromise = null;
    });
  }
  return pendingSessionExpiredPromise;
}

async function handleResponse<T>(res: Response): Promise<T> {
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

/** `/auth/*` 경로는 L3 훅의 대상이 아니다(로그인/비밀번호변경 폼이 자신의 401을 직접 처리한다). */
function isAuthPath(path: string): boolean {
  return path.startsWith('/auth/');
}

async function request<T>(path: string, init?: RequestInit, isRetry = false): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    ...init,
  });
  if (res.status === 401 && !isRetry && !isAuthPath(path)) {
    const recovered = await triggerSessionExpired();
    if (recovered) {
      return request<T>(path, init, true);
    }
  }
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
  async postForm<T>(path: string, formData: FormData, isRetry = false): Promise<T> {
    const res = await fetch(`${API_BASE_URL}${path}`, { method: 'POST', body: formData, credentials: 'include' });
    if (res.status === 401 && !isRetry && !isAuthPath(path)) {
      const recovered = await triggerSessionExpired();
      if (recovered) {
        return apiClient.postForm<T>(path, formData, true);
      }
    }
    return handleResponse<T>(res);
  },
};
