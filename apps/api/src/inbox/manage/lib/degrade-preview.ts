import type { ChannelType, DegradePreview, DialogOutput } from '@chat-bot/shared-types';
import { degradeForProfile, outputProfileFor } from '@chat-bot/shared-types';

/**
 * [신규 No.46] No.42 시뮬레이션 `degradePreview` 채움(R-18) — 순수 함수(DB·Nest 무의존).
 * 가상 채널의 출력 능력 프로필로 강등해 미리보기를 만든다(`channel-rich-messages-설계.md` §11.6).
 */
export function buildDegradePreview(outputs: readonly DialogOutput[], channelType: ChannelType): DegradePreview {
  const profile = outputProfileFor(channelType);
  const { outputs: degraded, changes } = degradeForProfile(outputs, profile);
  return { channelType, source: profile.source, outputs: degraded, changes };
}
