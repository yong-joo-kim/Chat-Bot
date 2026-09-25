import { deriveEnvironmentBadges, judgeProdReflection, shouldShowRecurredAfterApply } from '@chat-bot/shared-types';

/**
 * [신규 No.40] shared-types 순수 함수 단위 시험 — `apps/api`가 jest로 검증한다(패키지 자체는
 * 테스트 러너가 없다, FE/BE 공용 규약).
 */
describe('deriveEnvironmentBadges — §4.1', () => {
  it('운영 버전이면 PROD를 포함한다', () => {
    expect(deriveEnvironmentBadges('v1', { prodVersionId: 'v1', stagingVersionId: null, prodHistoryIds: new Set() })).toEqual(['PROD']);
  });

  it('스테이징 버전이면 STAGING을 포함한다', () => {
    expect(deriveEnvironmentBadges('v1', { prodVersionId: null, stagingVersionId: 'v1', prodHistoryIds: new Set() })).toEqual(['STAGING']);
  });

  it('운영이면서 스테이징이면 PROD → STAGING 순서다', () => {
    expect(deriveEnvironmentBadges('v1', { prodVersionId: 'v1', stagingVersionId: 'v1', prodHistoryIds: new Set() })).toEqual(['PROD', 'STAGING']);
  });

  it('운영 이력에 있으나 현재 운영은 아니면 PROD_HISTORY다', () => {
    expect(deriveEnvironmentBadges('v-old', { prodVersionId: 'v-new', stagingVersionId: null, prodHistoryIds: new Set(['v-old']) })).toEqual(['PROD_HISTORY']);
  });

  it('현재 운영 버전은 PROD_HISTORY에 중복 표시되지 않는다', () => {
    expect(deriveEnvironmentBadges('v1', { prodVersionId: 'v1', stagingVersionId: null, prodHistoryIds: new Set(['v1']) })).toEqual(['PROD']);
  });

  it('어디에도 해당하지 않으면 빈 배열이다', () => {
    expect(deriveEnvironmentBadges('v-random', { prodVersionId: 'v1', stagingVersionId: 'v2', prodHistoryIds: new Set() })).toEqual([]);
  });
});

describe('judgeProdReflection — §15.1', () => {
  const resolvedAt = new Date('2026-03-10T00:00:00.000Z');

  it('전환 이력이 없으면 PENDING_SWITCH다', () => {
    expect(judgeProdReflection({ resolvedAt, prodSwitchesDesc: [] })).toEqual({ status: 'PENDING_SWITCH' });
  });

  it('현재 운영 버전의 capturedAt이 반영 시점보다 이르면 PENDING_SWITCH다(아직 미반영)', () => {
    const result = judgeProdReflection({
      resolvedAt,
      prodSwitchesDesc: [{ at: new Date('2026-03-11T00:00:00.000Z'), toVersionCapturedAt: new Date('2026-03-05T00:00:00.000Z') }],
    });
    expect(result).toEqual({ status: 'PENDING_SWITCH' });
  });

  it('현재 운영 버전의 capturedAt이 반영 시점 이후면 REFLECTED고, reflectedAt은 그 조건을 만족하는 가장 이른 이력이다', () => {
    const result = judgeProdReflection({
      resolvedAt,
      prodSwitchesDesc: [
        { at: new Date('2026-03-15T00:00:00.000Z'), toVersionCapturedAt: new Date('2026-03-12T00:00:00.000Z') },
        { at: new Date('2026-03-12T00:00:00.000Z'), toVersionCapturedAt: new Date('2026-03-11T00:00:00.000Z') },
        { at: new Date('2026-03-08T00:00:00.000Z'), toVersionCapturedAt: new Date('2026-03-01T00:00:00.000Z') },
      ],
    });
    expect(result).toEqual({ status: 'REFLECTED', reflectedAt: new Date('2026-03-12T00:00:00.000Z') });
  });

  it('toVersionCapturedAt이 null(DISABLE 이력)이면 PENDING_SWITCH다', () => {
    const result = judgeProdReflection({ resolvedAt, prodSwitchesDesc: [{ at: new Date('2026-03-11T00:00:00.000Z'), toVersionCapturedAt: null }] });
    expect(result).toEqual({ status: 'PENDING_SWITCH' });
  });
});

describe('shouldShowRecurredAfterApply — §15.1', () => {
  const lastOccurredAt = new Date('2026-03-10T00:00:00.000Z');

  it('reflection 없음(모드 꺼짐)이면 recurredCount > 0 그대로다(현행)', () => {
    expect(shouldShowRecurredAfterApply({ recurredCount: 1, lastOccurredAt })).toBe(true);
    expect(shouldShowRecurredAfterApply({ recurredCount: 0, lastOccurredAt })).toBe(false);
  });

  it('PENDING_SWITCH면 항상 false다(운영 미반영 기간 재유입은 "반영 후 재발생"이 아니다)', () => {
    expect(shouldShowRecurredAfterApply({ recurredCount: 5, lastOccurredAt, reflection: { status: 'PENDING_SWITCH' } })).toBe(false);
  });

  it('REFLECTED면 recurredCount>0 이고 lastOccurredAt이 reflectedAt 이후일 때만 true다', () => {
    const reflectedAt = new Date('2026-03-05T00:00:00.000Z');
    expect(shouldShowRecurredAfterApply({ recurredCount: 1, lastOccurredAt, reflection: { status: 'REFLECTED', reflectedAt } })).toBe(true);

    const beforeReflected = new Date('2026-03-01T00:00:00.000Z');
    expect(shouldShowRecurredAfterApply({ recurredCount: 1, lastOccurredAt: beforeReflected, reflection: { status: 'REFLECTED', reflectedAt } })).toBe(false);

    expect(shouldShowRecurredAfterApply({ recurredCount: 0, lastOccurredAt, reflection: { status: 'REFLECTED', reflectedAt } })).toBe(false);
  });
});
