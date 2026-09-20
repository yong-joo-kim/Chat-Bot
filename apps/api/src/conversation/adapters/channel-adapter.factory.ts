import { Injectable } from '@nestjs/common';
import type { ChannelType } from '@chat-bot/shared-types';
import { ApiException } from '../../common/api.exception';
import { WebChannelAdapter } from './web-channel.adapter';
import type { ChannelAdapter } from './channel-adapter';

/**
 * 채널 타입 분기가 존재하는 유일한 파일이다(NFR-M2, §8.2). 새 채널을 추가할 때 이 팩토리의
 * 분기 1줄 + 어댑터 파일 1개만 늘어나야 한다 — 대화 처리 코어는 한 줄도 바뀌지 않는다.
 */
@Injectable()
export class ChannelAdapterFactory {
  constructor(private readonly webAdapter: WebChannelAdapter) {}

  getAdapter(type: ChannelType): ChannelAdapter {
    if (type === 'WEB') return this.webAdapter;
    throw new ApiException(
      'CHANNEL_NOT_IMPLEMENTED',
      409,
      '이 채널은 아직 연동을 제공하지 않습니다. 설정만 미리 저장할 수 있습니다.',
    );
  }
}
