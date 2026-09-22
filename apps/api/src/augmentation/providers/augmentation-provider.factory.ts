import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AugmentationProvider, AugmentationProviderId } from './augmentation-provider.port';
import { RuleBasedAugmentationProvider, SynonymDictSupplier } from './rule-augmentation.provider';
import { GeminiAugmentationProvider } from './gemini-augmentation.provider';
import { LocalAugmentationProvider } from './local-augmentation.provider';
import { MockAugmentationProvider } from './mock-augmentation.provider';

export type AugmentationDegradeReason = 'API_KEY_MISSING' | 'BASE_URL_MISSING' | 'UNHEALTHY';

export interface AugmentationCapability {
  readonly providerId: AugmentationProviderId;
  readonly configuredProviderId: AugmentationProviderId;
  readonly degraded: boolean;
  readonly degradeReason?: AugmentationDegradeReason;
  readonly requiresNetwork: boolean;
}

export interface AugmentationProviderDeps {
  /** `Keyword.synonyms`·`HomonymDictionary.word` 조립 콜백(`rule` 전용). DB 접근은 호출부 책임. */
  readonly getSynonyms?: SynonymDictSupplier;
  /** 시드 송신 전 검사할 금지어(`gemini` 전용). */
  readonly bannedWords?: readonly string[];
}

/**
 * `AugmentationProvider` 구현체 교체 지점 **1곳**(ADR-0026 §1, DD-97/98). 환경변수로 선택된 1종만
 * 인스턴스화한다 — `AUGMENTATION_PROVIDER=rule` 구성에서는 `gemini`/`local` 클래스가 **아예
 * 생성되지 않는다**(AC-L1-14, "인스턴스화 자체가 일어나지 않는다").
 *
 * 모든 실패는 G1(`rule`)로 수렴한다(ADR-0026 §2) — 이 팩토리는 예외를 던지지 않는다.
 */
@Injectable()
export class AugmentationProviderFactory {
  private readonly logger = new Logger('AugmentationProviderFactory');

  constructor(private readonly config: ConfigService) {}

  private get configuredProviderId(): AugmentationProviderId {
    const raw = (this.config.get<string>('AUGMENTATION_PROVIDER') ?? 'rule').trim().toLowerCase();
    if (raw === 'gemini' || raw === 'local' || raw === 'mock') return raw;
    return 'rule';
  }

  private buildRule(deps?: AugmentationProviderDeps): RuleBasedAugmentationProvider {
    return new RuleBasedAugmentationProvider(deps?.getSynonyms);
  }

  /**
   * 선택된 Provider 1종을 반환한다. 요청마다 새 인스턴스를 만들지 강제하지 않는다 — Gemini/Local은
   * 회로차단 상태를 내부에 들고 있어야 하므로, 배선하는 쪽(backend-implementer)이 싱글턴으로
   * 재사용하는 것을 권장한다(이 팩토리는 그 재사용 방식을 강제하지 않는다 — 매 호출 순수 함수형 결정).
   */
  getProvider(deps?: AugmentationProviderDeps): AugmentationProvider {
    const configured = this.configuredProviderId;

    if (configured === 'mock') return new MockAugmentationProvider();

    if (configured === 'gemini') {
      const apiKey = this.config.get<string>('AUGMENTATION_GEMINI_API_KEY');
      if (!apiKey) {
        this.logger.warn('AUGMENTATION_PROVIDER=gemini인데 AUGMENTATION_GEMINI_API_KEY가 없습니다 — rule로 저하합니다.');
        return this.buildRule(deps);
      }
      return new GeminiAugmentationProvider({
        apiKey,
        model: this.config.get<string>('AUGMENTATION_GEMINI_MODEL'),
        baseUrl: this.config.get<string>('AUGMENTATION_GEMINI_BASE_URL'),
        timeoutMs: this.config.get<number>('AUGMENTATION_TIMEOUT_MS'),
        bannedWords: deps?.bannedWords,
      });
    }

    if (configured === 'local') {
      const baseUrl = this.config.get<string>('AUGMENTATION_LOCAL_BASE_URL');
      if (!baseUrl) {
        this.logger.warn('AUGMENTATION_PROVIDER=local인데 AUGMENTATION_LOCAL_BASE_URL이 없습니다 — rule로 저하합니다.');
        return this.buildRule(deps);
      }
      return new LocalAugmentationProvider({
        baseUrl,
        timeoutMs: this.config.get<number>('AUGMENTATION_TIMEOUT_MS'),
      });
    }

    return this.buildRule(deps);
  }

  /**
   * 실제 사용될 Provider와 설정값의 괴리를 보고한다(§4.3, `GET .../augmentations/capability`의
   * 데이터 소스). "조용한 저하"를 만들지 않기 위함이다 — 화면이 원인을 말할 수 있어야 한다.
   */
  async getCapability(deps?: AugmentationProviderDeps): Promise<AugmentationCapability> {
    const configuredProviderId = this.configuredProviderId;
    const provider = this.getProvider(deps);

    if (provider.providerId === configuredProviderId) {
      const healthy = await provider.healthy();
      if (!healthy && provider.providerId !== 'rule') {
        return {
          providerId: 'rule',
          configuredProviderId,
          degraded: true,
          degradeReason: 'UNHEALTHY',
          requiresNetwork: false,
        };
      }
      return { providerId: provider.providerId, configuredProviderId, degraded: false, requiresNetwork: provider.requiresNetwork };
    }

    const degradeReason: AugmentationDegradeReason =
      configuredProviderId === 'gemini' ? 'API_KEY_MISSING' : 'BASE_URL_MISSING';
    return {
      providerId: provider.providerId,
      configuredProviderId,
      degraded: true,
      degradeReason,
      requiresNetwork: provider.requiresNetwork,
    };
  }
}
