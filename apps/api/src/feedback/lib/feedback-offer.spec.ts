import { isFeedbackOffered, readFeedbackEnabled } from './feedback-offer';

const ENABLED_CONFIG = JSON.stringify({ feedbackEnabled: true });
const DISABLED_CONFIG = JSON.stringify({ feedbackEnabled: false });
const NO_KEY_CONFIG = JSON.stringify({});
const BROKEN_CONFIG = '{not-json';

describe('readFeedbackEnabled (§5.1)', () => {
  it('true when feedbackEnabled: true', () => {
    expect(readFeedbackEnabled(ENABLED_CONFIG)).toBe(true);
  });
  it('false when feedbackEnabled: false', () => {
    expect(readFeedbackEnabled(DISABLED_CONFIG)).toBe(false);
  });
  it('false when key is missing (default off)', () => {
    expect(readFeedbackEnabled(NO_KEY_CONFIG)).toBe(false);
  });
  it('false on malformed JSON (fallback)', () => {
    expect(readFeedbackEnabled(BROKEN_CONFIG)).toBe(false);
  });
});

describe('isFeedbackOffered (FR-FB2-\\*, ADR-0038 §1)', () => {
  const BASE = { features: ['feedback-v1'], webChannelConfigJson: ENABLED_CONFIG, blockedByFilter: false, surveyTurn: false, handoffTurn: false };

  it('true when feature declared · switch on · not blocked/survey/handoff', () => {
    expect(isFeedbackOffered(BASE)).toBe(true);
  });

  it('false when features is undefined (legacy widget) — does not even parse config', () => {
    expect(isFeedbackOffered({ ...BASE, features: undefined, webChannelConfigJson: BROKEN_CONFIG })).toBe(false);
  });

  it('false when feature not declared', () => {
    expect(isFeedbackOffered({ ...BASE, features: ['handoff-v1'] })).toBe(false);
  });

  it('false when switch is off even if feature declared', () => {
    expect(isFeedbackOffered({ ...BASE, webChannelConfigJson: DISABLED_CONFIG })).toBe(false);
  });

  it('false for blocked turns', () => {
    expect(isFeedbackOffered({ ...BASE, blockedByFilter: true })).toBe(false);
  });

  it('false for survey-consuming turns', () => {
    expect(isFeedbackOffered({ ...BASE, surveyTurn: true })).toBe(false);
  });

  it('false for handoff turns', () => {
    expect(isFeedbackOffered({ ...BASE, handoffTurn: true })).toBe(false);
  });
});
