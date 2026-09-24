import type { ButtonAction, ConversationState, HandoffPollResponse, PendingAnswerPollResponse, PublicChatbotConfig, PublicMessageResponse } from '@chat-bot/shared-types';
import { HANDOFF_SESSION_HEADER, HANDOFF_TOKEN_HEADER, WIDGET_FEATURE_HANDOFF_V1 } from '../constants/handoff';

/**
 * 공개 API 3개(No.24로 상담 폴링 1개 추가)를 호출하는 fetch 래퍼(FR-W-13). `credentials:'omit'`
 * (NFR-S3) — 자격증명 기반 요청을 쓰지 않는다. 오류를 4가지로 분류해 위젯이 문구를 구분할 수 있게
 * 한다(FR-W-10).
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
    // ⚠ `{ ...init }`로 펼치면 `init.headers`가 기본 헤더(Content-Type)를 통째로 덮어쓴다 —
    // 상담 토큰 헤더(`x-cb-handoff-token`)를 추가할 때 Content-Type이 사라지지 않도록 headers만 따로
    // 병합한다(No.24, 이 함수 자체의 기존 결함이기도 하다).
    const { headers: initHeaders, ...restInit } = init ?? {};
    try {
      res = await fetch(`${base}${path}`, {
        credentials: 'omit',
        ...restInit,
        headers: { 'Content-Type': 'application/json', ...(initHeaders as Record<string, string> | undefined) },
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
    /**
     * [No.24] 신버전 위젯 기능 선언(`features: ['handoff-v1']`)을 항상 싣는다(ADR-0036 §5.6 —
     * 이게 없으면 서버가 구버전으로 취급해 편승 격하한다). 상담 토큰이 있으면 헤더로 함께 보낸다.
     */
    sendMessage: (payload: PublicMessagePayload, opts?: { handoffToken?: string }): Promise<PublicMessageResponse> =>
      request<PublicMessageResponse>('/messages', {
        method: 'POST',
        body: JSON.stringify({ ...payload, features: [WIDGET_FEATURE_HANDOFF_V1] }),
        headers: opts?.handoffToken ? { [HANDOFF_TOKEN_HEADER]: opts.handoffToken } : undefined,
      }),
    /** 보류 답변 폴링(ADR-0023) — `messageId` 불일치/TTL 만료는 404(`NOT_FOUND`)로 온다. */
    pollMessage: (messageId: string): Promise<PendingAnswerPollResponse> =>
      request<PendingAnswerPollResponse>(`/messages/${encodeURIComponent(messageId)}`),
    /**
     * [No.24] 상담 전용 짧은 폴링(ADR-0036 §7) — 세션·토큰은 헤더로만 보낸다(URL·본문 금지).
     * 토큰 무효·교차·유예 경과는 404(`NOT_FOUND`)로 온다.
     */
    pollHandoff: (opts: { sessionId: string; token?: string; after: number; restore?: boolean }): Promise<HandoffPollResponse> => {
      const qs = new URLSearchParams({ after: String(opts.after) });
      if (opts.restore) qs.set('restore', 'true');
      const headers: Record<string, string> = { [HANDOFF_SESSION_HEADER]: opts.sessionId };
      if (opts.token) headers[HANDOFF_TOKEN_HEADER] = opts.token;
      return request<HandoffPollResponse>(`/handoff?${qs.toString()}`, { headers });
    },
  };
}

export type PublicClient = ReturnType<typeof createPublicClient>;
