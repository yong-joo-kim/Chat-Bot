import type { UpdateAnswerSettingDto } from '@chat-bot/shared-types';

export type ValidationFailure = { kind: 'INVALID_THRESHOLD' | 'VALIDATION_FAILED'; field: string; message: string };

/**
 * `ChatbotAnswerSetting` 필드 간 상호 제약 검증(ADR-0021 §6.2, AC-N1-18) — 순수 함수. 임계값
 * 순서/범위 위반은 `INVALID_THRESHOLD`로, 그 외(스코프 제약)는 `VALIDATION_FAILED`로 구분한다.
 * 위반이 없으면 `null`을 반환한다.
 */
export function validateAnswerSettingShape(dto: UpdateAnswerSettingDto): ValidationFailure | null {
  if (!(dto.lowThreshold < dto.acceptThreshold)) {
    return { kind: 'INVALID_THRESHOLD', field: 'lowThreshold', message: 'lowThreshold는 acceptThreshold보다 작아야 합니다.' };
  }
  if (dto.marginThreshold < 0 || dto.marginThreshold > 0.5) {
    return { kind: 'INVALID_THRESHOLD', field: 'marginThreshold', message: 'marginThreshold는 0.0~0.5 사이여야 합니다.' };
  }
  if (dto.ragSubcategory && !dto.ragCategory) {
    return { kind: 'VALIDATION_FAILED', field: 'ragSubcategory', message: 'subcategory를 지정하려면 category가 먼저 필요합니다.' };
  }
  if (dto.ragEnabled && !dto.ragCompany) {
    return { kind: 'VALIDATION_FAILED', field: 'ragCompany', message: 'RAG를 사용하려면 회사(company) 스코프가 필요합니다.' };
  }
  return null;
}
