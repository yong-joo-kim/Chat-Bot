/**
 * [신규 No.32] STT Provider 포트(voice-ai-설계.md §7.1 · DD-119) — Nest·Prisma 무의존(파일 이동만으로 승격 가능). 이름은 채널·위젯과
 * 무관하다(No.33 멀티모달의 "음성 이해"가 그대로 재사용한다). `packages/llm-provider`로는 승격하지 않는다(LLM 소비자 아님).
 */

/** 'cloud'는 예약 자리(P-7 — 1차 미구현). 도입 시 별도 출구 클래스 + 거버넌스 모드 기본 차단(FR-VO6-3). */
export type SpeechRecognitionProviderId = 'mock' | 'local';

export interface SpeechRecognitionInput {
  readonly audio: Uint8Array;
  readonly contentType: string;
  readonly language: 'ko';
}

export type SpeechRecognitionFailureCause = 'TIMEOUT' | 'NETWORK' | 'HTTP_5XX' | 'INVALID_RESPONSE' | 'EGRESS_BLOCKED' | 'NOT_CONFIGURED';

export type SpeechRecognitionOutcome =
  | { readonly kind: 'OK'; readonly text: string; readonly durationMs: number }
  | { readonly kind: 'EMPTY'; readonly durationMs: number }
  | { readonly kind: 'INVALID_AUDIO' }
  | { readonly kind: 'TOO_LONG' }
  | { readonly kind: 'BUSY' }
  | { readonly kind: 'FAILED'; readonly cause: SpeechRecognitionFailureCause };

export interface SpeechRecognitionProvider {
  readonly providerId: SpeechRecognitionProviderId;
  /** 예외를 던지지 않는다. 오디오·글자를 로그에 남기지 않는다. */
  transcribe(input: SpeechRecognitionInput, opts: { readonly timeoutMs: number }): Promise<SpeechRecognitionOutcome>;
  /** 예외를 던지지 않는다. */
  healthy(): Promise<boolean>;
}

/** Nest 주입 토큰. */
export const SPEECH_RECOGNITION_PROVIDER = 'SPEECH_RECOGNITION_PROVIDER';

/** 인프라 실패(마이크를 숨겨야 하는 종류) 판정 — 설정·형식 문제는 가용성에 영향이 없다. */
export function isInfrastructureFailure(cause: SpeechRecognitionFailureCause): boolean {
  return cause === 'NETWORK' || cause === 'TIMEOUT' || cause === 'HTTP_5XX';
}
