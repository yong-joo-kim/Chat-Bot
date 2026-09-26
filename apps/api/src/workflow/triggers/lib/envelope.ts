import type { WorkflowEventData, WorkflowEventType } from '@chat-bot/shared-types';

export interface EnvelopeInput {
  deliveryId: string;
  eventType: WorkflowEventType;
  occurredAt: Date;
  test: boolean;
  chatbot: { id: string; name: string } | null;
  channel: 'WEB' | null;
  sessionRef: string | null;
  source: {
    messageId?: string;
    nodeId?: string;
    outputIndex?: number;
    handoffId?: string;
    surveyResponseId?: string;
    feedbackId?: string;
    subscriptionId?: string;
  };
  action?: { key: string };
  fields?: Record<string, string>;
  data?: WorkflowEventData;
}

/**
 * [신규 No.41] 봉투 v1 조립(§4.3 · §8.2) — **고정 키 순서** 객체를 만들고 `JSON.stringify` 1회.
 * 이 문자열이 저장·서명·송신 바이트다(재직렬화 금지). 순수 함수.
 */
export function buildEnvelopeJson(input: EnvelopeInput): string {
  const envelope = {
    specVersion: '1' as const,
    deliveryId: input.deliveryId,
    eventType: input.eventType,
    occurredAt: input.occurredAt.toISOString(),
    test: input.test,
    chatbot: input.chatbot,
    channel: input.channel,
    sessionRef: input.sessionRef,
    source: input.source,
    ...(input.action ? { action: input.action } : {}),
    ...(input.fields ? { fields: input.fields } : {}),
    ...(input.data ? { data: input.data } : {}),
  };
  return JSON.stringify(envelope);
}

export function envelopeBytes(json: string): number {
  return Buffer.byteLength(json, 'utf8');
}
