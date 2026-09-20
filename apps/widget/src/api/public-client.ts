import type { ButtonAction, ConversationState, PublicChatbotConfig, PublicMessageResponse } from '@chat-bot/shared-types';

/**
 * 공개 API 2개만 호출하는 fetch 래퍼(FR-W-13). `credentials:'omit'`(NFR-S3) — 자격증명 기반
 * 요청을 쓰지 않는다. 오류를 4가지로 분류해 위젯이 문구를 구분할 수 있게 한다(FR-W-10).
 */
export type PublicApiErrorKind = 'NETWORK' | 'RATE_LIMITED' | 'DISABLED' | 'NOT_FOUND' | 'UNKNOWN';

export class PublicApiError extends Error {
  constructor(
    public kind: PublicApiErrorKind,
    message: string,
    public status?: number,
  ) {
    super(message);
    this.name = 'PublicApiError';
  }
}

function classifyStatus(status: number): PublicApiErrorKind {
  if (status === 429) return 'RATE_LIMITED';
  if (status === 403) return 'DISABLED';
  if (status === 404) return 'NOT_FOUND';
  return 'UNKNOWN';
}

export interface PublicMessagePayload {
  sessionId: string;
  message?: string;
  buttonAction?: ButtonAction;
  state?: ConversationState | unknown;
}

export function createPublicClient(apiBase: string, slug: string) {
  const base = `${apiBase.replace(/\/$/, '')}/public/chatbots/${encodeURIComponent(slug)}`;

  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${base}${path}`, {
        credentials: 'omit',
        headers: { 'Content-Type': 'application/json' },
        ...init,
      });
    } catch {
      throw new PublicApiError('NETWORK', '네트워크 오류');
    }
    if (!res.ok) {
      throw new PublicApiError(classifyStatus(res.status), `HTTP ${res.status}`, res.status);
    }
    return (await res.json()) as T;
  }

  return {
    getConfig: (): Promise<PublicChatbotConfig> => request<PublicChatbotConfig>('/config'),
    sendMessage: (payload: PublicMessagePayload): Promise<PublicMessageResponse> =>
      request<PublicMessageResponse>('/messages', { method: 'POST', body: JSON.stringify(payload) }),
  };
}

export type PublicClient = ReturnType<typeof createPublicClient>;
