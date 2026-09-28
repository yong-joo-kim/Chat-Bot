import { decodeProactiveRule, encodeProactiveRule } from './rule-codec';
import type { ProactiveTrigger } from '@chat-bot/shared-types';

const TRIGGER: ProactiveTrigger = { kind: 'PAGE_DWELL', pathInclude: ['/order/**'], pathExclude: [], dwellSec: 30 };

describe('encodeProactiveRule / decodeProactiveRule — JSON 컬럼 안전 왕복', () => {
  it('인코딩 후 디코딩하면 원래 값으로 복원된다', () => {
    const encoded = encodeProactiveRule({
      trigger: TRIGGER,
      buttons: [{ label: '이동', action: 'NODE', value: '11111111-1111-1111-1111-111111111111' }],
      devices: ['DESKTOP', 'MOBILE'],
      schedule: { days: [0, 1], from: '09:00', to: '18:00' },
    });
    expect(encoded.triggerKind).toBe('PAGE_DWELL');
    const decoded = decodeProactiveRule(encoded);
    expect(decoded).not.toBeNull();
    expect(decoded!.trigger).toEqual(TRIGGER);
    expect(decoded!.devices).toEqual(['DESKTOP', 'MOBILE']);
    expect(decoded!.schedule).toEqual({ days: [0, 1], from: '09:00', to: '18:00' });
  });

  it('schedule 없음은 null 컬럼 → null로 왕복', () => {
    const encoded = encodeProactiveRule({ trigger: TRIGGER, buttons: [], devices: ['DESKTOP'], schedule: null });
    expect(encoded.schedule).toBeNull();
    const decoded = decodeProactiveRule(encoded);
    expect(decoded!.schedule).toBeNull();
  });

  it('JSON 파싱 실패면 null(INVALID_STORED로 취급)', () => {
    const decoded = decodeProactiveRule({ trigger: '{broken', buttons: '[]', devices: '["DESKTOP"]', schedule: null });
    expect(decoded).toBeNull();
  });

  it('스키마에 맞지 않는 값(trigger.kind 불량)도 null', () => {
    const decoded = decodeProactiveRule({ trigger: JSON.stringify({ kind: 'UNKNOWN' }), buttons: '[]', devices: '["DESKTOP"]', schedule: null });
    expect(decoded).toBeNull();
  });

  it('buttons 배열이 아니면 null', () => {
    const decoded = decodeProactiveRule({ trigger: JSON.stringify(TRIGGER), buttons: '{}', devices: '["DESKTOP"]', schedule: null });
    expect(decoded).toBeNull();
  });
});
