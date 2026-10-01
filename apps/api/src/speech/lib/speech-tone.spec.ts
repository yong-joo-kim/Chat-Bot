import { SPEECH_TONES } from '@chat-bot/shared-types';
import { SAFETY_TONE, UNANSWERED_DEFAULT_TONE, buildSpeechReplyPlan, decideSpeechTone } from './speech-tone';
import { DEFAULT_VOICE_SETTINGS, decodeNodeTones, decodeToneByKind, decodeVoiceSettingsRow, encodeVoiceSettingsInput } from './voice-settings-codec';
import type { VoiceSettings } from './voice-settings-codec';

const NODE_A = '11111111-1111-4111-8111-111111111111';
const NODE_B = '22222222-2222-4222-8222-222222222222';

function settings(overrides: Partial<VoiceSettings> = {}): VoiceSettings {
  return { ...DEFAULT_VOICE_SETTINGS, toneByKind: {}, nodeTones: [], ttsEnabled: true, ...overrides };
}

describe('말투 결정(§6.2) — 우선순위 3종', () => {
  it('SAFETY는 CALM 고정 — 기본 말투·노드 꼬리표·미응답 지정과 무관(최우선)', () => {
    const plan = buildSpeechReplyPlan(settings({ defaultTone: 'BRIGHT', toneByKind: { UNANSWERED: 'INFORMATIVE' }, nodeTones: [{ nodeId: NODE_A, tone: 'BRIGHT' }] }));
    expect(decideSpeechTone(plan, 'SAFETY', NODE_A)).toBe(SAFETY_TONE);
    expect(SAFETY_TONE).toBe('CALM');
  });

  it('노드 꼬리표는 ANSWERED·UNANSWERED 모두에 종류 규칙보다 앞선다', () => {
    const plan = buildSpeechReplyPlan(settings({ defaultTone: 'CALM', nodeTones: [{ nodeId: NODE_A, tone: 'BRIGHT' }] }));
    expect(decideSpeechTone(plan, 'ANSWERED', NODE_A)).toBe('BRIGHT');
    expect(decideSpeechTone(plan, 'UNANSWERED', NODE_A)).toBe('BRIGHT');
    expect(decideSpeechTone(plan, 'ANSWERED', NODE_B)).toBe('CALM');
    expect(decideSpeechTone(plan, 'ANSWERED', null)).toBe('CALM');
    expect(decideSpeechTone(plan, 'ANSWERED')).toBe('CALM');
  });

  it('UNANSWERED는 지정이 없으면 APOLOGETIC, 지정이 있으면 그 말투', () => {
    expect(decideSpeechTone(buildSpeechReplyPlan(settings()), 'UNANSWERED')).toBe(UNANSWERED_DEFAULT_TONE);
    expect(UNANSWERED_DEFAULT_TONE).toBe('APOLOGETIC');
    expect(decideSpeechTone(buildSpeechReplyPlan(settings({ toneByKind: { UNANSWERED: 'INFORMATIVE' } })), 'UNANSWERED')).toBe('INFORMATIVE');
  });

  it('ANSWERED는 기본 말투(defaultTone)', () => {
    expect(decideSpeechTone(buildSpeechReplyPlan(settings({ defaultTone: 'INFORMATIVE' })), 'ANSWERED')).toBe('INFORMATIVE');
  });

  it('결과는 항상 닫힌 4종 중 하나', () => {
    const plan = buildSpeechReplyPlan(settings({ defaultTone: 'BRIGHT', nodeTones: [{ nodeId: NODE_A, tone: 'APOLOGETIC' }] }));
    for (const kind of ['ANSWERED', 'UNANSWERED', 'SAFETY'] as const) for (const node of [NODE_A, NODE_B, null]) expect(SPEECH_TONES).toContain(decideSpeechTone(plan, kind, node));
  });

  it('계획은 말투 이름만 담는다(글자 0)', () => {
    const plan = buildSpeechReplyPlan(settings({ nodeTones: [{ nodeId: NODE_A, tone: 'BRIGHT' }] }));
    expect(Object.keys(plan).sort()).toEqual(['answeredTone', 'nodeTones', 'unansweredTone']);
    expect(plan.nodeTones.get(NODE_A)).toBe('BRIGHT');
  });
});

describe('음성 설정 코덱(JSON 안전 파싱)', () => {
  it('행 없음 = 전부 꺼짐 기본값', () => {
    const s = decodeVoiceSettingsRow(null);
    expect(s).toMatchObject({ inputEnabled: false, ttsEnabled: false, autoReadToggleVisible: true, rateMultiplier: 1, defaultTone: 'CALM', toneByKind: {}, nodeTones: [] });
  });

  it('깨진 JSON·모르는 값은 해당 항목만 기본값', () => {
    const s = decodeVoiceSettingsRow({
      inputEnabled: true,
      ttsEnabled: true,
      autoReadToggleVisible: false,
      rateMultiplier: 9,
      defaultTone: '??',
      toneByKind: '{broken',
      nodeTones: 'nope',
    });
    expect(s).toMatchObject({ inputEnabled: true, ttsEnabled: true, autoReadToggleVisible: false, rateMultiplier: 1.2, defaultTone: 'CALM', toneByKind: {}, nodeTones: [] });
  });

  it('toneByKind는 UNANSWERED만 읽는다(예전 초안의 BLOCKED·ERROR 무시)', () => {
    expect(decodeToneByKind('{"UNANSWERED":"BRIGHT","BLOCKED":"CALM","ERROR":"CALM"}')).toEqual({ UNANSWERED: 'BRIGHT' });
    expect(decodeToneByKind('{"UNANSWERED":"LOUD"}')).toEqual({});
    expect(decodeToneByKind('[]')).toEqual({});
  });

  it('nodeTones는 uuid·말투가 유효하고 중복이 아닌 항목만 · 최대 200', () => {
    expect(decodeNodeTones(JSON.stringify([{ nodeId: NODE_A, tone: 'CALM' }, { nodeId: NODE_A, tone: 'BRIGHT' }, { nodeId: 'x', tone: 'CALM' }, { nodeId: NODE_B, tone: 'LOUD' }, null]))).toEqual([{ nodeId: NODE_A, tone: 'CALM' }]);
    const many = Array.from({ length: 300 }, (_, i) => ({ nodeId: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, tone: 'CALM' }));
    expect(decodeNodeTones(JSON.stringify(many))).toHaveLength(200);
  });

  it('인코딩은 UNANSWERED만 직렬화한다', () => {
    const encoded = encodeVoiceSettingsInput({
      inputEnabled: true,
      ttsEnabled: true,
      autoReadToggleVisible: true,
      rateMultiplier: 1,
      defaultTone: 'CALM',
      toneByKind: { UNANSWERED: 'BRIGHT' },
      nodeTones: [{ nodeId: NODE_A, tone: 'BRIGHT' }],
    });
    expect(encoded).toEqual({ toneByKind: '{"UNANSWERED":"BRIGHT"}', nodeTones: `[{"nodeId":"${NODE_A}","tone":"BRIGHT"}]` });
  });
});
