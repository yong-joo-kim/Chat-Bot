import {
  MoveProactiveRuleSchema,
  ProactivePathPatternSchema,
  ProactiveRuleInputSchema,
  ProactiveScheduleSchema,
  ProactiveSettingsInputSchema,
  PublicProactiveEventSchema,
  PublicProactivePayloadSchema,
  PublicProactiveRuleSchema,
} from '@chat-bot/shared-types';

const VALID_RULE = {
  name: '배송조회 도움',
  trigger: { kind: 'PAGE_DWELL' as const, pathInclude: ['/order/**'], pathExclude: [], dwellSec: 30 },
  text: '주문·배송 조회를 도와드릴까요?',
  buttons: [{ label: '배송 조회하기', action: 'NODE' as const, value: '11111111-1111-1111-1111-111111111111' }],
  devices: ['DESKTOP' as const],
  purposeConfirmed: true as const,
};

describe('ProactiveRuleInputSchema — AC-PA2-2·3·4·7', () => {
  it('용도 확인 없이 저장하면 실패한다(AC-PA2-2)', () => {
    const { purposeConfirmed: _drop, ...rest } = VALID_RULE;
    const result = ProactiveRuleInputSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('용도 확인이 false면 실패한다', () => {
    const result = ProactiveRuleInputSchema.safeParse({ ...VALID_RULE, purposeConfirmed: false });
    expect(result.success).toBe(false);
  });

  it('문구에 치환 형태({name})가 있으면 실패한다(AC-PA2-3)', () => {
    const result = ProactiveRuleInputSchema.safeParse({ ...VALID_RULE, text: '{name}님 안녕하세요' });
    expect(result.success).toBe(false);
  });

  it('문구가 121자면 실패한다(상한 120)', () => {
    const result = ProactiveRuleInputSchema.safeParse({ ...VALID_RULE, text: 'a'.repeat(121) });
    expect(result.success).toBe(false);
  });

  it('문구 120자는 성공한다(경계)', () => {
    const result = ProactiveRuleInputSchema.safeParse({ ...VALID_RULE, text: 'a'.repeat(120) });
    expect(result.success).toBe(true);
  });

  it('줄바꿈이 3번이면 실패한다(상한 2)', () => {
    const result = ProactiveRuleInputSchema.safeParse({ ...VALID_RULE, text: 'a\nb\nc\nd' });
    expect(result.success).toBe(false);
  });

  it('LINK 버튼이 http://면 실패한다(AC-PA2-4)', () => {
    const result = ProactiveRuleInputSchema.safeParse({
      ...VALID_RULE,
      buttons: [{ label: '이동', action: 'LINK', value: 'http://example.com' }],
    });
    expect(result.success).toBe(false);
  });

  it('LINK 버튼이 https://면 성공한다', () => {
    const result = ProactiveRuleInputSchema.safeParse({
      ...VALID_RULE,
      buttons: [{ label: '이동', action: 'LINK', value: 'https://example.com' }],
    });
    expect(result.success).toBe(true);
  });

  it('정규식 패턴(^/order.*$)은 거부한다(AC-PA2-7 — 리터럴 문자 ^·$·. 는 허용되지 않는 문자가 아니라서 통과할 수 있지만, 구조가 실제 요청 경로와 다르게 취급된다는 점을 확인)', () => {
    const result = ProactiveRuleInputSchema.safeParse({
      ...VALID_RULE,
      trigger: { kind: 'PAGE_DWELL', pathInclude: ['^/order.*$'], pathExclude: [], dwellSec: 30 },
    });
    // '^/order.*$'는 '/'로 시작하지 않아 경로 패턴 문법 위반으로 거부된다.
    expect(result.success).toBe(false);
  });

  it('체류 시간이 4초면 실패(하한 5)', () => {
    const result = ProactiveRuleInputSchema.safeParse({ ...VALID_RULE, trigger: { ...VALID_RULE.trigger, dwellSec: 4 } });
    expect(result.success).toBe(false);
  });

  it('체류 시간이 601초면 실패(상한 600)', () => {
    const result = ProactiveRuleInputSchema.safeParse({ ...VALID_RULE, trigger: { ...VALID_RULE.trigger, dwellSec: 601 } });
    expect(result.success).toBe(false);
  });

  it('버튼이 4개면 실패(상한 3)', () => {
    const btn = { label: 'a', action: 'MESSAGE' as const, value: 'hi' };
    const result = ProactiveRuleInputSchema.safeParse({ ...VALID_RULE, buttons: [btn, btn, btn, btn] });
    expect(result.success).toBe(false);
  });

  it('버튼 라벨이 21자면 실패(상한 20)', () => {
    const result = ProactiveRuleInputSchema.safeParse({ ...VALID_RULE, buttons: [{ label: 'a'.repeat(21), action: 'MESSAGE', value: 'hi' }] });
    expect(result.success).toBe(false);
  });

  it('정상 입력은 성공한다', () => {
    expect(ProactiveRuleInputSchema.safeParse(VALID_RULE).success).toBe(true);
  });

  it('.strict() — 모르는 키가 있으면 실패한다', () => {
    const result = ProactiveRuleInputSchema.safeParse({ ...VALID_RULE, enabled: true });
    expect(result.success).toBe(false);
  });

  it('devices 기본값은 [DESKTOP]', () => {
    const { devices: _drop, ...rest } = VALID_RULE;
    const result = ProactiveRuleInputSchema.safeParse(rest);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.devices).toEqual(['DESKTOP']);
  });
});

describe('ProactivePathPatternSchema — 세그먼트 문법(정규식 아님)', () => {
  it.each(['/order/**', '/order/*', '/order/complete', '/'])('%s는 유효하다', (p) => {
    expect(ProactivePathPatternSchema.safeParse(p).success).toBe(true);
  });

  it.each(['order', '/order//x', '/order/*x', '/a/**/**/**'])('%s는 무효하다', (p) => {
    expect(ProactivePathPatternSchema.safeParse(p).success).toBe(false);
  });

  it('끝 슬래시는 정규화로 제거된다', () => {
    const result = ProactivePathPatternSchema.safeParse('/order/');
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBe('/order');
  });
});

describe('ProactiveScheduleSchema', () => {
  it('from >= to면 실패', () => {
    expect(ProactiveScheduleSchema.safeParse({ days: [0], from: '18:00', to: '09:00' }).success).toBe(false);
  });
  it('요일 중복이면 실패', () => {
    expect(ProactiveScheduleSchema.safeParse({ days: [0, 0], from: '09:00', to: '18:00' }).success).toBe(false);
  });
  it('정상 입력은 성공', () => {
    expect(ProactiveScheduleSchema.safeParse({ days: [0, 1], from: '09:00', to: '18:00' }).success).toBe(true);
  });
});

describe('ProactiveSettingsInputSchema', () => {
  it('.strict() — 모르는 키 거부', () => {
    expect(ProactiveSettingsInputSchema.safeParse({ enabled: true, maxPerSession: 1, minIntervalSec: 60, quietAfterUserMessageSec: 300, extra: 1 }).success).toBe(false);
  });
  it('세션당 최대 표시 0은 실패(하한 1)', () => {
    expect(ProactiveSettingsInputSchema.safeParse({ enabled: true, maxPerSession: 0, minIntervalSec: 60, quietAfterUserMessageSec: 300 }).success).toBe(false);
  });
});

describe('MoveProactiveRuleSchema', () => {
  it('UP·DOWN만 허용', () => {
    expect(MoveProactiveRuleSchema.safeParse({ direction: 'UP' }).success).toBe(true);
    expect(MoveProactiveRuleSchema.safeParse({ direction: 'LEFT' }).success).toBe(false);
  });
});

describe('공개 스키마 키 집합(PA-4 · PA-5 · NFR-PAS2) — 프로그램적 검사', () => {
  it('PublicProactiveEventSchema는 strict이고 키가 {sessionId, ruleId, kind} 뿐이다', () => {
    const def = PublicProactiveEventSchema._def as { unknownKeys?: string };
    expect(def.unknownKeys).toBe('strict');
    expect(Object.keys(PublicProactiveEventSchema.shape).sort()).toEqual(['kind', 'ruleId', 'sessionId']);
  });

  it('url 필드를 추가하면 400(strict 위반)이다(AC-PA5-2)', () => {
    const result = PublicProactiveEventSchema.safeParse({ sessionId: '11111111-1111-1111-1111-111111111111', ruleId: '11111111-1111-1111-1111-111111111111', kind: 'SHOWN', url: '/x' });
    expect(result.success).toBe(false);
  });

  it('PublicProactiveRuleSchema 키 집합 = {id, trigger, text, buttons, devices, showUntil}(이름·기간 원본·수정자·통계 없음)', () => {
    expect(Object.keys(PublicProactiveRuleSchema.shape).sort()).toEqual(['buttons', 'devices', 'id', 'showUntil', 'text', 'trigger']);
  });

  it('PublicProactivePayloadSchema 키 집합 = {caps, rules}', () => {
    expect(Object.keys(PublicProactivePayloadSchema.shape).sort()).toEqual(['caps', 'rules']);
  });
});
