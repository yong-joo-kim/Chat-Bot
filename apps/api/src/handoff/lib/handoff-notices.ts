import type { HandoffEndReason } from '@chat-bot/shared-types';

/**
 * 종료 SYSTEM 메시지 문구·종류 판정(순수 함수, §8.1). 상담원이 응답하기 전에 끝난 상담
 * (`NOT_DELIVERED`·`AGENT_NO_REPLY`)은 실패 안내(`failNotice`)를, 그 밖은 종료 안내(`endNotice`)를 쓴다.
 */
export function resolveEndSystemMessage(
  reason: HandoffEndReason,
  settings: { endNotice: string; failNotice: string },
): { systemKind: 'ENDED' | 'FAILED'; text: string } {
  if (reason === 'NOT_DELIVERED' || reason === 'AGENT_NO_REPLY') {
    return { systemKind: 'FAILED', text: settings.failNotice };
  }
  return { systemKind: 'ENDED', text: settings.endNotice };
}
