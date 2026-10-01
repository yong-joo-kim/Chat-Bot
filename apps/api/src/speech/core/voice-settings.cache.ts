import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { decodeVoiceSettingsRow } from '../lib/voice-settings-codec';
import type { VoiceSettings } from '../lib/voice-settings-codec';

/** 적재 실패 뒤 직전 값을 유지하면서 다시 시도하기까지의 지연(No.36 가드레일 캐시와 같은 값). */
export const VOICE_RETRY_AFTER_FAILURE_MS = 5_000;

/**
 * [신규 No.32] 음성 설정 캐시(voice-ai-설계.md §2.3 · DD-129 · C-14). **전역 색인**: 입력∨듣기가 켜진 챗봇의 설정을 한 번에 적재해
 * (TTL — `SPEECH_SETTINGS_CACHE_TTL_MS`, 기본 60초) 메모리에 둔다 → 음성을 안 쓰는 챗봇은 색인에 없어 **추가 쿼리 0**(적중 시).
 * (설계는 "색인 + 챗봇별 캐시" 2단이나, 켜진 행의 값 자체가 작아 색인이 설정을 직접 들고 있게 해 한 번의 쿼리로 둘을 겸한다 — I-1.)
 * 저장 직후 `invalidate()`로 같은 인스턴스는 즉시 반영하고, 다른 인스턴스는 TTL 안에 반영된다. 적재 실패는 직전 값을 유지(stale-on-error)한다.
 * 모델·외부 호출 0.
 */
@Injectable()
export class VoiceSettingsCache {
  private readonly logger = new Logger('VoiceSettingsCache');
  private index: { value: Map<string, VoiceSettings>; loadedAt: number } | null = null;
  private inFlight: Promise<Map<string, VoiceSettings>> | null = null;
  /** 저장마다 증가 — 진행 중이던 적재 결과가 무효화 뒤에 캐시를 오염시키지 않게 한다. */
  private generation = 0;
  private readonly ttlMs: number;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.ttlMs = config.get<number>('SPEECH_SETTINGS_CACHE_TTL_MS') ?? 60_000;
  }

  /** 입력∨듣기가 켜진 챗봇의 설정. 색인에 없으면(꺼짐·행 없음) `null`. 색인을 한 번도 확보하지 못하면 `null`(안전 측 — 꺼짐으로 본다). */
  async get(chatbotId: string): Promise<VoiceSettings | null> {
    const cached = this.index;
    if (cached && Date.now() - cached.loadedAt < this.ttlMs) return cached.value.get(chatbotId) ?? null;
    try {
      const map = await this.loadShared();
      return map.get(chatbotId) ?? null;
    } catch {
      this.logger.warn('음성 설정 색인 적재에 실패했습니다.');
      if (cached) {
        cached.loadedAt = Date.now() - Math.max(0, this.ttlMs - VOICE_RETRY_AFTER_FAILURE_MS);
        return cached.value.get(chatbotId) ?? null;
      }
      return null;
    }
  }

  /** 저장 직후 — 같은 인스턴스는 즉시 새 값을 읽는다. */
  invalidate(): void {
    this.generation += 1;
    this.index = null;
    this.inFlight = null;
  }

  private loadShared(): Promise<Map<string, VoiceSettings>> {
    if (!this.inFlight) {
      const generation = this.generation;
      const promise: Promise<Map<string, VoiceSettings>> = this.load()
        .then((map) => {
          if (generation === this.generation) this.index = { value: map, loadedAt: Date.now() };
          return map;
        })
        .finally(() => {
          if (this.inFlight === promise) this.inFlight = null;
        });
      this.inFlight = promise;
    }
    return this.inFlight;
  }

  private async load(): Promise<Map<string, VoiceSettings>> {
    const rows = await this.prisma.chatbotVoiceSetting.findMany({ where: { OR: [{ inputEnabled: true }, { ttsEnabled: true }] } });
    return new Map(rows.map((r) => [r.chatbotId, decodeVoiceSettingsRow(r)] as const));
  }
}
