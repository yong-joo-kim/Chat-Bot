import { matchIntent, matchFaq, simulate } from './matcher';
import type { Intent, FaqEntry } from '@chat-bot/shared-types';

const intents: Intent[] = [
  {
    id: 'intent-1',
    chatbotId: 'bot-1',
    name: '배송조회',
    examples: ['제 주문 어디까지 왔어요?', '배송 조회하고 싶어요', '택배 언제 도착하나요'],
    createdAt: new Date(),
    updatedAt: new Date(),
  },
];

const faqs: FaqEntry[] = [
  {
    id: 'faq-1',
    chatbotId: 'bot-1',
    category: 'SELF_SERVICE',
    question: '영업시간이 어떻게 되나요?',
    answer: '평일 09:00~18:00 운영합니다.',
    createdAt: new Date(),
    updatedAt: new Date(),
  },
];

describe('matchIntent', () => {
  it('정확일치 예문을 매칭한다', () => {
    const result = matchIntent('배송 조회하고 싶어요', intents);
    expect(result?.intentId).toBe('intent-1');
  });

  it('부분일치도 매칭한다', () => {
    const result = matchIntent('택배 언제 도착하나요 알려주세요', intents);
    expect(result?.intentId).toBe('intent-1');
  });

  it('매칭되는 예문이 없으면 null', () => {
    expect(matchIntent('오늘 날씨 어때요', intents)).toBeNull();
  });
});

describe('matchFaq', () => {
  it('질문을 매칭해 답변을 반환한다', () => {
    const result = matchFaq('영업시간이 어떻게 되나요?', faqs);
    expect(result?.answer).toBe('평일 09:00~18:00 운영합니다.');
  });
});

describe('simulate (No.10 응답 테스트/시뮬레이션)', () => {
  it('FAQ를 의도보다 우선 매칭한다', () => {
    const result = simulate('영업시간이 어떻게 되나요?', intents, faqs);
    expect(result.matchedFaqId).toBe('faq-1');
  });

  it('매칭 실패 시 폴백 응답을 반환한다', () => {
    const result = simulate('asdkjaslkdj', intents, faqs);
    expect(result.matchedIntentId).toBeUndefined();
    expect(result.matchedFaqId).toBeUndefined();
    expect(result.response).toContain('이해하지 못했어요');
  });
});
