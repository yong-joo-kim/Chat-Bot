import { describe, expect, it } from 'vitest';
import { getOrCreateSessionId, loadConversationState, saveConversationState } from './session';

const SLUG = 'sample-support-bot';

describe('widget core/session — DOM 무의존(FR-W-16, EX-W-7 메모리 폴백)', () => {
  it('sessionId를 최초 1회 생성하고 이후 동일 slug 호출에는 같은 값을 반환한다', () => {
    const first = getOrCreateSessionId(SLUG);
    const second = getOrCreateSessionId(SLUG);
    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it('slug가 다르면 sessionId도 다르다(챗봇별 독립 세션)', () => {
    const a = getOrCreateSessionId('bot-a');
    const b = getOrCreateSessionId('bot-b');
    expect(a).not.toBe(b);
  });

  it('state가 없으면 undefined를 반환한다', () => {
    expect(loadConversationState('never-saved-slug')).toBeUndefined();
  });

  it('저장한 state를 그대로 읽어올 수 있다(부분 병합 없이 통째 교체, §9.4)', () => {
    const state = {
      version: 1 as const,
      contextSession: {
        contextVariableId: '11111111-1111-1111-1111-111111111111',
        currentSlotIndex: 1,
        filledValues: { menu: '아메리카노' },
        retryCount: 0,
        startedAt: new Date('2026-01-01T00:00:00Z'),
        lastInteractedAt: new Date('2026-01-01T00:00:00Z'),
        status: 'IN_PROGRESS' as const,
      },
    };
    saveConversationState('state-slug', state);
    const loaded = loadConversationState('state-slug');
    expect(loaded?.contextSession?.filledValues).toEqual({ menu: '아메리카노' });
  });

  it('undefined로 저장하면 다음 조회는 undefined다(대화 초기화)', () => {
    saveConversationState('reset-slug', undefined);
    expect(loadConversationState('reset-slug')).toBeUndefined();
  });
});
