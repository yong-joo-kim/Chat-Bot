import { verifyFeedbackTarget } from './feedback-verify';

const VALID_ROW = { id: 'log-1', chatbotId: 'bot-1', sessionId: 'session-1', feedbackOffered: true };
const TARGET = { chatbotId: 'bot-1', sessionId: 'session-1' };

describe('verifyFeedbackTarget (§7.2, ADR-0038 §2 — 위조 방어)', () => {
  it('true when row exists · chatbotId matches · sessionId matches · feedbackOffered true', () => {
    expect(verifyFeedbackTarget(VALID_ROW, TARGET)).toBe(true);
  });

  it('false when row is null (no such message)', () => {
    expect(verifyFeedbackTarget(null, TARGET)).toBe(false);
  });

  it('false when chatbotId mismatches (cross-chatbot forgery)', () => {
    expect(verifyFeedbackTarget(VALID_ROW, { ...TARGET, chatbotId: 'bot-2' })).toBe(false);
  });

  it('false when sessionId mismatches (other session forgery)', () => {
    expect(verifyFeedbackTarget(VALID_ROW, { ...TARGET, sessionId: 'session-2' })).toBe(false);
  });

  it('false when row.sessionId is null (should never rate a null-session log)', () => {
    expect(verifyFeedbackTarget({ ...VALID_ROW, sessionId: null }, TARGET)).toBe(false);
  });

  it('false when feedbackOffered is false (turn was not offered rating)', () => {
    expect(verifyFeedbackTarget({ ...VALID_ROW, feedbackOffered: false }, TARGET)).toBe(false);
  });
});
