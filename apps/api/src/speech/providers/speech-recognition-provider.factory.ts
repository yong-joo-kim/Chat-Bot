import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { LocalSpeechRecognitionProvider, UnconfiguredSpeechRecognitionProvider } from './local-speech-recognition.provider';
import { MockSpeechRecognitionProvider } from './mock-speech-recognition.provider';
import type { SpeechRecognitionProvider } from './speech-recognition-provider.port';

/**
 * [신규 No.32] STT 공급자 교체 지점 1곳(voice-ai-설계.md §2.3) — `SPEECH_PROVIDER=mock｜local`. 잘못된 값(오타)은 env 검증이 막는다(H-8).
 * 운영 ∧ 켜짐 ∧ `mock`도 env 검증이 기동 실패로 막는다(DD-135) — 여기서는 만들어 준다.
 * `local`인데 `ML_WORKER_SPEECH_URL`이 없으면 "사용 불가"로 안전하게 수렴하는 구현을 돌려준다(기동 실패 아님 — R-16).
 */
export function createSpeechRecognitionProvider(config: Pick<ConfigService, 'get'>): SpeechRecognitionProvider {
  const provider = config.get<string>('SPEECH_PROVIDER') ?? 'mock';
  if (provider === 'local') {
    const url = config.get<string>('ML_WORKER_SPEECH_URL');
    if (!url) return new UnconfiguredSpeechRecognitionProvider();
    return new LocalSpeechRecognitionProvider(url);
  }
  if (provider !== 'mock') new Logger('SpeechProviderFactory').warn('알 수 없는 SPEECH_PROVIDER 값 — mock으로 대체합니다.');
  return new MockSpeechRecognitionProvider();
}
