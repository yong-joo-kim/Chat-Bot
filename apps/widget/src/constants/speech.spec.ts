import { describe, expect, it } from 'vitest';
import { WIDGET_FEATURE_SPEECH_V1 as SHARED_FEATURE } from '@chat-bot/shared-types';
import { SPEECH_LIMITS as SHARED_LIMITS } from '@chat-bot/shared-types';
import { HANDOFF_SESSION_HEADER } from './handoff';
import { SPEECH_LIMITS, SPEECH_MESSAGES, WIDGET_FEATURE_SPEECH_V1 } from './speech';

/** 위젯은 zod를 번들에 넣지 않아 계약 상수를 복제한다 — shared-types와 같은 값인지 시험 전용 import로 단언(`rich.spec.ts` 선례). */
describe('음성 공개 계약 상수 복제본', () => {
  it('speech-v1 기능 선언이 shared-types와 같다', () => {
    expect(WIDGET_FEATURE_SPEECH_V1).toBe(SHARED_FEATURE);
    expect(WIDGET_FEATURE_SPEECH_V1).toBe('speech-v1');
  });

  it('녹음 30초 · 기기 음성 대기 2초가 shared-types 한도와 같다', () => {
    expect(SPEECH_LIMITS.maxRecordSeconds).toBe(SHARED_LIMITS.maxRecordSeconds);
    expect(SPEECH_LIMITS.voicesWaitMs).toBe(SHARED_LIMITS.voicesWaitMs);
  });

  it('세션 헤더는 상담 폴링과 같은 x-cb-session-id를 재사용한다(새 헤더·CORS 변경 0)', () => {
    expect(HANDOFF_SESSION_HEADER).toBe('x-cb-session-id');
  });

  it('첫 사용 고지 문구·키는 법무 확인 전이라 만들지 않는다(빈 문자열 포함 금지 — 명세 §8.3)', () => {
    const keys = Object.keys(SPEECH_MESSAGES);
    expect(keys.filter((k) => /notice(Body|Confirm|Cancel)/i.test(k))).toEqual([]);
  });

  it('인식 대기 상한은 서버 10초보다 길고 무한 대기가 아니다(F-4 — 15초)', () => {
    expect(SPEECH_LIMITS.uploadDeadlineMs).toBe(15000);
  });
});
