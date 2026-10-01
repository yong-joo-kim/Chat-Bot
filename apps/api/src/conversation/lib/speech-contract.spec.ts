import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ApiErrorCode,
  EgressDataKind,
  EgressExitId,
  GovernanceMapResponseSchema,
  PendingAnswerPollResponseSchema,
  PublicChatbotConfigResponseSchema,
  PublicChatbotConfigSchema,
  PublicChatbotConfigWithProactiveSchema,
  PublicMessageResponseSchema,
  PublicSpeechTranscriptionResponseSchema,
  PublicVoiceConfigSchema,
  SPEECH_ERROR_CODES,
  SPEECH_LIMITS,
  SPEECH_SESSION_HEADER,
  HANDOFF_SESSION_HEADER,
  SpeechResponseKind,
  VoiceSettingsInputSchema,
  VoiceStatsQuerySchema,
  WIDGET_FEATURE_SPEECH_V1,
  SPEECH_PARAM_BOUNDS,
  SPEECH_TONES,
  SPEECH_TONE_PARAMS,
  computeUtteranceParams,
  isLocalKoreanVoice,
  selectLocalKoreanVoice,
  splitForSpeech,
} from '@chat-bot/shared-types';

/**
 * 음성 AI(No.32) 커밋 ① — shared-types 계약 단위 시험(voice-ai-설계.md §4). shared-types 패키지에는 자체 시험 러너가 없어
 * 기존 관례대로 `apps/api` jest에서 검증한다. 기존 스키마가 **수정되지 않았음**(응답 선택 키만 추가)도 함께 고정한다.
 */
describe('speech-voice 서브패스(zod 무의존 순수 함수)', () => {
  it('package.json exports에 ./speech-voice 서브패스가 있고 빌드 산출물이 같은 심볼을 낸다(위젯은 서브패스로만 import)', () => {
    const root = join(__dirname, '..', '..', '..', '..', '..', 'packages', 'shared-types');
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { exports: Record<string, { types: string; default: string }> };
    expect(pkg.exports['./speech-voice']).toEqual({ types: './dist/speech-voice.d.ts', default: './dist/speech-voice.js' });
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const sub = require(join(root, 'dist', 'speech-voice.js')) as { SPEECH_TONES: readonly string[]; computeUtteranceParams: unknown };
    expect([...sub.SPEECH_TONES]).toEqual([...SPEECH_TONES]);
    expect(typeof sub.computeUtteranceParams).toBe('function');
  });

  it('파일에 import 구문이 없다(VO-11) — 다른 shared-types 파일·zod 비의존', () => {
    const src = readFileSync(join(__dirname, '..', '..', '..', '..', '..', 'packages', 'shared-types', 'src', 'speech-voice.ts'), 'utf8');
    expect(/^\s*import\s/m.test(src)).toBe(false);
    expect(/\brequire\s*\(/.test(src)).toBe(false);
  });

  it('말투 닫힌 4종과 대응표(제안값)', () => {
    expect([...SPEECH_TONES]).toEqual(['CALM', 'BRIGHT', 'APOLOGETIC', 'INFORMATIVE']);
    expect(SPEECH_TONE_PARAMS.CALM).toEqual({ rate: 0.95, pitch: 0.95, volume: 1.0 });
    expect(SPEECH_TONE_PARAMS.BRIGHT).toEqual({ rate: 1.05, pitch: 1.1, volume: 1.0 });
    expect(SPEECH_TONE_PARAMS.APOLOGETIC).toEqual({ rate: 0.9, pitch: 0.9, volume: 0.9 });
    expect(SPEECH_TONE_PARAMS.INFORMATIVE).toEqual({ rate: 1.0, pitch: 1.0, volume: 1.0 });
  });

  it('computeUtteranceParams: 배율 곱 + 배율·결과 clamp + 모르는 말투 CALM', () => {
    expect(computeUtteranceParams('INFORMATIVE', 1)).toEqual({ rate: 1, pitch: 1, volume: 1 });
    expect(computeUtteranceParams('BRIGHT', 1.2).rate).toBeCloseTo(1.26, 10);
    // 배율은 0.8~1.2로 먼저 clamp — 3.0을 줘도 1.2배.
    expect(computeUtteranceParams('INFORMATIVE', 3).rate).toBeCloseTo(1.2, 10);
    expect(computeUtteranceParams('INFORMATIVE', 0.1).rate).toBeCloseTo(0.8, 10);
    // 결과 rate 상한 1.3: BRIGHT(1.05) × 1.2 = 1.26은 범위 안, 임의 표 값이 넘는 경우를 clamp가 막는다.
    for (const tone of SPEECH_TONES) {
      for (const m of [0.8, 1, 1.2, Number.NaN]) {
        const p = computeUtteranceParams(tone, m);
        expect(p.rate).toBeGreaterThanOrEqual(SPEECH_PARAM_BOUNDS.rate.min);
        expect(p.rate).toBeLessThanOrEqual(SPEECH_PARAM_BOUNDS.rate.max);
        expect(p.pitch).toBeGreaterThanOrEqual(SPEECH_PARAM_BOUNDS.pitch.min);
        expect(p.pitch).toBeLessThanOrEqual(SPEECH_PARAM_BOUNDS.pitch.max);
        expect(p.volume).toBeGreaterThanOrEqual(SPEECH_PARAM_BOUNDS.volume.min);
        expect(p.volume).toBeLessThanOrEqual(SPEECH_PARAM_BOUNDS.volume.max);
      }
    }
    expect(computeUtteranceParams('UNKNOWN_TONE', 1)).toEqual(computeUtteranceParams('CALM', 1));
  });

  it('isLocalKoreanVoice: localService가 true가 아니면(누락 포함) 전부 제외', () => {
    expect(isLocalKoreanVoice({ lang: 'ko-KR', localService: true })).toBe(true);
    expect(isLocalKoreanVoice({ lang: 'KO', localService: true })).toBe(true);
    expect(isLocalKoreanVoice({ lang: 'ko-KR', localService: false })).toBe(false);
    expect(isLocalKoreanVoice({ lang: 'ko-KR' })).toBe(false);
    expect(isLocalKoreanVoice({ lang: 'ko-KR', localService: 'true' })).toBe(false);
    expect(isLocalKoreanVoice({ lang: 'en-US', localService: true })).toBe(false);
    expect(isLocalKoreanVoice({ localService: true })).toBe(false);
  });

  it('selectLocalKoreanVoice: default 우선 → 첫 번째 → null', () => {
    const a = { lang: 'ko-KR', localService: true, name: 'a' };
    const b = { lang: 'ko-KR', localService: true, default: true, name: 'b' };
    const online = { lang: 'ko-KR', localService: false, default: true, name: 'online' };
    expect(selectLocalKoreanVoice([a, b])?.name).toBe('b');
    expect(selectLocalKoreanVoice([online, a])?.name).toBe('a');
    expect(selectLocalKoreanVoice([online])).toBeNull();
    expect(selectLocalKoreanVoice([])).toBeNull();
  });

  it('splitForSpeech: 문장 경계·줄바꿈 분리, 200자 초과는 공백/쉼표에서, 공백 없으면 강제 절단, 빈 조각 제거', () => {
    expect(splitForSpeech('안녕하세요. 반갑습니다! 잘 지내세요? 네…\n다음 줄')).toEqual(['안녕하세요.', '반갑습니다!', '잘 지내세요?', '네…', '다음 줄']);
    expect(splitForSpeech('')).toEqual([]);
    expect(splitForSpeech('  \n \n ')).toEqual([]);
    const words = Array.from({ length: 80 }, () => '가나다라').join(' '); // 길이 399
    const parts = splitForSpeech(words);
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(200);
    expect(parts.join(' ').replace(/\s+/g, ' ')).toBe(words);
    const noSpace = '가'.repeat(450);
    const forced = splitForSpeech(noSpace);
    expect(forced.map((p: string) => p.length)).toEqual([200, 200, 50]);
    expect(forced.join('')).toBe(noSpace);
  });

  it('splitForSpeech: 병적 입력도 선형 시간(1MB 마침표 없는 글자 < 1초)', () => {
    const start = Date.now();
    splitForSpeech('가 '.repeat(500_000));
    expect(Date.now() - start).toBeLessThan(10_000); // 10배 여유 — 부하 플래키 방어(선형 시간 방어 의도 유지)
  });
});

describe('speech 계약(zod)', () => {
  it('상수·세션 헤더 별칭·응답 종류 3종', () => {
    expect(SPEECH_SESSION_HEADER).toBe(HANDOFF_SESSION_HEADER);
    expect(SPEECH_SESSION_HEADER).toBe('x-cb-session-id');
    expect(WIDGET_FEATURE_SPEECH_V1).toBe('speech-v1');
    expect(SPEECH_LIMITS.maxRecordSeconds).toBe(30);
    expect(SpeechResponseKind.options).toEqual(['ANSWERED', 'UNANSWERED', 'SAFETY']);
  });

  it('오류 코드 5종이 ApiErrorCode에 있다', () => {
    for (const code of SPEECH_ERROR_CODES) expect(ApiErrorCode.safeParse(code).success).toBe(true);
    expect(SPEECH_ERROR_CODES).toHaveLength(5);
  });

  it('거버넌스: 출구 SPEECH_LOCAL · 데이터 종류 AUDIO_RAW 추가, 기존 값 유지', () => {
    // 전체 목록을 나열하지 않는다 — conversation/** 아래 파일에 다른 그룹의 출구 이름을 적으면 지식베이스 수집 그룹의 정적 검사(KB-18)가 잡는다. 개수와 마지막 항목만 단언한다.
    expect(EgressExitId.options).toHaveLength(8);
    expect(EgressExitId.options.at(-1)).toBe('SPEECH_LOCAL');
    expect(EgressDataKind.options).toContain('AUDIO_RAW');
    expect(EgressDataKind.options.slice(0, 8)).toEqual(['QUERY_RAW', 'QUESTION_MASKED', 'SEED_MASKED', 'SEED_UNMASKED', 'FORM_SLOT', 'WORKFLOW_PAYLOAD', 'CRAWL_REQUEST', 'DOCUMENT_BODY']);
    // 지도 선택 키 `speech`는 스키마 맨 끝이며 선택 — 기존 키 순서 불변.
    const keys = Object.keys(GovernanceMapResponseSchema.shape);
    expect(keys[keys.length - 1]).toBe('speech');
    expect(keys[keys.length - 2]).toBe('guardrails');
    expect(GovernanceMapResponseSchema.shape.speech.isOptional()).toBe(true);
  });

  it('메시지·폴링 응답: speech는 선택 키이며 마지막 키 — 기존 응답은 그대로 통과', () => {
    const msgKeys = Object.keys(PublicMessageResponseSchema.shape);
    expect(msgKeys.slice(-2)).toEqual(['feedback', 'speech']);
    const pollKeys = Object.keys(PendingAnswerPollResponseSchema.shape);
    expect(pollKeys).toEqual(['status', 'outputs', 'sources', 'speech']);
    expect(PendingAnswerPollResponseSchema.safeParse({ status: 'PENDING' }).success).toBe(true);
    expect(PendingAnswerPollResponseSchema.safeParse({ status: 'READY', outputs: [], speech: { text: '답변', tone: 'CALM' } }).success).toBe(true);
    expect(PendingAnswerPollResponseSchema.safeParse({ status: 'READY', speech: { text: '', tone: 'CALM' } }).success).toBe(false);
    expect(PendingAnswerPollResponseSchema.safeParse({ status: 'READY', speech: { text: '답', tone: 'LOUD' } }).success).toBe(false);
  });

  it('공개 설정: 기존 두 스키마는 수정되지 않고(voice 키 없음) 확장 스키마만 voice를 가진다', () => {
    expect(Object.keys(PublicChatbotConfigSchema.shape)).toEqual(['slug', 'name', 'avatarUrl', 'skin', 'greetingMessage', 'quickReplies', 'launcherPosition', 'showLauncher']);
    expect(Object.keys(PublicChatbotConfigWithProactiveSchema.shape)).toEqual([...Object.keys(PublicChatbotConfigSchema.shape), 'proactive']);
    expect(Object.keys(PublicChatbotConfigResponseSchema.shape)).toEqual([...Object.keys(PublicChatbotConfigWithProactiveSchema.shape), 'voice']);
    expect(Object.keys(PublicVoiceConfigSchema.shape)).toEqual(['input', 'tts', 'autoReadToggle', 'rate']);
    expect(PublicVoiceConfigSchema.safeParse({ input: true, tts: false, autoReadToggle: false, rate: 1, extra: 1 }).success).toBe(false);
  });

  it('인식 응답: empty는 true 리터럴만, 2000자 초과·알 수 없는 키 거부', () => {
    expect(PublicSpeechTranscriptionResponseSchema.safeParse({ text: '안녕', durationMs: 1200 }).success).toBe(true);
    expect(PublicSpeechTranscriptionResponseSchema.safeParse({ text: '', durationMs: 0, empty: true }).success).toBe(true);
    expect(PublicSpeechTranscriptionResponseSchema.safeParse({ text: '', durationMs: 0, empty: false }).success).toBe(false);
    expect(PublicSpeechTranscriptionResponseSchema.safeParse({ text: 'a'.repeat(2001), durationMs: 1 }).success).toBe(false);
    expect(PublicSpeechTranscriptionResponseSchema.safeParse({ text: 'a', durationMs: 1, model: 'x' }).success).toBe(false);
  });

  describe('관리 입력 VoiceSettingsInput', () => {
    const base = { inputEnabled: true, ttsEnabled: true, autoReadToggleVisible: true, rateMultiplier: 1, defaultTone: 'CALM', toneByKind: {}, nodeTones: [] };
    const nodeId = '11111111-1111-4111-8111-111111111111';

    it('정상 · 속도 0.05 배수·범위', () => {
      expect(VoiceSettingsInputSchema.safeParse(base).success).toBe(true);
      expect(VoiceSettingsInputSchema.safeParse({ ...base, rateMultiplier: 0.95 }).success).toBe(true);
      expect(VoiceSettingsInputSchema.safeParse({ ...base, rateMultiplier: 1.15 }).success).toBe(true);
      expect(VoiceSettingsInputSchema.safeParse({ ...base, rateMultiplier: 0.8 }).success).toBe(true);
      expect(VoiceSettingsInputSchema.safeParse({ ...base, rateMultiplier: 1.2 }).success).toBe(true);
      expect(VoiceSettingsInputSchema.safeParse({ ...base, rateMultiplier: 1.03 }).success).toBe(false);
      expect(VoiceSettingsInputSchema.safeParse({ ...base, rateMultiplier: 0.75 }).success).toBe(false);
      expect(VoiceSettingsInputSchema.safeParse({ ...base, rateMultiplier: 1.25 }).success).toBe(false);
    });

    it('toneByKind는 UNANSWERED만 — 예전 초안 키·ANSWERED·SAFETY는 거부(H-3)', () => {
      expect(VoiceSettingsInputSchema.safeParse({ ...base, toneByKind: { UNANSWERED: 'BRIGHT' } }).success).toBe(true);
      for (const key of ['BLOCKED', 'ERROR', 'WAITING', 'ANSWERED', 'SAFETY']) {
        expect(VoiceSettingsInputSchema.safeParse({ ...base, toneByKind: { [key]: 'CALM' } }).success).toBe(false);
      }
    });

    it('nodeTones: 중복 nodeId · 200 초과 · 알 수 없는 말투 · 부분 객체(전체 교체) 거부', () => {
      expect(VoiceSettingsInputSchema.safeParse({ ...base, nodeTones: [{ nodeId, tone: 'BRIGHT' }] }).success).toBe(true);
      expect(VoiceSettingsInputSchema.safeParse({ ...base, nodeTones: [{ nodeId, tone: 'BRIGHT' }, { nodeId, tone: 'CALM' }] }).success).toBe(false);
      expect(VoiceSettingsInputSchema.safeParse({ ...base, nodeTones: [{ nodeId, tone: 'LOUD' }] }).success).toBe(false);
      const many = Array.from({ length: 201 }, (_, i) => ({ nodeId: `11111111-1111-4111-8111-${i.toString(16).padStart(12, '0')}`, tone: 'CALM' }));
      expect(VoiceSettingsInputSchema.safeParse({ ...base, nodeTones: many }).success).toBe(false);
      const { inputEnabled: _omit, ...partial } = base;
      void _omit;
      expect(VoiceSettingsInputSchema.safeParse(partial).success).toBe(false);
      expect(VoiceSettingsInputSchema.safeParse({ ...base, unknown: 1 }).success).toBe(false);
    });
  });

  it('통계 쿼리: YYYY-MM-DD 형식', () => {
    expect(VoiceStatsQuerySchema.safeParse({}).success).toBe(true);
    expect(VoiceStatsQuerySchema.safeParse({ from: '2026-10-01', to: '2026-10-07' }).success).toBe(true);
    expect(VoiceStatsQuerySchema.safeParse({ from: '2026/10/01' }).success).toBe(false);
  });
});

/**
 * [커밋 ③ 추가] `SPEECH_LIMITS.rateMultiplier`(zod 쪽 상수)와 zod 무의존 서브패스가 따로 들고 있는 읽기 배율 범위가 같은 값인지 단언한다
 * (서브패스는 다른 shared-types 파일을 import하지 않아 상수를 복제한다 — 한쪽만 바뀌면 여기서 깨진다, voice-ai-설계.md §4.2).
 */
describe('SPEECH_LIMITS.rateMultiplier ↔ 서브패스 상수 일치', () => {
  it('computeUtteranceParams의 배율 clamp 경계 = SPEECH_LIMITS.rateMultiplier.min/max', () => {
    const { min, max } = SPEECH_LIMITS.rateMultiplier;
    for (const tone of SPEECH_TONES) {
      const row = SPEECH_TONE_PARAMS[tone];
      const clampRate = (v: number) => Math.min(SPEECH_PARAM_BOUNDS.rate.max, Math.max(SPEECH_PARAM_BOUNDS.rate.min, v));
      // 경계 안쪽 — 배율 그대로 곱한다
      expect(computeUtteranceParams(tone, min).rate).toBeCloseTo(clampRate(row.rate * min), 10);
      expect(computeUtteranceParams(tone, max).rate).toBeCloseTo(clampRate(row.rate * max), 10);
      // 경계 바깥 — 같은 경계로 clamp된다(서브패스 상수가 SPEECH_LIMITS와 다르면 어긋난다)
      expect(computeUtteranceParams(tone, min - 0.3).rate).toBeCloseTo(computeUtteranceParams(tone, min).rate, 10);
      expect(computeUtteranceParams(tone, max + 0.3).rate).toBeCloseTo(computeUtteranceParams(tone, max).rate, 10);
    }
    // 경계 바로 안쪽 값은 clamp되지 않는다 — 경계가 더 넓게/좁게 복제돼 있으면 잡는다
    expect(computeUtteranceParams('INFORMATIVE', min + 0.05).rate).toBeCloseTo(min + 0.05, 10);
    expect(computeUtteranceParams('INFORMATIVE', max - 0.05).rate).toBeCloseTo(max - 0.05, 10);
    expect(min).toBe(0.8);
    expect(max).toBe(1.2);
  });
});
