import { z } from 'zod';

/** No.11 다양한 채널 제공 */
export const ChannelType = z.enum([
  'WEB',
  'MOBILE',
  'KAKAOTALK',
  'LINE',
  'FACEBOOK',
  'NAVER_TALKTALK',
  'APP',
  'KIOSK',
]);
export type ChannelType = z.infer<typeof ChannelType>;

export const ChannelSchema = z.object({
  id: z.string().uuid(),
  chatbotId: z.string().uuid(),
  type: ChannelType,
  enabled: z.boolean().default(true),
  /** 채널별 연동 설정(Webhook URL, 토큰 등) — Phase1은 자유 JSON */
  config: z.record(z.unknown()).default({}),
  createdAt: z.coerce.date(),
});
export type Channel = z.infer<typeof ChannelSchema>;

export const CreateChannelSchema = ChannelSchema.pick({ chatbotId: true, type: true, config: true }).partial({
  config: true,
});
export type CreateChannelDto = z.infer<typeof CreateChannelSchema>;
