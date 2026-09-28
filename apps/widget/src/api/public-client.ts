import type {
  ButtonAction,
  ConversationState,
  HandoffPollResponse,
  PendingAnswerPollResponse,
  ProactiveEventKind,
  PublicChatbotConfig,
  PublicChatbotConfigWithProactive,
  PublicFeedbackResponse,
  PublicMessageResponse,
  PublicProactivePayload,
  PublicProactiveRule,
} from '@chat-bot/shared-types';
import { HANDOFF_SESSION_HEADER, HANDOFF_TOKEN_HEADER, WIDGET_FEATURE_HANDOFF_V1 } from '../constants/handoff';
import { WIDGET_FEATURE_FEEDBACK_V1 } from '../constants/feedback';
import { WIDGET_FEATURE_RICH_V1 } from '../constants/rich';
import { IDENTITY_TOKEN_HEADER } from '../constants/identity';
import type { FeedbackRating } from '../core/feedback';

/**
 * [신규 No.35] 위젯은 zod로 응답을 재검증하지 않는다(`response.json()` 결과를 그대로 캐스팅 — 기존
 * `getConfig`/`sendMessage`와 동일한 관례). `PublicProactiveRuleSchema`의 `showUntil`은 서버·콘솔
 * 쪽에서는 `z.coerce.date()`(Date)로 추론되지만, 위젯이 실제로 손에 쥐는 값은 **JSON 문자열**이다 —
 * 이 파일만 "실제로 온 대로"의 타입으로 다시 선언한다(런타임 변화 없음, 타입 전용 수정).
 */
export type WireProactiveRule = Omit<PublicProactiveRule, 'showUntil'> & { showUntil?: string };
export type WireProactivePayload = Omit<PublicProactivePayload, 'rules'> & { rules: WireProactiveRule[] };
export type WireChatbotConfigWithProactive = Omit<PublicChatbotConfigWithProactive, 'proactive'> & { proactive?: WireProactivePayload };

/**
 * 공개 API(No.24 상담 폴링·No.44 답변 평가 포함)를 호출하는 fetch 래퍼(FR-W-13). `credentials:'omit'`
 * (NFR-S3) — 자격증명 기반 요청을 쓰지 않는다. 오류를 분류해 위젯이 문구를 구분할 수 있게 한다
 * (FR-W-10). `CLOSED`(409)는 No.44 평가 변경 한도·기한 초과 전용이다 — 다른 엔드포인트는 409를
 * 반환하지 않는다.
 */
export type PublicApiErrorKind = 'NETWORK' | 'RATE_LIMITED' | 'DISABLED' | 'NOT_FOUND' | 'CLOSED' | 'UNKNOWN';

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
  if (status === 409) return 'CLOSED';
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
     * [No.24·No.44·No.42·No.46] 신버전 위젯 기능 선언(`features: ['handoff-v1', 'feedback-v1',
     * 'rich-v1']`)을 항상 싣는다(ADR-0036 §5.6 — 이게 없으면 서버가 구버전으로 취급해 편승
     * 격하한다). `rich-v1`이 없으면 서버가 캐러셀을 `CARD` 여러 개로, 바로연결을 일반 `BUTTON`으로
     * 강등해 보낸다(ADR-0043 §6). 상담 토큰이 있으면 헤더로 함께 보낸다. [신규 No.42] 식별 토큰이
     * 있을 때만 `x-cb-identity` 헤더를 추가한다(없으면 요청 바이트 불변, `omnichannel-inbox-설계.md` §6.8).
     */
    sendMessage: (payload: PublicMessagePayload, opts?: { handoffToken?: string; identityToken?: string }): Promise<PublicMessageResponse> =>
      request<PublicMessageResponse>('/messages', {
        method: 'POST',
        body: JSON.stringify({ ...payload, features: [WIDGET_FEATURE_HANDOFF_V1, WIDGET_FEATURE_FEEDBACK_V1, WIDGET_FEATURE_RICH_V1] }),
        headers: {
          ...(opts?.handoffToken ? { [HANDOFF_TOKEN_HEADER]: opts.handoffToken } : undefined),
          ...(opts?.identityToken ? { [IDENTITY_TOKEN_HEADER]: opts.identityToken } : undefined),
        },
      }),
    /** 보류 답변 폴링(ADR-0023) — `messageId` 불일치/TTL 만료는 404(`NOT_FOUND`)로 온다. */
    pollMessage: (messageId: string): Promise<PendingAnswerPollResponse> =>
      request<PendingAnswerPollResponse>(`/messages/${encodeURIComponent(messageId)}`),
    /**
     * [신규 No.44] 답변 평가 — `PUT`(멱등 설정). 토큰 없음, `messageId`+`sessionId`+슬러그 결합
     * 검증만으로 판정한다(`feedback-loop-설계.md` §7). 404(`FEEDBACK_TARGET_NOT_FOUND`)·
     * 409(`FEEDBACK_CLOSED`)·429는 `PublicApiError.kind`로 구분해 던진다.
     */
    submitFeedback: (messageId: string, payload: { sessionId: string; rating: FeedbackRating }): Promise<PublicFeedbackResponse> =>
      request<PublicFeedbackResponse>(`/messages/${encodeURIComponent(messageId)}/feedback`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      }),
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
    /**
     * [신규 No.35] 선제 안내 규칙 조회 — 기존 `getConfig`의 **선택 확장**(새 경로 0, FR-0-243).
     * `referrerPolicy:'no-referrer'`(같은 출처 배포에서 페이지 전체 주소가 리퍼러로 새는 것을 막는다,
     * ADR-0045 §0 ⑥) — 실패는 호출부가 조용히 무시한다(EX-PA-1).
     */
    getConfigForProactive: (): Promise<WireChatbotConfigWithProactive> =>
      request<WireChatbotConfigWithProactive>('/config?proactive=1', { referrerPolicy: 'no-referrer' }),
    /**
     * [신규 No.35] 표시·클릭·닫기·끄기 수집(§6.7) — 보내고 잊는다(결과·오류 무시, FR-PA5-7).
     * 본문 키는 정확히 3개(`sessionId, ruleId, kind` — PA-12)뿐이다.
     */
    sendProactiveEvent(payload: { sessionId: string; ruleId: string; kind: ProactiveEventKind }): void {
      void fetch(`${base}/proactive-events`, {
        method: 'POST',
        credentials: 'omit',
        keepalive: true,
        referrerPolicy: 'no-referrer',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: payload.sessionId, ruleId: payload.ruleId, kind: payload.kind }),
      }).catch(() => undefined);
    },
  };
}

export type PublicClient = ReturnType<typeof createPublicClient>;
