import { attributeTopChatbot } from './question-attribution';

describe('attributeTopChatbot (No.29 §5.6, J-9)', () => {
  it('picks the chatbot with the highest summed count per normalized question', () => {
    const result = attributeTopChatbot(
      ['배송 조회'],
      [
        { userMessage: '배송 조회', chatbotId: 'bot-a', count: 3, lastOccurredAt: new Date('2026-09-01T00:00:00Z') },
        { userMessage: ' 배송  조회 ', chatbotId: 'bot-a', count: 2, lastOccurredAt: new Date('2026-09-02T00:00:00Z') },
        { userMessage: '배송 조회', chatbotId: 'bot-b', count: 4, lastOccurredAt: new Date('2026-09-03T00:00:00Z') },
      ],
    );
    // bot-a: 3+2=5, bot-b: 4 → bot-a wins
    expect(result.get('배송 조회')).toEqual({ chatbotId: 'bot-a', count: 5 });
  });

  it('breaks ties by most recent occurrence, then chatbotId ascending', () => {
    const byRecency = attributeTopChatbot(
      ['환불'],
      [
        { userMessage: '환불', chatbotId: 'bot-z', count: 2, lastOccurredAt: new Date('2026-09-05T00:00:00Z') },
        { userMessage: '환불', chatbotId: 'bot-a', count: 2, lastOccurredAt: new Date('2026-09-01T00:00:00Z') },
      ],
    );
    expect(byRecency.get('환불')?.chatbotId).toBe('bot-z');

    const byId = attributeTopChatbot(
      ['영업시간'],
      [
        { userMessage: '영업시간', chatbotId: 'bot-z', count: 1, lastOccurredAt: new Date('2026-09-01T00:00:00Z') },
        { userMessage: '영업시간', chatbotId: 'bot-a', count: 1, lastOccurredAt: new Date('2026-09-01T00:00:00Z') },
      ],
    );
    expect(byId.get('영업시간')?.chatbotId).toBe('bot-a');
  });

  it('ignores rows whose normalized text is not among the topQuestions', () => {
    const result = attributeTopChatbot(
      ['배송 조회'],
      [{ userMessage: '전혀 다른 질문', chatbotId: 'bot-a', count: 100, lastOccurredAt: new Date() }],
    );
    expect(result.size).toBe(0);
  });
});
