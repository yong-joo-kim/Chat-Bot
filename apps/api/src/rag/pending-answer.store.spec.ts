import { InMemoryPendingAnswerStore } from './pending-answer.store';

describe('InMemoryPendingAnswerStore — FR-N2-37, AC-N2-17~19', () => {
  it('AC-N2-17: create 후 complete하면 PENDING → READY로 전이한다', () => {
    const store = new InMemoryPendingAnswerStore();
    const expiresAt = new Date(Date.now() + 60_000);
    store.create('msg-1', { chatbotId: 'bot-1', slug: 'my-bot', expiresAt });

    expect(store.get('msg-1', 'my-bot')?.status).toBe('PENDING');

    store.complete('msg-1', { status: 'READY', outputs: [{ type: 'TEXT', payload: { text: '답변' } }] });
    const snapshot = store.get('msg-1', 'my-bot');
    expect(snapshot?.status).toBe('READY');
    expect(snapshot?.outputs).toEqual([{ type: 'TEXT', payload: { text: '답변' } }]);
  });

  it('AC-N2-18: 다른 슬러그로 조회하면 null(=404)이다', () => {
    const store = new InMemoryPendingAnswerStore();
    store.create('msg-2', { chatbotId: 'bot-1', slug: 'my-bot', expiresAt: new Date(Date.now() + 60_000) });
    expect(store.get('msg-2', 'other-bot')).toBeNull();
  });

  it('AC-N2-19: TTL 만료 후 조회하면 null이며 항목이 제거된다', () => {
    const store = new InMemoryPendingAnswerStore();
    store.create('msg-3', { chatbotId: 'bot-1', slug: 'my-bot', expiresAt: new Date(Date.now() - 1) });
    expect(store.get('msg-3', 'my-bot')).toBeNull();
    expect(store.get('msg-3', 'my-bot')).toBeNull(); // 제거 후 재조회도 계속 null
  });

  it('존재하지 않는 id는 null이다', () => {
    const store = new InMemoryPendingAnswerStore();
    expect(store.get('no-such-id', 'my-bot')).toBeNull();
  });

  it('complete 대상이 없으면 조용히 무시한다(경고 로그만)', () => {
    const store = new InMemoryPendingAnswerStore();
    expect(() => store.complete('missing', { status: 'FAILED' })).not.toThrow();
  });
});
