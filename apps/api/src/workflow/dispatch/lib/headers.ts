import type { ApiConnectionAuthType, WorkflowEventType } from '@chat-bot/shared-types';
import { computeSignature } from './signature';

export interface BuildHeadersInput {
  eventType: WorkflowEventType;
  deliveryId: string;
  attempt: number;
  signingSecret: string | null;
  now: Date;
  rawBody: string;
  authType: ApiConnectionAuthType;
  authHeaderName: string | null;
  authSecret: string | null;
}

/** [신규 No.41] 발송 헤더 조립(§8.1) — 순수. 비밀 값 자체는 반환하되 로그에는 넣지 않는다(호출부 책임). */
export function buildDispatchHeaders(input: BuildHeadersInput): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json; charset=utf-8',
    'User-Agent': 'ChatBot-Workflow/1',
    'X-Chatbot-Event': input.eventType,
    'X-Chatbot-Delivery': input.deliveryId,
    'Idempotency-Key': input.deliveryId,
    'X-Chatbot-Attempt': String(input.attempt),
    Connection: 'close',
  };
  if (input.signingSecret) {
    const unixSeconds = Math.round(input.now.getTime() / 1000);
    headers['X-Chatbot-Signature'] = computeSignature(input.signingSecret, unixSeconds, input.rawBody);
  }
  if (input.authType === 'API_KEY_HEADER' && input.authHeaderName && input.authSecret) {
    headers[input.authHeaderName] = input.authSecret;
  } else if (input.authType === 'BEARER' && input.authSecret) {
    headers.Authorization = `Bearer ${input.authSecret}`;
  } else if (input.authType === 'BASIC' && input.authSecret) {
    headers.Authorization = `Basic ${Buffer.from(input.authSecret, 'utf8').toString('base64')}`;
  }
  return headers;
}
