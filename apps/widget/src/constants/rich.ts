/**
 * [신규 No.46] 채널별 리치 메시지(캐러셀·바로연결) 공개 계약 상수 복제본(ADR-0043 §6 ·
 * `channel-rich-messages-설계.md` §12.4). 위젯은 zod를 번들에 넣지 않으므로
 * `@chat-bot/shared-types`의 값(런타임) import 대신 문자열을 여기서 직접 복제한다 — 위젯 시험이
 * shared-types 상수와 동일한지 단언한다(RM-14, 시험 전용 import).
 */
export const WIDGET_FEATURE_RICH_V1 = 'rich-v1';
