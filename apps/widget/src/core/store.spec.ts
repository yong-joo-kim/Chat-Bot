import { describe, expect, it } from 'vitest';
import { createInitialState, reducer } from './store';
import type { PublicChatbotConfig } from '@chat-bot/shared-types';

const baseConfig: PublicChatbotConfig = {
  slug: 'sample-support-bot',
  name: '고객지원봇',
  skin: { primaryColor: '#4F46E5', headerTitle: '챗봇 상담' },
  greetingMessage: '무엇을 도와드릴까요?',
  quickReplies: ['배송 조회', '환불 절차'],
  launcherPosition: 'RIGHT',
  showLauncher: true,
};

describe('widget core/store — DOM 무의존 reducer(FR-W-16)', () => {
  it('CLOSED에서 OPEN_REQUESTED는 OPENING으로 전이한다(§5.2)', () => {
    const state = reducer(createInitialState(), { type: 'OPEN_REQUESTED' });
    expect(state.status).toBe('OPENING');
  });

  it('CONFIG_LOADED는 OPEN으로 전이하고 인사말+퀵리플라이를 1회만 삽입한다(FR-W-15)', () => {
    let state = reducer(createInitialState(), { type: 'OPEN_REQUESTED' });
    state = reducer(state, { type: 'CONFIG_LOADED', config: baseConfig });
    expect(state.status).toBe('OPEN');
    expect(state.config).toEqual(baseConfig);
    expect(state.messages).toHaveLength(2); // 인사말 텍스트 + 퀵리플라이 버튼
    expect(state.greetingShown).toBe(true);

    // 두 번째 CONFIG_LOADED(재오픈)에서는 인사말이 다시 추가되지 않는다.
    const reopened = reducer(state, { type: 'CONFIG_LOADED', config: baseConfig });
    expect(reopened.messages).toHaveLength(2);
  });

  it('CONFIG_DISABLED는 DISABLED 상태로 전이한다(403 — AC-W-13)', () => {
    const state = reducer(createInitialState(), { type: 'CONFIG_DISABLED' });
    expect(state.status).toBe('DISABLED');
  });

  it('SEND_STARTED는 사용자 메시지를 즉시 추가하고 SENDING으로 전이한다', () => {
    const state = reducer(createInitialState(), {
      type: 'SEND_STARTED',
      userMessage: { id: '1', role: 'user', text: '배송 조회' },
    });
    expect(state.status).toBe('SENDING');
    expect(state.messages).toHaveLength(1);
  });

  it('SEND_SUCCEEDED는 DISABLED 상태를 유지하고(§5.2 — 403은 OPEN에 머물지 않는다), 그 외에는 OPEN으로 돌아간다', () => {
    const disabled = reducer(createInitialState(), { type: 'CONFIG_DISABLED' });
    const afterDisabled = reducer(disabled, { type: 'SEND_SUCCEEDED', botMessages: [] });
    expect(afterDisabled.status).toBe('DISABLED');

    const open = reducer(createInitialState(), { type: 'CONFIG_LOADED', config: { ...baseConfig, greetingMessage: undefined, quickReplies: [] } });
    const sending = reducer(open, { type: 'SEND_STARTED' });
    const succeeded = reducer(sending, { type: 'SEND_SUCCEEDED', botMessages: [{ id: '2', role: 'bot', text: '응답' }] });
    expect(succeeded.status).toBe('OPEN');
    expect(succeeded.messages.at(-1)).toEqual({ id: '2', role: 'bot', text: '응답' });
  });

  it('SEND_FAILED는 ERROR 상태로 전이하며 오류 종류를 보존한다', () => {
    const state = reducer(createInitialState(), { type: 'SEND_FAILED', kind: 'NETWORK', message: 'network down' });
    expect(state.status).toBe('ERROR');
    expect(state.error).toEqual({ kind: 'NETWORK', message: 'network down' });
  });

  it('CLOSE는 항상 CLOSED로 돌아간다', () => {
    const state = reducer({ ...createInitialState(), status: 'OPEN' }, { type: 'CLOSE' });
    expect(state.status).toBe('CLOSED');
  });
});
