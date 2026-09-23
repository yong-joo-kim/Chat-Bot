import { checkScheduleTimeRules, DEPLOY_SCHEDULE_LIMITS, formatInstantInZone, zonedLocalToInstant } from '@chat-bot/shared-types';
import { OffsetDateTimeSchema } from '@chat-bot/shared-types';

/**
 * 새 테스트 — 구현·리뷰 단계 공백 보강(2026-09-24, No.28 시험 회차). `packages/shared-types`에는
 * 테스트 러너가 없어(package.json에 test 스크립트·jest/vitest 설정 0) 순수 함수
 * (`checkScheduleTimeRules`/`zonedLocalToInstant`/`formatInstantInZone`, §14)가 이전까지 어떤
 * 계층에서도 전용 시험 없이 존재했다 — apps/api의 Jest에서 import해 시험한다(작업 지시 #7).
 */
describe('shared-types deploy-schedule 시간 순수 함수(§14)', () => {
  describe('checkScheduleTimeRules(§6.3)', () => {
    const now = new Date('2027-01-01T00:00:00.000Z');

    it('리드타임(5분) 미만이면 LEAD 위반이다', () => {
      const scheduledAt = new Date(now.getTime() + 4 * 60_000);
      expect(checkScheduleTimeRules({ scheduledAt, now, otherActiveTimes: [] })).toEqual([{ rule: 'LEAD' }]);
    });

    it('정확히 리드타임(5분)이면 위반이 아니다(경계값)', () => {
      const scheduledAt = new Date(now.getTime() + DEPLOY_SCHEDULE_LIMITS.minLeadMinutes * 60_000);
      expect(checkScheduleTimeRules({ scheduledAt, now, otherActiveTimes: [] })).toEqual([]);
    });

    it('최대 기간(90일) 초과면 HORIZON 위반이다', () => {
      const scheduledAt = new Date(now.getTime() + (DEPLOY_SCHEDULE_LIMITS.maxHorizonDays + 1) * 86_400_000);
      expect(checkScheduleTimeRules({ scheduledAt, now, otherActiveTimes: [] })).toEqual([{ rule: 'HORIZON' }]);
    });

    it('정확히 90일이면 위반이 아니다(경계값)', () => {
      const scheduledAt = new Date(now.getTime() + DEPLOY_SCHEDULE_LIMITS.maxHorizonDays * 86_400_000);
      expect(checkScheduleTimeRules({ scheduledAt, now, otherActiveTimes: [] })).toEqual([]);
    });

    it('같은 분에 다른 활성 예약이 있으면 SPACING 위반이다(분 정규화 가정)', () => {
      const scheduledAt = new Date(now.getTime() + 60 * 60_000);
      expect(checkScheduleTimeRules({ scheduledAt, now, otherActiveTimes: [scheduledAt] })).toEqual([{ rule: 'SPACING' }]);
    });

    it('여러 위반이 동시에 나면 전부 반환한다', () => {
      const scheduledAt = new Date(now.getTime() + 60_000); // 리드타임 미달
      const result = checkScheduleTimeRules({ scheduledAt, now, otherActiveTimes: [scheduledAt] });
      expect(result).toEqual(expect.arrayContaining([{ rule: 'LEAD' }, { rule: 'SPACING' }]));
      expect(result).toHaveLength(2);
    });
  });

  describe('OffsetDateTimeSchema — 오프셋 없는 ISO 입력 거부(FR-D2-9, AC-D1-6)', () => {
    it('오프셋 없는 로컬 시각 문자열은 거부된다', () => {
      expect(OffsetDateTimeSchema.safeParse('2027-01-15T09:00:00').success).toBe(false);
    });

    it('Z 또는 +HH:mm 오프셋이 있으면 허용되고, 초·밀리초는 분 단위로 절삭된다', () => {
      const z = OffsetDateTimeSchema.safeParse('2027-01-15T09:00:00.000Z');
      expect(z.success).toBe(true);
      if (z.success) expect(z.data.toISOString()).toBe('2027-01-15T09:00:00.000Z');

      const offset = OffsetDateTimeSchema.safeParse('2027-01-15T09:00:30+09:00');
      expect(offset.success).toBe(true);
      // 09:00:30+09:00 = 00:00:30Z → 분 단위 절삭 → 00:00:00Z
      if (offset.success) expect(offset.data.toISOString()).toBe('2027-01-15T00:00:00.000Z');
    });
  });

  describe('zonedLocalToInstant(§14, DST 안전)', () => {
    it('평시(한국, DST 없음) — 지역 시각을 정확한 UTC 순간으로 변환한다', () => {
      const result = zonedLocalToInstant({ date: '2027-01-15', time: '09:00' }, 'Asia/Seoul');
      expect(result).toEqual({ kind: 'OK', instant: new Date('2027-01-15T00:00:00.000Z') });
    });

    it('UTC(오프셋 0)는 그대로 변환된다', () => {
      const result = zonedLocalToInstant({ date: '2027-01-15', time: '09:00' }, 'UTC');
      expect(result).toEqual({ kind: 'OK', instant: new Date('2027-01-15T09:00:00.000Z') });
    });

    it('음의 오프셋(America/New_York, 평시 UTC-5) 지역도 정확히 변환된다', () => {
      // 2027-01-15는 미국 DST 밖(EST, UTC-5)이다.
      const result = zonedLocalToInstant({ date: '2027-01-15', time: '09:00' }, 'America/New_York');
      expect(result).toEqual({ kind: 'OK', instant: new Date('2027-01-15T14:00:00.000Z') });
    });

    it('DST 스프링포워드(봄 전환) — 존재하지 않는 지역 시각은 NONEXISTENT다', () => {
      // 미국 동부는 2027-03-14 02:00에 03:00으로 건너뛴다(2:00~2:59는 존재하지 않는 시각).
      const result = zonedLocalToInstant({ date: '2027-03-14', time: '02:30' }, 'America/New_York');
      expect(result.kind).toBe('NONEXISTENT');
    });

    it('DST 스프링포워드 직전/직후 경계는 정상적으로 OK다', () => {
      const before = zonedLocalToInstant({ date: '2027-03-14', time: '01:59' }, 'America/New_York');
      expect(before.kind).toBe('OK');
      const after = zonedLocalToInstant({ date: '2027-03-14', time: '03:00' }, 'America/New_York');
      expect(after.kind).toBe('OK');
    });

    it('DST 가을 전환(폴백) — 중복되는 지역 시각은 AMBIGUOUS이고 이른/늦은 순간 둘 다 반환한다', () => {
      // 미국 동부는 2027-11-07 02:00에 01:00으로 되돌아간다 — 01:00~01:59가 두 번 존재한다.
      const result = zonedLocalToInstant({ date: '2027-11-07', time: '01:30' }, 'America/New_York');
      expect(result.kind).toBe('AMBIGUOUS');
      if (result.kind === 'AMBIGUOUS') {
        expect(result.earlier.getTime()).toBeLessThan(result.later.getTime());
        expect(result.later.getTime() - result.earlier.getTime()).toBe(3_600_000); // 정확히 1시간 차이
      }
    });
  });

  describe('formatInstantInZone(§14) — 표시 변환은 zonedLocalToInstant의 역', () => {
    it('KST는 알려진 약어(KST)와 함께 UTC+9로 표시된다', () => {
      const f = formatInstantInZone(new Date('2027-01-15T00:00:00.000Z'), 'Asia/Seoul');
      expect(f).toEqual({ date: '2027-01-15', time: '09:00', offsetLabel: 'UTC+9', abbreviation: 'KST' });
    });

    it('알려지지 않은 시간대는 약어 없이 오프셋만 표시한다', () => {
      const f = formatInstantInZone(new Date('2027-01-15T14:00:00.000Z'), 'America/New_York');
      expect(f.offsetLabel).toBe('UTC-5');
      expect(f.abbreviation).toBeUndefined();
    });

    it('DST 지역은 같은 IANA 시간대라도 시점에 따라 오프셋이 달라진다(순간 기준 계산)', () => {
      const winter = formatInstantInZone(new Date('2027-01-15T14:00:00.000Z'), 'America/New_York');
      const summer = formatInstantInZone(new Date('2027-07-15T14:00:00.000Z'), 'America/New_York');
      expect(winter.offsetLabel).toBe('UTC-5');
      expect(summer.offsetLabel).toBe('UTC-4');
    });

    it('zonedLocalToInstant → formatInstantInZone 왕복이 원래 지역 시각과 일치한다(평시)', () => {
      const converted = zonedLocalToInstant({ date: '2027-06-01', time: '13:45' }, 'Asia/Seoul');
      expect(converted.kind).toBe('OK');
      if (converted.kind !== 'OK') return;
      const formatted = formatInstantInZone(converted.instant, 'Asia/Seoul');
      expect(formatted.date).toBe('2027-06-01');
      expect(formatted.time).toBe('13:45');
    });
  });
});
