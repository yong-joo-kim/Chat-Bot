import type { KbScopeWarning } from '@chat-bot/shared-types';

/**
 * [신규 No.43 — 3차 보완 · 설계서 :1078] 저장(등록·수정) 응답의 스코프 경고 판정(순수). 실제 DB
 * 조회(다른 소스가 같은 3단 스코프를 쓰는지 · 이 스코프를 읽는 챗봇이 있는지)는 호출부
 * (`kb-sources.service.ts`)가 하고, 이 함수는 그 결과(불리언 2개)만으로 경고 목록을 만든다.
 */
export interface ScopeWarningInput {
  sharedByOtherSource: boolean;
  readByAnyChatbot: boolean;
}

export function computeScopeWarnings(input: ScopeWarningInput): KbScopeWarning[] {
  const warnings: KbScopeWarning[] = [];
  if (input.sharedByOtherSource) warnings.push({ code: 'SCOPE_SHARED_WITH_OTHER_SOURCE' });
  if (!input.readByAnyChatbot) warnings.push({ code: 'SCOPE_NOT_READ_BY_ANY_CHATBOT' });
  return warnings;
}
