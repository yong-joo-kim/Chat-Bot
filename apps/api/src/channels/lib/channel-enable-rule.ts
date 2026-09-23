import { CHANNEL_IMPLEMENTATION } from '@chat-bot/shared-types';
import type { ChannelType } from '@chat-bot/shared-types';
import { ApiException } from '../../common/api.exception';

/**
 * [신규 2026-09-23 No.28] `ChannelsService.upsert()`의 "활성화는 IMPLEMENTED 채널만" 판정을
 * 순수 함수로 뽑았다(scheduled-deploy-설계.md §9.4 근거표, FR-D5-1 — 판정 복제 금지). `upsert()`는
 * 이 함수를 호출하도록 1줄만 바뀌며 동작은 불변이다. `ChatbotPublicationService`(§5.4)가
 * `SET_WEB_CHANNEL`·`PUBLISH`의 채널 활성화에서 같은 함수를 호출한다.
 */
export function assertChannelEnableAllowed(type: ChannelType, enabled: boolean): void {
  if (enabled === true && CHANNEL_IMPLEMENTATION[type] !== 'IMPLEMENTED') {
    throw new ApiException('CHANNEL_NOT_IMPLEMENTED', 409, '이 채널은 아직 연동을 제공하지 않습니다. 설정만 미리 저장할 수 있습니다.');
  }
}
