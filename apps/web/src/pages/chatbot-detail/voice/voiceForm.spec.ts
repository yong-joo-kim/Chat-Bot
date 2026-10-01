import { describe, expect, it } from 'vitest';
import type { VoiceSettingsView } from '@chat-bot/shared-types';
import { VoiceSettingsInputSchema } from '@chat-bot/shared-types';
import { fromView, isDirty, missingNodeIdsFromDetails, rateForSlider, toInput, validateRate } from './voiceForm';

function view(overrides: Partial<VoiceSettingsView> = {}): VoiceSettingsView {
  return {
    inputEnabled: false,
    ttsEnabled: false,
    autoReadToggleVisible: true,
    rateMultiplier: 1,
    defaultTone: 'CALM',
    toneByKind: {},
    nodeTones: [],
    updatedAt: null,
    ...overrides,
  };
}

describe('validateRate — 0.8~1.2 · 0.05 단위(서버 스키마와 같은 규칙)', () => {
  it.each(['0.8', '0.85', '0.95', '1', '1.00', '1.05', '1.15', '1.2'])('%s 통과', (t) => expect(validateRate(t)).toBeNull());
  it.each(['0.79', '1.21', '0', '2', '-1', '', 'abc'])('%s → 범위 오류', (t) => expect(validateRate(t)).toBe('range'));
  it.each(['0.81', '1.13', '0.99', '1.04', '1.151'])('%s → 단위 오류', (t) => expect(validateRate(t)).toBe('step'));
  it('저장 가능한 모든 0.05 단위 값이 서버 입력 스키마도 통과한다(콘솔 검증 = 서버 검증)', () => {
    for (let i = 80; i <= 120; i += 5) {
      const text = (i / 100).toFixed(2);
      expect(validateRate(text)).toBeNull();
      expect(VoiceSettingsInputSchema.safeParse(toInput({ ...fromView(view()), rateText: text })).success).toBe(true);
    }
  });
});

describe('rateForSlider', () => {
  it('범위 밖·비숫자는 가장 가까운 유효 값으로(표시용)', () => {
    expect(rateForSlider('1.05')).toBe(1.05);
    expect(rateForSlider('5')).toBe(1.2);
    expect(rateForSlider('0')).toBe(0.8);
    expect(rateForSlider('')).toBe(1);
    expect(rateForSlider('abc')).toBe(1);
  });
});

describe('fromView / toInput — 전체 교체 PUT 본문', () => {
  it('행 없음(기본값) 폼은 미응답 말투가 "사과(기본)"이고 저장 시 toneByKind 키를 만들지 않는다', () => {
    const form = fromView(view());
    expect(form.unansweredTone).toBe('APOLOGETIC');
    expect(form.unansweredExplicit).toBe(false);
    expect(toInput(form).toneByKind).toEqual({});
  });

  it('미응답 말투를 바꾸면(또는 서버에 명시 저장돼 있으면) UNANSWERED를 보낸다', () => {
    expect(toInput({ ...fromView(view()), unansweredTone: 'CALM', unansweredExplicit: true }).toneByKind).toEqual({ UNANSWERED: 'CALM' });
    const stored = fromView(view({ toneByKind: { UNANSWERED: 'APOLOGETIC' } }));
    expect(stored.unansweredExplicit).toBe(true);
    expect(toInput(stored).toneByKind).toEqual({ UNANSWERED: 'APOLOGETIC' });
  });

  it('toneByKind에는 UNANSWERED만 들어간다(BLOCKED·ERROR 등은 서버가 거부)', () => {
    const input = toInput({ ...fromView(view()), unansweredTone: 'BRIGHT', unansweredExplicit: true });
    expect(Object.keys(input.toneByKind)).toEqual(['UNANSWERED']);
    expect(VoiceSettingsInputSchema.safeParse(input).success).toBe(true);
  });

  it('nodeTones는 nodeId·tone만 보낸다(이름·nodeMissing은 보내지 않는다)', () => {
    const form = fromView(view({ nodeTones: [{ nodeId: '11111111-1111-4111-8111-111111111111', tone: 'BRIGHT', nodeName: '인사', nodeMissing: false }] }));
    expect(toInput(form).nodeTones).toEqual([{ nodeId: '11111111-1111-4111-8111-111111111111', tone: 'BRIGHT' }]);
  });
});

describe('isDirty', () => {
  it('같으면 false · 값이 바뀌면 true · 속도 문자열 표기만 다르면(1 vs 1.00) 변경으로 본다', () => {
    const base = fromView(view());
    expect(isDirty(base, { ...base })).toBe(false);
    expect(isDirty(base, { ...base, ttsEnabled: true })).toBe(true);
    expect(isDirty(base, { ...base, rateText: '1.05' })).toBe(true);
    expect(isDirty(base, { ...base, nodeTones: [{ nodeId: 'a', tone: 'CALM', nodeName: null }] })).toBe(true);
  });
});

describe('missingNodeIdsFromDetails', () => {
  it('INVALID_REFERENCE 상세 메시지에서 노드 id를 뽑는다', () => {
    const id = '22222222-2222-4222-8222-222222222222';
    expect(missingNodeIdsFromDetails([{ message: `노드를 찾을 수 없습니다: ${id}` }, { message: 'x' }])).toEqual([id]);
    expect(missingNodeIdsFromDetails(undefined)).toEqual([]);
  });
});
