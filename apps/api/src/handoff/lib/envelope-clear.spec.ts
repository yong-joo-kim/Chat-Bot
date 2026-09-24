import { CONVERSATION_STATE_VERSION } from '@chat-bot/shared-types';
import type { ConversationState } from '@chat-bot/shared-types';
import { clearEnvelopeForHandoff } from './envelope-clear';

const CONNECTED_AT = new Date('2026-01-01T00:10:00Z');

describe('clearEnvelopeForHandoff — J-16·§5.4', () => {
  it('검증 실패한 값은 그대로 돌려준다(엔진 sanitize에 위임)', () => {
    const raw = { garbage: true };
    expect(clearEnvelopeForHandoff(raw, CONNECTED_AT)).toBe(raw);
  });

  it('연결 이전에 시작된 contextSession은 null로 비운다', () => {
    const state: ConversationState = {
      version: CONVERSATION_STATE_VERSION,
      contextSession: {
        contextVariableId: '11111111-1111-4111-8111-111111111111',
        currentSlotIndex: 0,
        filledValues: {},
        retryCount: 0,
        startedAt: new Date('2026-01-01T00:00:00Z'),
        lastInteractedAt: new Date('2026-01-01T00:00:00Z'),
        status: 'IN_PROGRESS',
      },
    };
    const result = clearEnvelopeForHandoff(state, CONNECTED_AT) as ConversationState;
    expect(result.contextSession).toBeNull();
  });

  it('연결 이후에 시작된 contextSession은 유지한다', () => {
    const state: ConversationState = {
      version: CONVERSATION_STATE_VERSION,
      contextSession: {
        contextVariableId: '11111111-1111-4111-8111-111111111111',
        currentSlotIndex: 0,
        filledValues: {},
        retryCount: 0,
        startedAt: new Date('2026-01-01T00:20:00Z'),
        lastInteractedAt: new Date('2026-01-01T00:20:00Z'),
        status: 'IN_PROGRESS',
      },
    };
    const result = clearEnvelopeForHandoff(state, CONNECTED_AT) as ConversationState;
    expect(result.contextSession).not.toBeNull();
  });

  it('연결 이전 pendingClarify는 키를 삭제한다', () => {
    const state: ConversationState = {
      version: CONVERSATION_STATE_VERSION,
      contextSession: null,
      pendingClarify: { homonymId: '22222222-2222-4222-8222-222222222222', word: '배', askedAt: new Date('2026-01-01T00:00:00Z') },
    };
    const result = clearEnvelopeForHandoff(state, CONNECTED_AT) as ConversationState;
    expect(result.pendingClarify).toBeUndefined();
  });

  it('멱등 — 이미 비어 있으면 다시 호출해도 동일하다', () => {
    const state: ConversationState = { version: CONVERSATION_STATE_VERSION, contextSession: null };
    const once = clearEnvelopeForHandoff(state, CONNECTED_AT);
    const twice = clearEnvelopeForHandoff(once, CONNECTED_AT);
    expect(twice).toEqual(once);
  });

  it('completedSurveyIds·version은 그대로 유지한다(새 값 0)', () => {
    const state: ConversationState = { version: CONVERSATION_STATE_VERSION, contextSession: null, completedSurveyIds: ['33333333-3333-4333-8333-333333333333'] };
    const result = clearEnvelopeForHandoff(state, CONNECTED_AT) as ConversationState;
    expect(result.completedSurveyIds).toEqual(['33333333-3333-4333-8333-333333333333']);
    expect(result.version).toBe(CONVERSATION_STATE_VERSION);
  });
});
