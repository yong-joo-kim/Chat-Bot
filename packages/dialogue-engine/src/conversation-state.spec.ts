import type { ConversationState } from '@chat-bot/shared-types';
import { sanitizeConversationState } from './conversation-state';
import { makeBundle, makeContext } from './test-fixtures';

const NOW = new Date('2026-01-01T00:00:00Z');

function baseSession(overrides: Partial<ConversationState['contextSession']> = {}) {
  return {
    contextVariableId: '',
    currentSlotIndex: 0,
    filledValues: {},
    retryCount: 0,
    startedAt: NOW,
    lastInteractedAt: NOW,
    status: 'IN_PROGRESS' as const,
    ...overrides,
  };
}

describe('sanitizeConversationState — §7.4', () => {
  it('스키마 검증 실패 시 봉투 전체를 폐기한다(INVALID_SCHEMA)', () => {
    const bundle = makeBundle();
    const result = sanitizeConversationState({ not: 'valid' }, bundle, NOW);
    expect(result.discarded).toEqual(['INVALID_SCHEMA']);
    expect(result.contextSession).toBeNull();
  });

  it('null/undefined(최초 턴, 보관된 상태 없음)는 폐기 사유 없이 빈 상태로 처리된다', () => {
    const bundle = makeBundle();
    expect(sanitizeConversationState(null, bundle, NOW).discarded).toEqual([]);
    expect(sanitizeConversationState(undefined, bundle, NOW).discarded).toEqual([]);
  });

  it('빈 객체({})처럼 형태가 있지만 스키마에 맞지 않으면 INVALID_SCHEMA로 폐기한다', () => {
    const bundle = makeBundle();
    const result = sanitizeConversationState({}, bundle, NOW);
    expect(result.discarded).toEqual(['INVALID_SCHEMA']);
  });

  it('알 수 없는 contextVariableId는 UNKNOWN_CONTEXT로 폐기된다(교차 챗봇 방어)', () => {
    const bundle = makeBundle();
    const state: ConversationState = {
      version: 1,
      contextSession: baseSession({ contextVariableId: '99999999-9999-4999-8999-999999999999' }),
    };
    const result = sanitizeConversationState(state, bundle, NOW);
    expect(result.discarded).toEqual(['UNKNOWN_CONTEXT']);
    expect(result.contextSession).toBeNull();
  });

  it('24시간 초과한 세션은 SESSION_EXPIRED로 폐기된다', () => {
    const context = makeContext();
    const bundle = makeBundle({ contexts: [context] });
    const startedAt = new Date(NOW.getTime() - 25 * 60 * 60 * 1000);
    const state: ConversationState = {
      version: 1,
      contextSession: baseSession({ contextVariableId: context.id, startedAt, lastInteractedAt: startedAt }),
    };
    const result = sanitizeConversationState(state, bundle, NOW);
    expect(result.discarded).toEqual(['SESSION_EXPIRED']);
  });

  it('미래 시각의 startedAt(허용오차 5분 초과)은 SESSION_EXPIRED로 폐기된다', () => {
    const context = makeContext();
    const bundle = makeBundle({ contexts: [context] });
    const startedAt = new Date(NOW.getTime() + 10 * 60 * 1000);
    const state: ConversationState = {
      version: 1,
      contextSession: baseSession({ contextVariableId: context.id, startedAt }),
    };
    const result = sanitizeConversationState(state, bundle, NOW);
    expect(result.discarded).toEqual(['SESSION_EXPIRED']);
  });

  it('lastInteractedAt이 미래이면 폐기가 아니라 now로 보정된다', () => {
    const context = makeContext();
    const bundle = makeBundle({ contexts: [context] });
    const future = new Date(NOW.getTime() + 60 * 1000);
    const state: ConversationState = {
      version: 1,
      contextSession: baseSession({ contextVariableId: context.id, lastInteractedAt: future }),
    };
    const result = sanitizeConversationState(state, bundle, NOW);
    expect(result.discarded).toEqual([]);
    expect(result.contextSession?.lastInteractedAt).toEqual(NOW);
  });

  it('filledValues 키가 20개를 초과하면 OVERSIZED로 폐기된다', () => {
    const context = makeContext();
    const bundle = makeBundle({ contexts: [context] });
    const filledValues: Record<string, string> = {};
    for (let i = 0; i < 21; i += 1) filledValues[`k${i}`] = 'v';
    const state: ConversationState = {
      version: 1,
      contextSession: baseSession({ contextVariableId: context.id, filledValues }),
    };
    const result = sanitizeConversationState(state, bundle, NOW);
    expect(result.discarded).toEqual(['OVERSIZED']);
  });

  it('알 수 없는 homonymId의 pendingClarify는 UNKNOWN_HOMONYM으로 폐기된다', () => {
    const bundle = makeBundle();
    const state: ConversationState = {
      version: 1,
      contextSession: null,
      pendingClarify: { homonymId: '99999999-9999-4999-8999-999999999999', word: '배', askedAt: NOW },
    };
    const result = sanitizeConversationState(state, bundle, NOW);
    expect(result.discarded).toEqual(['UNKNOWN_HOMONYM']);
    expect(result.pendingClarify).toBeNull();
  });

  it('10분 초과한 pendingClarify는 CLARIFY_EXPIRED로 폐기된다', () => {
    const homonymId = '88888888-8888-4888-8888-888888888888';
    const bundle = makeBundle({
      homonyms: [
        {
          id: homonymId,
          chatbotId: 'bot-1',
          word: '배',
          meanings: [
            { label: '과일', contextHints: [] },
            { label: '선박', contextHints: [] },
          ],
          policy: 'ASK',
          createdAt: NOW,
          updatedAt: NOW,
        },
      ],
    });
    const askedAt = new Date(NOW.getTime() - 11 * 60 * 1000);
    const state: ConversationState = { version: 1, contextSession: null, pendingClarify: { homonymId, word: '배', askedAt } };
    const result = sanitizeConversationState(state, bundle, NOW);
    expect(result.discarded).toEqual(['CLARIFY_EXPIRED']);
  });

  it('유효한 상태는 그대로 통과한다(discarded=[])', () => {
    const context = makeContext();
    const bundle = makeBundle({ contexts: [context] });
    const state: ConversationState = { version: 1, contextSession: baseSession({ contextVariableId: context.id }) };
    const result = sanitizeConversationState(state, bundle, NOW);
    expect(result.discarded).toEqual([]);
    expect(result.contextSession?.contextVariableId).toBe(context.id);
  });
});
