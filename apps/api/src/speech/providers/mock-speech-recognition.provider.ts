import type { SpeechRecognitionInput, SpeechRecognitionOutcome, SpeechRecognitionProvider } from './speech-recognition-provider.port';

const MOCK_PREFIX = 'MOCK:';
const MOCK_INVALID = 'MOCK-INVALID';
const MOCK_BUSY = 'MOCK-BUSY';
export const MOCK_DEFAULT_TEXT = '모의 인식 결과입니다';

/**
 * [신규 No.32] 결정적 모의 공급자(voice-ai-설계.md §7.3) — CI·시연용, 네트워크 0.
 * ① 바이트가 ASCII `MOCK:`로 시작 → 나머지를 UTF-8 글자로 반환(시험 주입) ② 전부 0 바이트 → `EMPTY` ③ `MOCK-INVALID` → `INVALID_AUDIO`
 * ④ `MOCK-BUSY` → `BUSY` ⑤ 그 밖 → 고정 글자. `durationMs`는 바이트 수 기반 결정값.
 * **운영(`NODE_ENV=production`)에서 `SPEECH_ENABLED=true`이면 기동 자체가 실패한다**(DD-135 — `config/env.validation.ts`).
 */
export class MockSpeechRecognitionProvider implements SpeechRecognitionProvider {
  readonly providerId = 'mock' as const;

  async transcribe(input: SpeechRecognitionInput): Promise<SpeechRecognitionOutcome> {
    const audio = input.audio;
    const durationMs = Math.max(1, Math.round(audio.length / 16));
    if (audio.length === 0) return { kind: 'INVALID_AUDIO' };
    if (startsWithAscii(audio, MOCK_INVALID)) return { kind: 'INVALID_AUDIO' };
    if (startsWithAscii(audio, MOCK_BUSY)) return { kind: 'BUSY' };
    if (startsWithAscii(audio, MOCK_PREFIX)) {
      return { kind: 'OK', text: Buffer.from(audio.subarray(MOCK_PREFIX.length)).toString('utf8'), durationMs };
    }
    if (audio.every((b) => b === 0)) return { kind: 'EMPTY', durationMs };
    return { kind: 'OK', text: MOCK_DEFAULT_TEXT, durationMs };
  }

  async healthy(): Promise<boolean> {
    return true;
  }
}

function startsWithAscii(bytes: Uint8Array, prefix: string): boolean {
  if (bytes.length < prefix.length) return false;
  for (let i = 0; i < prefix.length; i += 1) if (bytes[i] !== prefix.charCodeAt(i)) return false;
  return true;
}
