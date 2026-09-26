import { buildEnvelopeJson, envelopeBytes } from './envelope';

describe('No.41 봉투 v1 조립(§4.3·§8.2)', () => {
  const base = {
    deliveryId: '11111111-1111-4111-8111-111111111111',
    eventType: 'NODE_ACTION' as const,
    occurredAt: new Date('2026-01-01T00:00:00.000Z'),
    test: false,
    chatbot: { id: '22222222-2222-4222-8222-222222222222', name: '테스트봇' },
    channel: 'WEB' as const,
    sessionRef: '0123456789abcdef',
    source: { messageId: '33333333-3333-4333-8333-333333333333', nodeId: '44444444-4444-4444-8444-444444444444', outputIndex: 0 },
    action: { key: 'test.action' },
    fields: { a: '1' },
  };

  it('고정 키 순서로 직렬화되고 재호출해도 바이트가 같다(같은 입력)', () => {
    const json1 = buildEnvelopeJson(base);
    const json2 = buildEnvelopeJson(base);
    expect(json1).toBe(json2);
    expect(Object.keys(JSON.parse(json1))).toEqual(['specVersion', 'deliveryId', 'eventType', 'occurredAt', 'test', 'chatbot', 'channel', 'sessionRef', 'source', 'action', 'fields']);
  });

  it('occurredAt은 UTC ISO(Z)로 직렬화된다', () => {
    const json = buildEnvelopeJson(base);
    expect(JSON.parse(json).occurredAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('data가 없으면 키 자체가 없다', () => {
    const json = buildEnvelopeJson(base);
    expect('data' in JSON.parse(json)).toBe(false);
  });

  it('sessionId 키가 어디에도 없다(§4.3 — 스키마 자체가 모른다)', () => {
    const json = buildEnvelopeJson(base);
    expect(json.includes('sessionId')).toBe(false);
  });

  it('envelopeBytes — UTF-8 바이트 길이', () => {
    expect(envelopeBytes('a')).toBe(1);
    expect(envelopeBytes('가')).toBe(3);
  });
});
