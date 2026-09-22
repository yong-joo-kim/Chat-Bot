import { AugmentationGenerateInput, AugmentationProvider } from './augmentation-provider.port';

/**
 * 외부 자원·GPU 없이 전 테스트를 통과시키기 위한 결정론적 구현체(NFR-LM7, `MockEmbeddingProvider`
 * 선례). 같은 시드 → 같은 순서의 같은 후보를 반환한다. 의미를 보존하지 않으므로 실제 품질 검증에는
 * 쓰지 않는다 — 그 역할은 `validate-candidates.spec.ts`와 ml-engineer의 실측 보고서가 담당한다.
 */
export class MockAugmentationProvider implements AugmentationProvider {
  readonly providerId = 'mock' as const;
  readonly requiresNetwork = false;

  async generate(input: AugmentationGenerateInput): Promise<readonly string[]> {
    if (input.seeds.length === 0) return [];
    const out: string[] = [];
    let i = 0;
    while (out.length < input.targetCount) {
      const seed = input.seeds[i % input.seeds.length];
      out.push(`${seed} (mock 증강 ${i + 1})`);
      i += 1;
      if (i > input.targetCount * 4) break; // 안전장치 — 무한루프 방지
    }
    return out;
  }

  async healthy(): Promise<boolean> {
    return true;
  }
}
