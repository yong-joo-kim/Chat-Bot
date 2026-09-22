/**
 * No.16 예문 증강의 생성기 포트(ADR-0026 §1). 소비자(`AugmentationJobRunner` — backend-implementer가
 * 배선한다)는 이 인터페이스만 알아야 하며, 구현체가 규칙 기반인지 Gemini인지 ml-worker 로컬 생성
 * 모델인지 알지 못한다. 구현체 교체 지점은 `AugmentationProviderFactory` 1곳이다(DD-97/DD-98).
 *
 * 계약 규약 5건(ADR-0026 §1 C-1~C-5):
 * - C-1 `generate()`는 예외를 전파하지 않는다. 실패·타임아웃·스키마 불일치·회로 open은 빈 배열로 수렴한다.
 * - C-2 반환값은 검증 전 원시 후보다. 이 값이 그대로 제안이 되는 경로는 없다(검증은 이 포트의 소비자가
 *   `lib/validate-candidates.ts`로 수행한다).
 * - C-3 결정론을 요구하지 않는다(G2/G3는 본질적으로 비결정론적). 검증 규칙만 결정론적이면 된다.
 * - C-4 `healthy()`는 예외를 던지지 않는다. `false`면 팩토리가 `rule`로 저하한다.
 * - C-5 이 파일은 Nest 데코레이터·Prisma 타입에 의존하지 않는다 — `packages/llm-provider` 승격 시
 *   파일 이동만으로 끝나게 한다(DD-102, 소비자 2곳이 될 때가 승격 트리거).
 */
export type AugmentationProviderId = 'rule' | 'gemini' | 'local' | 'mock';

export interface AugmentationGenerateInput {
  /** 기존 예문 + 의도명(§10.2 시드 구성 — 최근 갱신 순 최대 20건은 호출부 책임). */
  readonly seeds: readonly string[];
  /** 검증 탈락을 감안해 상한의 최대 3배까지 요청할 수 있다(FR-L1-4). */
  readonly targetCount: number;
  readonly locale: 'ko';
}

export interface AugmentationProvider {
  readonly providerId: AugmentationProviderId;
  /** true면 호출부가 PII 마스킹·금지어·타임아웃·회로차단 경로를 강제해야 한다(FR-L1-6). */
  readonly requiresNetwork: boolean;

  /** 검증 전 원시 후보. 실패 시 빈 배열(예외 전파 금지, C-1). */
  generate(input: AugmentationGenerateInput): Promise<readonly string[]>;

  /** 예외를 던지지 않는다(C-4). */
  healthy(): Promise<boolean>;
}
