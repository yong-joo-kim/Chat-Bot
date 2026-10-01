import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WIDGET_FEATURE_SPEECH_V1 } from '@chat-bot/shared-types';
import type { DialogOutput, PublicSpeechReply, PublicVoiceConfig, SpeechReplyPlan, SpeechResponseKind } from '@chat-bot/shared-types';
import { SpeechAvailabilityService } from '../core/speech-availability.service';
import { VoiceSettingsCache } from '../core/voice-settings.cache';
import { buildSpeechText } from '../lib/speech-text';
import { buildSpeechReplyPlan, decideSpeechTone } from '../lib/speech-tone';

/**
 * [신규 No.32] 공개 설정 `voice` 조립 · 응답 `speech` 계획(plan)·조립(build)(voice-ai-설계.md §5.1·§5.2·§6.4 — export 유일 중 하나).
 *
 * **공급자·세마포어·집계 기록기를 주입받지 않는다**(VO-5) — 대화 턴 DI 그래프에 인식 호출 경로가 없다. 가용성은 상태 캐시 서비스만 본다.
 * 모델 호출 0 · DB 조회 0(설정은 전역 색인 캐시) · 문자열 처리만. 응답 `speech` 글자는 어디에도 저장하지 않는다(VO-8).
 */
@Injectable()
export class VoicePublicService {
  constructor(
    private readonly config: ConfigService,
    private readonly settings: VoiceSettingsCache,
    private readonly availability: SpeechAvailabilityService,
  ) {}

  /**
   * 공개 설정 `voice` 키 — `{ input, tts, autoReadToggle, rate }`(이 순서가 계약). 입력·듣기 모두 거짓이면 `undefined`(키 없음).
   * 색인에 없는 챗봇(음성 설정 없음)은 추가 쿼리 0 · 공급자 상태 확인 0.
   */
  async buildConfigVoice(chatbotId: string): Promise<PublicVoiceConfig | undefined> {
    const setting = await this.settings.get(chatbotId);
    if (!setting) return undefined;
    const input = setting.inputEnabled && this.isServerEnabled() ? await this.availability.isAvailable() : false;
    const tts = setting.ttsEnabled;
    if (!input && !tts) return undefined;
    return { input, tts, autoReadToggle: setting.ttsEnabled && setting.autoReadToggleVisible, rate: setting.rateMultiplier };
  }

  /**
   * 대화 턴 계획 — 요청 `features`에 `speech-v1`이 있고 챗봇 듣기가 켜졌을 때만 만든다. 호출자(`sendMessage`)는 선언이 없으면
   * 이 메서드를 부르지 않는다(동기 `undefined` — 캐시 조회조차 0).
   */
  async plan(chatbotId: string, features: readonly string[] | undefined): Promise<SpeechReplyPlan | undefined> {
    if (!features || !features.includes(WIDGET_FEATURE_SPEECH_V1)) return undefined;
    const setting = await this.settings.get(chatbotId);
    if (!setting || !setting.ttsEnabled) return undefined;
    return buildSpeechReplyPlan(setting);
  }

  /** 계획 + 응답 종류 + **봇 출력** → `speech`. 읽기용 글자가 비면 `undefined`(키 없음). 판정은 반환 지점으로만 한다(문구 비교 0). */
  build(plan: SpeechReplyPlan, kind: SpeechResponseKind, botOutputs: readonly DialogOutput[], matchedNodeId?: string | null): PublicSpeechReply | undefined {
    const text = buildSpeechText(botOutputs);
    if (text.length === 0) return undefined;
    return { text, tone: decideSpeechTone(plan, kind, matchedNodeId) };
  }

  private isServerEnabled(): boolean {
    return this.config.get<boolean>('SPEECH_ENABLED') ?? false;
  }
}
