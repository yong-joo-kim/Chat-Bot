import { generateRuleVariantsForSeeds, SynonymDict } from '../lib/rule-variants';
import { AugmentationGenerateInput, AugmentationProvider } from './augmentation-provider.port';

/** `Keyword.synonyms`·`HomonymDictionary.word`를 조립한 사전을 돌려주는 콜백. DB 접근은 이 콜백
 * 안(호출부 — backend-implementer가 배선하는 Job runner)에서만 일어난다. 이 provider 자체는
 * Nest·Prisma를 알지 못한다. */
export type SynonymDictSupplier = () => Promise<SynonymDict> | SynonymDict;

/**
 * G1 — 모든 폴백의 종착점(ADR-0026 §2). GPU 0·외부 호출 0·의존성 0으로 항상 동작해야 한다.
 * `generate()`는 예외를 던지지 않는다 — 사전 조달이 실패해도 빈 사전으로 계속 진행한다(C-1).
 */
export class RuleBasedAugmentationProvider implements AugmentationProvider {
  readonly providerId = 'rule' as const;
  readonly requiresNetwork = false;

  constructor(private readonly getSynonyms: SynonymDictSupplier = () => new Map()) {}

  async generate(input: AugmentationGenerateInput): Promise<readonly string[]> {
    let synonyms: SynonymDict;
    try {
      synonyms = await this.getSynonyms();
    } catch {
      synonyms = new Map();
    }
    try {
      return generateRuleVariantsForSeeds(input.seeds, { synonyms }, input.targetCount);
    } catch {
      return [];
    }
  }

  async healthy(): Promise<boolean> {
    return true;
  }
}
