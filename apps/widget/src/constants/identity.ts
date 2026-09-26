/**
 * 옴니채널 통합 인박스(No.42) 공개 계약 상수 복제본(ADR-0042 §2 · `omnichannel-inbox-설계.md` §6.8).
 * 위젯은 zod를 번들에 넣지 않으므로 `@chat-bot/shared-types`의 값(런타임) import 대신 문자열을
 * 여기서 직접 복제한다 — 위젯 시험이 shared-types 상수와 동일한지 단언한다(시험 전용 import, §10.2).
 */
export const IDENTITY_TOKEN_HEADER = 'x-cb-identity';
