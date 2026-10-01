import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { PublicSpeechTranscriptionResponse } from '@chat-bot/shared-types';
import { SPEECH_LIMITS } from '@chat-bot/shared-types';
import { ApiException } from '../../common/api.exception';
import { SPEECH_RECOGNITION_PROVIDER, isInfrastructureFailure } from '../providers/speech-recognition-provider.port';
import type { SpeechRecognitionProvider } from '../providers/speech-recognition-provider.port';
import { NonBlockingSemaphore } from '../core/speech-concurrency';
import { SpeechAvailabilityService } from '../core/speech-availability.service';
import { SpeechStatWriter } from '../core/speech-stat.writer';
import type { SpeechStatColumn } from '../core/speech-stat.writer';
import { VoiceSettingsCache } from '../core/voice-settings.cache';
import { readBoundedBody } from '../lib/read-bounded-body';
import type { ReadableLike } from '../lib/read-bounded-body';
import { cleanupTranscript } from '../lib/transcript-cleanup';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `SPEECH_UNAVAILABLE` — 서버 꺼짐·없는 챗봇·비공개·입력 꺼짐·공급자 사용 불가를 **같은 응답**으로 통일한다(존재 탐지 불가 — R-8 · K-14). */
export function speechUnavailable(): ApiException {
  return new ApiException('SPEECH_UNAVAILABLE', 503, '지금은 음성 입력을 사용할 수 없습니다. 글자로 입력해 주세요.');
}

export interface SpeechRequestInput {
  readonly sessionId: string | undefined;
  readonly contentType: string | undefined;
  readonly contentLength: string | undefined;
  /** 요청 스트림 — 어떤 본문 파서도 읽지 않은 상태여야 한다(C-2). */
  readonly body: ReadableLike;
}

/**
 * [신규 No.32] 공개 인식 처리(voice-ai-설계.md §5.3 · DD-120·DD-122) — **앞 단계에서 끝날수록 비용이 작다**.
 * `PublicConversationService.transcribeSpeech()`가 ①~⑤(서버 스위치·세션 헤더·형식·길이 헤더·슬러그 판정)를 하고, 이 서비스가
 * ⑥~⑫(입력 켜짐·가용성·본문 상한 읽기·세마포어·공급자·후처리·정리)를 한다.
 *
 * 오디오 바이트는 이 호출 안의 지역 변수로만 존재하고(클로저·캐시·로그에 남기지 않는다) 응답 뒤 참조가 사라진다. 로그는 단계 코드·
 * 바이트 수·지속 시간·결과 코드뿐이다(오디오·인식 글자·세션 id·Content-Type 원문 0 — VO-4). 인식 결과에 금지어·가림은 적용하지 않는다(FR-VO2-9).
 */
@Injectable()
export class SpeechTranscriptionService {
  private readonly logger = new Logger('SpeechTranscription');
  private readonly semaphore: NonBlockingSemaphore;

  constructor(
    private readonly config: ConfigService,
    @Inject(SPEECH_RECOGNITION_PROVIDER) private readonly provider: SpeechRecognitionProvider,
    private readonly availability: SpeechAvailabilityService,
    private readonly settings: VoiceSettingsCache,
    private readonly stats: SpeechStatWriter,
  ) {
    this.semaphore = new NonBlockingSemaphore(this.config.get<number>('SPEECH_MAX_CONCURRENCY') ?? 2);
  }

  /** ① 서버 스위치. */
  isServerEnabled(): boolean {
    return this.availability.isServerEnabled();
  }

  /** ②~④ — DB 0 · 본문을 읽지 않는다. 통과하지 못하면 예외. */
  precheck(input: Pick<SpeechRequestInput, 'sessionId' | 'contentType' | 'contentLength'>): void {
    if (!input.sessionId || !UUID_PATTERN.test(input.sessionId)) {
      throw new ApiException('VALIDATION_FAILED', 400, 'x-cb-session-id 헤더는 UUID 형식이어야 합니다.');
    }
    const contentType = (input.contentType ?? '').toLowerCase().trim();
    if (!contentType.startsWith('audio/') && !contentType.startsWith('application/octet-stream')) {
      throw new ApiException('SPEECH_AUDIO_INVALID', 400, '녹음을 읽지 못했어요. 다시 말씀해 주세요.');
    }
    const maxBytes = this.maxBytes();
    if (input.contentLength !== undefined && input.contentLength !== '') {
      const declared = Number(input.contentLength);
      if (Number.isFinite(declared) && declared > maxBytes) {
        throw new ApiException('SPEECH_AUDIO_TOO_LARGE', 413, '녹음이 너무 길어요. 30초 안으로 말씀해 주세요.');
      }
    }
  }

  /** ⑥~⑫ — 챗봇 판정(⑤)이 끝난 뒤. */
  async transcribe(chatbotId: string, input: SpeechRequestInput): Promise<PublicSpeechTranscriptionResponse> {
    // ⑥ 챗봇 음성 입력 켜짐(캐시)
    const setting = await this.settings.get(chatbotId);
    if (!setting?.inputEnabled) throw speechUnavailable();
    // ⑦ 공급자 가용성(캐시)
    if (!(await this.availability.isAvailable())) throw speechUnavailable();

    const startedAt = Date.now();
    // ⑧ 본문 상한 읽기(바이트 · 15초) — 초과 즉시 읽기 중단.
    // 세마포어(⑨)보다 먼저 읽는 것은 의도다(설계 §5.3 NFR-VOP4 · DD-122): 느린 업로드(슬로로리스)가 슬롯을 점유하지 않게 하고 BUSY를
    // 본문 수신 직후 즉시 거절한다. 그 대가로 동시 요청 수 × 최대 1MB가 읽기 동안 메모리에 있을 수 있다(IP·세션 버킷과 15초 상한이 제한).
    const read = await readBoundedBody(input.body, this.maxBytes(), SPEECH_LIMITS.uploadDeadlineMs);
    if (read.kind === 'TOO_LARGE') {
      this.finish(chatbotId, 'invalid', 'BODY', 'TOO_LARGE', undefined, startedAt);
      throw new ApiException('SPEECH_AUDIO_TOO_LARGE', 413, '녹음이 너무 길어요. 30초 안으로 말씀해 주세요.');
    }
    if (read.kind !== 'OK') {
      this.finish(chatbotId, 'invalid', 'BODY', read.kind, undefined, startedAt);
      throw new ApiException('SPEECH_AUDIO_INVALID', 400, '녹음을 읽지 못했어요. 다시 말씀해 주세요.');
    }

    // ⑨ API 세마포어(비대기) — 초과 즉시 거절
    const release = this.semaphore.tryAcquire();
    if (!release) {
      this.finish(chatbotId, 'busy', 'SEMAPHORE', 'BUSY', read.body.length, startedAt);
      throw new ApiException('SPEECH_BUSY', 503, '음성 인식이 잠시 붐벼요. 글자로 입력하거나 잠시 뒤 다시 시도해 주세요.');
    }

    try {
      // ⑩ 공급자 호출(예외를 던지지 않는다)
      const outcome = await this.provider.transcribe(
        { audio: read.body, contentType: (input.contentType ?? 'application/octet-stream').toLowerCase(), language: 'ko' },
        { timeoutMs: this.config.get<number>('SPEECH_STT_TIMEOUT_MS') ?? 10_000 },
      );

      if (outcome.kind === 'OK' || outcome.kind === 'EMPTY') this.availability.reportSuccess();
      switch (outcome.kind) {
        case 'OK': {
          // ⑪ 후처리(정리 → 반복 → 상투 → 한글 숫자 → 상한) — 빈 글자면 말소리 없음
          const cleaned = cleanupTranscript(outcome.text).text;
          if (cleaned.length === 0) {
            this.finish(chatbotId, 'empty', 'PROVIDER', 'EMPTY', read.body.length, startedAt);
            return { text: '', durationMs: outcome.durationMs, empty: true };
          }
          this.finish(chatbotId, 'ok', 'PROVIDER', 'OK', read.body.length, startedAt);
          return { text: cleaned, durationMs: outcome.durationMs };
        }
        case 'EMPTY':
          this.finish(chatbotId, 'empty', 'PROVIDER', 'EMPTY', read.body.length, startedAt);
          return { text: '', durationMs: outcome.durationMs, empty: true };
        case 'INVALID_AUDIO':
          this.finish(chatbotId, 'invalid', 'PROVIDER', 'INVALID_AUDIO', read.body.length, startedAt);
          throw new ApiException('SPEECH_AUDIO_INVALID', 400, '녹음을 읽지 못했어요. 다시 말씀해 주세요.');
        case 'TOO_LONG':
          this.finish(chatbotId, 'invalid', 'PROVIDER', 'TOO_LONG', read.body.length, startedAt);
          throw new ApiException('SPEECH_AUDIO_TOO_LARGE', 413, '녹음이 너무 길어요. 30초 안으로 말씀해 주세요.');
        case 'BUSY':
          this.finish(chatbotId, 'busy', 'PROVIDER', 'BUSY', read.body.length, startedAt);
          throw new ApiException('SPEECH_BUSY', 503, '음성 인식이 잠시 붐벼요. 글자로 입력하거나 잠시 뒤 다시 시도해 주세요.');
        case 'FAILED': {
          if (outcome.cause === 'NOT_CONFIGURED') throw speechUnavailable();
          if (isInfrastructureFailure(outcome.cause)) this.availability.reportFailure(outcome.cause);
          this.finish(chatbotId, 'failed', 'PROVIDER', outcome.cause, read.body.length, startedAt);
          throw new ApiException('SPEECH_FAILED', 502, '음성을 글자로 바꾸지 못했어요. 글자로 입력해 주세요.');
        }
      }
    } finally {
      // ⑫ 세마포어 반환 — 오디오 버퍼는 지역 변수라 함수가 끝나면 참조가 사라진다.
      release();
    }
  }

  private maxBytes(): number {
    return this.config.get<number>('SPEECH_MAX_AUDIO_BYTES') ?? 1_048_576;
  }

  /** 집계(응답 대기 0) + 단계·바이트 수·지속 시간·결과 코드만 로그. */
  private finish(chatbotId: string, column: SpeechStatColumn, stage: string, code: string, byteCount: number | undefined, startedAt: number): void {
    this.stats.recordDetached(chatbotId, column);
    this.logger.log(`speech stage=${stage} result=${code}${byteCount === undefined ? '' : ` size=${byteCount}`} ms=${Date.now() - startedAt}`);
  }
}
