import { evaluateSessionAlert } from './session-alert';
import type { SessionAlertLogRow } from './session-alert';

function row(overrides: Partial<SessionAlertLogRow> = {}): SessionAlertLogRow {
  return { isAnswered: true, blockedByFilter: false, surveyTurn: false, handoffTurn: false, apiNotice: false, ...overrides };
}

describe('evaluateSessionAlert — P-6·AC-CS2-1~5', () => {
  it('전부 응답됨이면 NORMAL이다', () => {
    const result = evaluateSessionAlert([row(), row(), row()], { caution: 2, warning: 3 });
    expect(result.alertLevel).toBe('NORMAL');
    expect(result.consecutiveUnanswered).toBe(0);
  });

  it('연속 미응답이 주의 임계값에 도달하면 CAUTION이다', () => {
    const result = evaluateSessionAlert([row({ isAnswered: false }), row({ isAnswered: false })], { caution: 2, warning: 3 });
    expect(result.alertLevel).toBe('CAUTION');
    expect(result.consecutiveUnanswered).toBe(2);
  });

  it('연속 미응답이 경고 임계값에 도달하면 WARNING이다', () => {
    const rows = [row({ isAnswered: false }), row({ isAnswered: false }), row({ isAnswered: false })];
    const result = evaluateSessionAlert(rows, { caution: 2, warning: 3 });
    expect(result.alertLevel).toBe('WARNING');
  });

  it('BLOCK 턴은 중립이다 — 연속을 끊지도 늘리지도 않고 blockedCount만 늘린다', () => {
    const rows = [row({ isAnswered: false }), row({ blockedByFilter: true }), row({ isAnswered: false })];
    const result = evaluateSessionAlert(rows, { caution: 2, warning: 3 });
    expect(result.consecutiveUnanswered).toBe(2);
    expect(result.blockedCount).toBe(1);
  });

  it('설문·상담 구간 턴도 중립이다', () => {
    const rows = [row({ isAnswered: false }), row({ surveyTurn: true }), row({ handoffTurn: true }), row({ isAnswered: false })];
    const result = evaluateSessionAlert(rows, { caution: 2, warning: 3 });
    expect(result.consecutiveUnanswered).toBe(2);
  });

  it('응답된 턴은 연속 카운트를 0으로 되돌린다', () => {
    const rows = [row({ isAnswered: false }), row({ isAnswered: false }), row(), row({ isAnswered: false })];
    const result = evaluateSessionAlert(rows, { caution: 2, warning: 3 });
    expect(result.consecutiveUnanswered).toBe(1);
  });

  it('API 고정 문구 턴(apiNotice)은 미응답으로 세고 사유를 API_NOTICE로 남긴다(P-6)', () => {
    const result = evaluateSessionAlert([row({ isAnswered: false, apiNotice: true })], { caution: 2, warning: 3 });
    expect(result.windowUnanswered).toBe(1);
    expect(result.lastUnansweredReason).toBe('API_NOTICE');
  });

  it('일반 폴백 미응답의 사유는 FALLBACK이다', () => {
    const result = evaluateSessionAlert([row({ isAnswered: false })], { caution: 2, warning: 3 });
    expect(result.lastUnansweredReason).toBe('FALLBACK');
  });
});
