/**
 * 피드백 기반 개선 루프(No.44) 공개 계약 상수 복제본(ADR-0038 §13.1). 위젯은 zod를 번들에 넣지
 * 않으므로 `@chat-bot/shared-types`의 값(런타임) import 대신 문자열을 여기서 직접 복제한다 —
 * 위젯 시험이 shared-types 상수와 동일한지 단언한다(시험 전용 import, `constants/handoff.ts` 선례).
 */
export const WIDGET_FEATURE_FEEDBACK_V1 = 'feedback-v1';
