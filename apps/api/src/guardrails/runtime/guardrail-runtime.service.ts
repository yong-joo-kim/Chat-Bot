import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { maskPii } from '@chat-bot/pii-mask';
import type { RagPreview } from '@chat-bot/shared-types';
import { BannedWordFilterService } from '../../banned-words/banned-word-filter.service';
import { compileProfile } from '../lib/compile-profile';
import type { CompiledProfile } from '../lib/compile-profile';
import { evaluateRules } from '../lib/evaluate-rules';
import { applyGovernanceFloor } from '../lib/exit-pii';
import { judgeOutbound } from '../lib/judge-outbound';
import type { ExitSettingInput } from '../lib/judge-outbound';
import { buildInboundEvents, buildOutboundEvents } from '../lib/verdict-events';
import type { InboundVerdict, OutboundVerdict } from '../lib/types';
import { GuardrailEventWriter } from './guardrail-event.writer';
import { GuardrailProfileCache } from './guardrail-profile.cache';
import type { ExitSetting } from './guardrail-profile.cache';
import { GuardrailProfileLoader } from './guardrail-profile.loader';

/** 판정 없음 — 호출부는 변경하지 않는다(공유 상수, 규칙 없는 챗봇의 입구는 할당 0). */
const PASS_INBOUND: InboundVerdict = { action: 'PASS', hits: [] };

function errorName(e: unknown): string {
  return e instanceof Error ? e.name : 'unknown';
}

/**
 * 가드레일 런타임 판정(설계서 §4.4·§5·§6) — **예외를 던지지 않는다**(입구 오류 = `PASS` + 경고 로그 ·
 * 출구 오류 = §6.3 수렴 표). 규칙이 없는 챗봇의 입구 판정은 메모리 조회 1회 — 쿼리 0 · 정규화 0.
 * 모델·임베딩·외부 호출 0(AG-3). 이 서비스는 `GuardrailRuntimeModule`의 유일한 export다.
 */
@Injectable()
export class GuardrailRuntimeService {
  private readonly logger = new Logger('GuardrailRuntime');
  private readonly cache: GuardrailProfileCache;
  /** 규칙 쓰기마다 증가 — 진행 중이던 적재 결과가 무효화 뒤에 캐시를 오염시키지 않게 한다. */
  private rulesGeneration = 0;
  private settingGeneration = 0;
  private indexInFlight: Promise<Set<string>> | null = null;
  private readonly profileInFlight = new Map<string, Promise<CompiledProfile>>();
  private readonly settingInFlight = new Map<string, Promise<ExitSetting>>();

  constructor(
    private readonly loader: GuardrailProfileLoader,
    private readonly events: GuardrailEventWriter,
    private readonly config: ConfigService,
    private readonly bannedWords: BannedWordFilterService,
  ) {
    this.cache = new GuardrailProfileCache(this.config.get<number>('GUARDRAIL_CACHE_TTL_MS') ?? 60_000);
  }

  /** 서버 긴급 스위치(`GUARDRAILS_ENABLED`) — 꺼져 있으면 판정 3종이 즉시 `PASS`(도입 전 동작). */
  isServerEnabled(): boolean {
    return this.config.get<boolean>('GUARDRAILS_ENABLED') ?? true;
  }

  isGovernanceOn(): boolean {
    return this.config.get<string>('DATA_GOVERNANCE_MODE') === 'ON';
  }

  /* ── 입구 ── */

  async evaluateInbound(chatbotId: string, text: string): Promise<InboundVerdict> {
    if (!this.isServerEnabled()) return PASS_INBOUND;
    try {
      const has = await this.hasRules(chatbotId);
      if (has === null) {
        this.logger.warn(`색인을 확보하지 못해 입구 판정을 건너뜁니다: chatbotId=${chatbotId}`);
        return PASS_INBOUND;
      }
      if (!has) return PASS_INBOUND;

      const profile = await this.getProfile(chatbotId);
      if (!profile) {
        this.logger.warn(`규칙 프로필을 확보하지 못해 입구 판정을 건너뜁니다: chatbotId=${chatbotId}`);
        return PASS_INBOUND;
      }
      const result = evaluateRules(text, profile.inbound);
      if (result.action === 'REPLACE' && !result.replacementText) {
        // 저장 검증이 막는 상태 — 대체 문구가 없으면 흐름을 바꾸지 않는다(기록만).
        return { action: 'MONITOR', hits: result.hits, decisiveRuleId: result.decisiveRuleId };
      }
      return { action: result.action, hits: result.hits, replacementText: result.replacementText, decisiveRuleId: result.decisiveRuleId };
    } catch (e) {
      this.logger.warn(`입구 판정 중 오류로 통과시킵니다: chatbotId=${chatbotId} error=${errorName(e)}`);
      return PASS_INBOUND;
    }
  }

  /* ── 출구 ── */

  async evaluateOutbound(chatbotId: string, text: string): Promise<OutboundVerdict> {
    const passThrough: OutboundVerdict = { kind: 'PASS', text, hits: [], piiCounts: {} };
    if (!this.isServerEnabled()) return passThrough;

    const profile = await this.getProfile(chatbotId);
    const setting = await this.getSetting(chatbotId);
    if (!profile || !setting) {
      this.logger.warn(`규칙·설정을 확보하지 못해 안내 문구로 수렴합니다: chatbotId=${chatbotId}`);
      return { kind: 'FALLBACK', text, fallbackReason: 'PROFILE_UNAVAILABLE', errorCode: 'PROFILE_UNAVAILABLE', hits: [], piiCounts: {} };
    }

    try {
      return this.judge(text, profile, setting, this.isGovernanceOn());
    } catch (e) {
      const name = errorName(e);
      this.logger.warn(`출구 판정 중 오류가 발생했습니다: chatbotId=${chatbotId} error=${name}`);
      // §6.3 — 대체 규칙이 있거나 개인정보 가림이 켜진 챗봇은 원답을 내보내지 않고 폴백한다.
      const guarded = profile.hasOutboundReplace || applyGovernanceFloor(setting.kinds, this.isGovernanceOn()).length > 0;
      if (guarded) return { kind: 'FALLBACK', text, fallbackReason: 'ERROR', errorCode: name, hits: [], piiCounts: {} };
      return { ...passThrough, errorCode: name };
    }
  }

  /** 시험에서 판정기 예외를 주입할 수 있는 좁은 이음새. */
  protected judge(text: string, profile: CompiledProfile, setting: ExitSettingInput, governanceOn: boolean): OutboundVerdict {
    return judgeOutbound(text, profile, setting, governanceOn);
  }

  /**
   * 시뮬레이터 "RAG 답 미리보기" 표시 조립(설계서 §9) — 이미 계산된 출구 판정을 사용자에게 나갈 문구로 바꾼다
   * (출구 금지어 적용 후). 원답은 **저장 마스킹본**으로만 싣는다(R-4 — 원문 개인정보 비노출). 이벤트 0.
   */
  async toRagPreview(verdict: OutboundVerdict, answerText: string, fallbackText: string): Promise<RagPreview> {
    const mask = (value: string) => this.bannedWords.maskPlainText(value);
    const replaced = verdict.kind === 'REPLACE';
    const fellBack = verdict.kind === 'FALLBACK';
    const shown = replaced ? (verdict.replacementText ?? fallbackText) : fellBack ? fallbackText : verdict.text;
    return {
      outcome: verdict.kind === 'REPLACE' ? 'REPLACED' : verdict.kind,
      finalText: await mask(shown),
      ...(replaced || fellBack ? { originalMasked: maskPii(await mask(answerText)).maskedText } : {}),
      ruleNames: verdict.hits.map((h) => h.ruleName),
      piiCounts: verdict.piiCounts,
    };
  }

  /* ── 이벤트 ── */

  /**
   * 판정 이벤트 적재 — fire-and-forget(응답 대기 0). 호출 파일은 `public-conversation.service.ts`·
   * `rag-answer.service.ts`뿐이다(GR-6, 시뮬레이터 0). `ragEligible`은 입구 `NO_RAG`의 효과 판정용.
   */
  recordEvents(input: { chatbotId: string; messageId: string; verdict: InboundVerdict | OutboundVerdict; ragEligible?: boolean }): void {
    try {
      const ctx = { chatbotId: input.chatbotId, messageId: input.messageId, now: new Date() };
      const rows = 'kind' in input.verdict ? buildOutboundEvents(ctx, input.verdict) : buildInboundEvents(ctx, input.verdict, input.ragEligible ?? false);
      this.events.write(rows);
    } catch (e) {
      this.logger.warn(`이벤트를 만들지 못했습니다: chatbotId=${input.chatbotId} error=${errorName(e)}`);
    }
  }

  /* ── 무효화 ── */

  /** 저장 직후 호출(TTL을 기다리지 않고 같은 인스턴스에 즉시 반영 — AC-AG2-5). */
  invalidate(chatbotId: string, scope: 'RULES' | 'SETTINGS' | 'ALL' = 'ALL'): void {
    if (scope !== 'SETTINGS') {
      this.rulesGeneration += 1;
      this.cache.invalidateRules(chatbotId);
      this.profileInFlight.delete(chatbotId);
      this.indexInFlight = null;
    }
    if (scope !== 'RULES') {
      this.settingGeneration += 1;
      this.cache.invalidateSetting(chatbotId);
      this.settingInFlight.delete(chatbotId);
    }
  }

  /* ── 캐시 조회(stale-on-error) ── */

  /** `null` = 색인을 한 번도 확보하지 못했다(콜드 + DB 장애). */
  private async hasRules(chatbotId: string): Promise<boolean | null> {
    const cached = this.cache.getIndex();
    if (cached?.fresh) return cached.value.has(chatbotId);
    try {
      const set = await this.loadIndexShared();
      return set.has(chatbotId);
    } catch (e) {
      this.logger.warn(`전역 색인 적재에 실패했습니다: error=${errorName(e)}`);
      if (cached) {
        this.cache.deferIndexRetry();
        return cached.value.has(chatbotId);
      }
      return null;
    }
  }

  private loadIndexShared(): Promise<Set<string>> {
    if (!this.indexInFlight) {
      const generation = this.rulesGeneration;
      const promise = this.loader
        .loadIndex()
        .then((set) => {
          if (generation === this.rulesGeneration) this.cache.setIndex(set);
          return set;
        })
        .finally(() => {
          if (this.indexInFlight === promise) this.indexInFlight = null;
        });
      this.indexInFlight = promise;
    }
    return this.indexInFlight;
  }

  private async getProfile(chatbotId: string): Promise<CompiledProfile | null> {
    const cached = this.cache.getProfile(chatbotId);
    if (cached?.fresh) return cached.value;
    try {
      return await this.loadProfileShared(chatbotId);
    } catch (e) {
      this.logger.warn(`규칙 프로필 적재에 실패했습니다: chatbotId=${chatbotId} error=${errorName(e)}`);
      if (cached) {
        this.cache.deferProfileRetry(chatbotId);
        return cached.value;
      }
      return null;
    }
  }

  private loadProfileShared(chatbotId: string): Promise<CompiledProfile> {
    let promise = this.profileInFlight.get(chatbotId);
    if (!promise) {
      const generation = this.rulesGeneration;
      promise = this.loader
        .loadRules(chatbotId)
        .then((rules) => {
          const profile = compileProfile(rules);
          if (generation === this.rulesGeneration) this.cache.setProfile(chatbotId, profile);
          return profile;
        })
        .finally(() => {
          if (this.profileInFlight.get(chatbotId) === promise) this.profileInFlight.delete(chatbotId);
        });
      this.profileInFlight.set(chatbotId, promise);
    }
    return promise;
  }

  private async getSetting(chatbotId: string): Promise<ExitSetting | null> {
    const cached = this.cache.getSetting(chatbotId);
    if (cached?.fresh) return cached.value;
    try {
      return await this.loadSettingShared(chatbotId);
    } catch (e) {
      this.logger.warn(`출구 설정 적재에 실패했습니다: chatbotId=${chatbotId} error=${errorName(e)}`);
      if (cached) {
        this.cache.deferSettingRetry(chatbotId);
        return cached.value;
      }
      return null;
    }
  }

  private loadSettingShared(chatbotId: string): Promise<ExitSetting> {
    let promise = this.settingInFlight.get(chatbotId);
    if (!promise) {
      const generation = this.settingGeneration;
      promise = this.loader
        .loadSetting(chatbotId)
        .then((setting) => {
          if (generation === this.settingGeneration) this.cache.setSetting(chatbotId, setting);
          return setting;
        })
        .finally(() => {
          if (this.settingInFlight.get(chatbotId) === promise) this.settingInFlight.delete(chatbotId);
        });
      this.settingInFlight.set(chatbotId, promise);
    }
    return promise;
  }
}
