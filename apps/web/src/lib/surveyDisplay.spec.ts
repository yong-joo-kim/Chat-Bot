import { describe, expect, it } from 'vitest';
import {
  activeFromIsoToDisplayDateInput,
  activeToIsoToDisplayDateInput,
  computeSurveyDisplayStatus,
  displayDateInputToActiveFromIso,
  displayDateInputToActiveToIso,
  formatSurveyPeriod,
} from './surveyDisplay';

/**
 * [No.27 코드 리뷰 1회차 H1·M4] `evaluateSurveyAvailability`(shared-types)를 재사용해 기간 판정을
 * 한다 — 이 파일은 규칙을 재구현하지 않고, "화면 입력값 ↔ 저장값" 변환과 그 변환이 실제 경계에서
 * 올바르게 동작하는지만 검증한다.
 */
describe('lib/surveyDisplay — activeTo 배타적 경계 변환(H1)', () => {
  it('종료일 입력값(YYYY-MM-DD)을 저장 시 다음날 00:00+09:00으로 변환한다', () => {
    expect(displayDateInputToActiveToIso('2026-10-31')).toBe('2026-11-01T00:00:00+09:00');
  });

  it('저장된 activeTo(다음날 00:00+09:00)를 화면에는 사용자가 고른 종료일 당일로 되돌린다', () => {
    expect(activeToIsoToDisplayDateInput('2026-11-01T00:00:00+09:00')).toBe('2026-10-31');
  });

  it('activeFrom은 포함 경계라 변환 없이 그대로 왕복한다', () => {
    expect(displayDateInputToActiveFromIso('2026-09-25')).toBe('2026-09-25T00:00:00+09:00');
    expect(activeFromIsoToDisplayDateInput('2026-09-25T00:00:00+09:00')).toBe('2026-09-25');
  });

  it('종료일 당일 23:59 KST에는 참여 가능(ACTIVE), 다음날 00:00 KST에는 불가(OUT_OF_PERIOD)하다', () => {
    const survey = { status: 'OPEN' as const, activeFrom: undefined, activeTo: new Date(displayDateInputToActiveToIso('2026-10-31')) };

    const lastMinuteOfEndDate = new Date('2026-10-31T23:59:00+09:00');
    const midnightAfterEndDate = new Date('2026-11-01T00:00:00+09:00');

    expect(computeSurveyDisplayStatus(survey, lastMinuteOfEndDate)).toBe('ACTIVE');
    expect(computeSurveyDisplayStatus(survey, midnightAfterEndDate)).toBe('OUT_OF_PERIOD');
  });
});

describe('lib/surveyDisplay — computeSurveyDisplayStatus(M4: evaluateSurveyAvailability 재사용)', () => {
  it('DRAFT/CLOSED는 기간과 무관하게 그대로 표시한다', () => {
    expect(computeSurveyDisplayStatus({ status: 'DRAFT' })).toBe('DRAFT');
    expect(computeSurveyDisplayStatus({ status: 'CLOSED' })).toBe('CLOSED');
  });

  it('OPEN이고 기간 제한이 없으면 ACTIVE다', () => {
    expect(computeSurveyDisplayStatus({ status: 'OPEN' })).toBe('ACTIVE');
  });

  it('OPEN이지만 시작 전(activeFrom이 미래)이면 OUT_OF_PERIOD다', () => {
    const now = new Date('2026-09-24T00:00:00+09:00');
    const survey = { status: 'OPEN' as const, activeFrom: new Date('2026-10-01T00:00:00+09:00') };
    expect(computeSurveyDisplayStatus(survey, now)).toBe('OUT_OF_PERIOD');
  });
});

describe('lib/surveyDisplay — formatSurveyPeriod(M3: 부분 기간 표시)', () => {
  it('시작·종료가 모두 있으면 "from ~ to" 형태로 표시한다', () => {
    const result = formatSurveyPeriod('2026-09-25T00:00:00+09:00', '2026-11-01T00:00:00+09:00');
    expect(result).toContain('~');
    expect(result).not.toBe('—');
  });

  it('시작일만 있으면 "from ~" 형태다', () => {
    const result = formatSurveyPeriod('2026-09-25T00:00:00+09:00', undefined);
    expect(result.endsWith('~')).toBe(true);
  });

  it('종료일만 있으면 "~ to" 형태다', () => {
    const result = formatSurveyPeriod(undefined, '2026-11-01T00:00:00+09:00');
    expect(result.startsWith('~')).toBe(true);
  });

  it('둘 다 없으면 periodNone 문구를 반환한다', () => {
    expect(formatSurveyPeriod(undefined, undefined)).toBe('—');
  });
});
