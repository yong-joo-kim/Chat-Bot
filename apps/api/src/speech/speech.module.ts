import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatbotsModule } from '../chatbots/chatbots.module';
import { VoiceController } from './voice.controller';
import { VoiceSettingsService } from './admin/voice-settings.service';
import { VoiceOverviewService } from './admin/voice-overview.service';
import { VoiceSettingsCache } from './core/voice-settings.cache';
import { SpeechAvailabilityService } from './core/speech-availability.service';
import { SpeechStatWriter } from './core/speech-stat.writer';
import { SPEECH_RECOGNITION_PROVIDER } from './providers/speech-recognition-provider.port';
import { createSpeechRecognitionProvider } from './providers/speech-recognition-provider.factory';
import { SpeechTranscriptionService } from './public/speech-transcription.service';
import { VoicePublicService } from './reply/voice-public.service';

/**
 * [신규 No.32] 음성 AI — 관리 컨트롤러 1(3 핸들러) + 공개 인식 서비스·응답 조립 서비스(export 2개 뿐, DD-134 · ADR-0052).
 * `speech`는 `conversation`을 import하지 않는다(슬러그 판정은 `conversation`이 하고 챗봇 행을 넘긴다 — 순환 없음).
 * 새 백그라운드 루프 0 — 상태 갱신은 요청이 일으키는 지연 갱신뿐이다(`jest.isolate-env.js` 변경 0).
 */
@Module({
  imports: [ChatbotsModule],
  controllers: [VoiceController],
  providers: [
    VoiceSettingsService,
    VoiceOverviewService,
    VoiceSettingsCache,
    SpeechAvailabilityService,
    SpeechStatWriter,
    { provide: SPEECH_RECOGNITION_PROVIDER, useFactory: (config: ConfigService) => createSpeechRecognitionProvider(config), inject: [ConfigService] },
    SpeechTranscriptionService,
    VoicePublicService,
  ],
  exports: [SpeechTranscriptionService, VoicePublicService],
})
export class SpeechModule {}
