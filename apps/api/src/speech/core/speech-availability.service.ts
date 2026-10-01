import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { VoiceServerStatus } from '@chat-bot/shared-types';
import { SPEECH_RECOGNITION_PROVIDER, isInfrastructureFailure } from '../providers/speech-recognition-provider.port';
import type { SpeechRecognitionFailureCause, SpeechRecognitionProvider } from '../providers/speech-recognition-provider.port';
import { SpeechAvailabilityCache } from './speech-availability.cache';

/** 프로세스가 아직 상태 값을 한 번도 갖지 못했을 때 설정 조회가 기다리는 최대 시간(§5.1). */
export const FIRST_AVAILABILITY_WAIT_MS = 1000;

/**
 * [신규 No.32] 서버 음성 인식 가용성(voice-ai-설계.md §5.1 · DD-123) — `SPEECH_ENABLED` + 공급자 `healthy()` 결과 캐시.
 * 성공 `SPEECH_HEALTH_CACHE_MS`(30초) · 실패 그 1/3(10초) · **만료 시 직전 값을 즉시 돌려주고 백그라운드로 1회 갱신**(동시 갱신 1개 —
 * in-flight 공유) · 프로세스 첫 조회만 최대 1초 기다린다(못 받으면 `false`). 새 백그라운드 루프 0 — 요청이 일으키는 지연 갱신뿐이다.
 */
@Injectable()
export class SpeechAvailabilityService {
  private readonly logger = new Logger('SpeechAvailability');
  private readonly cache: SpeechAvailabilityCache;
  private inFlight: Promise<boolean> | null = null;
  private warnedNotConfigured = false;
  private epoch = 0;
  private softFailures = 0;

  constructor(
    private readonly config: ConfigService,
    @Inject(SPEECH_RECOGNITION_PROVIDER) private readonly provider: SpeechRecognitionProvider,
  ) {
    this.cache = new SpeechAvailabilityCache(this.config.get<number>('SPEECH_HEALTH_CACHE_MS') ?? 30_000);
  }

  isServerEnabled(): boolean {
    return this.config.get<boolean>('SPEECH_ENABLED') ?? false;
  }

  providerId(): 'mock' | 'local' {
    return this.provider.providerId;
  }

  /** 서버 스위치 ∧ 공급자 사용 가능. 예외를 던지지 않는다. */
  async isAvailable(): Promise<boolean> {
    if (!this.isServerEnabled()) return false;
    const known = this.cache.peek();
    if (known === undefined) {
      // 프로세스 첫 조회 — 최대 1초 기다린다.
      const refreshing = this.refresh();
      return Promise.race([refreshing, new Promise<boolean>((resolve) => setTimeout(() => resolve(false), FIRST_AVAILABILITY_WAIT_MS).unref?.())]);
    }
    if (this.cache.needsRefresh()) void this.refresh();
    return known;
  }

  /** 즉시 하락 — 다음 설정 조회부터 마이크를 숨긴다(EX-VO-12). 이미 시작된 이전 갱신 결과가 되돌리지 못하게 세대를 올린다. */
  markUnavailable(): void {
    this.epoch += 1;
    this.softFailures = 0;
    this.cache.markUnavailable();
  }

  /**
   * 인식 요청의 인프라 실패 보고(M-3). `NETWORK`는 즉시 하락, `TIMEOUT`·`HTTP_5XX`는 1회로는 하락시키지 않는다(느린 한 건이 모든 챗봇의
   * 마이크를 숨기지 않도록) — 연속 `SPEECH_FAILURE_THRESHOLD`회에 이르면 하락하고, 그 전에는 `healthy()` 재확인을 요청한다.
   */
  reportFailure(cause: SpeechRecognitionFailureCause): void {
    if (!isInfrastructureFailure(cause)) return;
    if (cause === 'NETWORK') {
      this.markUnavailable();
      return;
    }
    this.softFailures += 1;
    const threshold = this.config.get<number>('SPEECH_FAILURE_THRESHOLD') ?? 3;
    if (this.softFailures >= threshold) {
      this.markUnavailable();
      return;
    }
    void this.refresh();
  }

  /** 인식 성공(OK·EMPTY) — 연속 실패 계수를 되돌린다. */
  reportSuccess(): void {
    this.softFailures = 0;
  }

  /** 관리 화면용 서버 상태(모델 이름·장치·주소는 싣지 않는다). */
  async getStatus(): Promise<VoiceServerStatus> {
    const enabled = this.isServerEnabled();
    const provider = this.provider.providerId;
    if (!enabled) return { enabled, provider, inputAvailable: false, reason: 'SERVER_DISABLED' };
    if (provider === 'local' && !this.config.get<string>('ML_WORKER_SPEECH_URL')) {
      return { enabled, provider, inputAvailable: false, reason: 'NOT_CONFIGURED' };
    }
    const available = await this.isAvailable();
    return available ? { enabled, provider, inputAvailable: true } : { enabled, provider, inputAvailable: false, reason: 'PROVIDER_UNAVAILABLE' };
  }

  private refresh(): Promise<boolean> {
    if (!this.inFlight) {
      if (this.provider.providerId === 'local' && !this.config.get<string>('ML_WORKER_SPEECH_URL') && !this.warnedNotConfigured) {
        this.warnedNotConfigured = true;
        this.logger.warn('SPEECH_PROVIDER=local인데 ML_WORKER_SPEECH_URL이 없어 음성 입력을 사용할 수 없습니다.');
      }
      const startedEpoch = this.epoch;
      const promise: Promise<boolean> = this.provider
        .healthy()
        .catch(() => false)
        .then((value) => {
          // 갱신 도중 markUnavailable()이 있었다면 그보다 오래된 결과로 되돌리지 않는다(경합 방어).
          if (startedEpoch !== this.epoch) return this.cache.peek() ?? value;
          this.cache.set(value);
          return value;
        })
        .finally(() => {
          if (this.inFlight === promise) this.inFlight = null;
        });
      this.inFlight = promise;
    }
    return this.inFlight;
  }
}
