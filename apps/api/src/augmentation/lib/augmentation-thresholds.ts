/**
 * 증강 자기 검증 임계값의 `modelId → 기본값` 매핑(DD-94, FR-L1-13). ADR-0021 §5(1단계 의미 매칭
 * 임계값 매핑)와 동일한 규약 — 코드 상수 1곳이며 챗봇별 설정으로 노출하지 않는다(조정하면 검증이
 * 무력화된다).
 *
 * `acceptThreshold`(③ 타 의도 충돌 판정 기준)는 이 매핑에 포함하지 않는다 — 그 값은 챗봇별
 * `ChatbotAnswerSetting.acceptThreshold`를 그대로 재사용한다(설계서 §10.3 "챗봇 설정값").
 *
 * ── 실측 근거(2026-09-22, ml-worker `.venv` + 캐시된 `nlpai-lab/KURE-v1`, CPU) ──
 * 시드가 **완전한 문장**(예문)일 때 진짜 패러프레이즈 코사인은 0.65~0.90(표본 9건, 평균 0.80),
 * 문장부호만 다른 사실상 동일 문장은 0.98~1.00(표본 3건), 의미가 다른 문장은 대개 0.33~0.60이되
 * 인접 의도(예: "환불" vs "반품") 쌍은 0.82까지 올라간다 — 이 값은 `acceptThreshold`(챗봇 설정,
 * 기본 0.90)보다 낮아 "충돌 경고"가 아닌 통과로 처리되는 경계 사례이므로 운영 중 재검토 대상이다.
 * 이 결과는 요구사항 문서의 잠정값(0.75/0.97/0.95)이 KURE-v1에서 안전한 구간(진짜 패러프레이즈
 * 대역과 사실상 동일 대역 사이에 공백이 있다)에 있음을 뒷받침한다.
 *
 * ⚠ 알려진 한계(실측으로 확인): 시드가 **의도명 1단어뿐**(예문 0건, §10.2)이면 같은 의미라도
 * 문장 길이 차이 때문에 코사인이 0.45~0.60까지 떨어져 `keepMin`(0.75) 미만으로 `SEMANTIC_DRIFT`
 * 오탈락이 발생할 수 있다. 요구사항 FR-L1-2/§10.2가 이미 "예문 0건 시드는 품질이 낮을 수 있음"을
 * 안내하도록 요구하므로 이 한계는 화면 안내로 흡수한다 — 임계값을 낮추면 진짜 의미 이탈 후보까지
 * 통과시키게 되어 더 위험하다.
 */

export interface AugmentationValidationThresholds {
  readonly keepMin: number;
  readonly keepMax: number;
  readonly noveltyMax: number;
}

export const DEFAULT_AUGMENTATION_THRESHOLDS: AugmentationValidationThresholds = {
  keepMin: 0.75,
  keepMax: 0.97,
  noveltyMax: 0.95,
};

/** `modelId`(DD-69 규약 문자열) → 검증 임계값. 매핑에 없는 모델은 기본값으로 수렴한다. */
const THRESHOLD_BY_MODEL_ID: ReadonlyMap<string, AugmentationValidationThresholds> = new Map([
  ['nlpai-lab/KURE-v1@main|noprefix|l2', DEFAULT_AUGMENTATION_THRESHOLDS],
]);

export function resolveAugmentationThresholds(modelId: string): AugmentationValidationThresholds {
  return THRESHOLD_BY_MODEL_ID.get(modelId) ?? DEFAULT_AUGMENTATION_THRESHOLDS;
}
