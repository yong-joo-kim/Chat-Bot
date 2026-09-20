import { z } from 'zod';

/**
 * No.11 다양한 채널 제공 — `quality-channel-설계.md` §4.3, ADR-0011 근거.
 * J-2 결정: WEB만 종단 구현(`IMPLEMENTED`), 나머지 7종은 설정만 가능(`CONFIG_ONLY`).
 */
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

export const ChannelImplementation = z.enum(['IMPLEMENTED', 'CONFIG_ONLY']);
export type ChannelImplementation = z.infer<typeof ChannelImplementation>;

/** 채널별 구현 등급(FR-11-3). 서버가 응답에 실어 내려주는 값의 원천이며, 프런트는 이 상수가 아니라 응답값을 렌더한다(DD-29). */
export const CHANNEL_IMPLEMENTATION: Record<ChannelType, ChannelImplementation> = {
  WEB: 'IMPLEMENTED',
  MOBILE: 'CONFIG_ONLY',
  KAKAOTALK: 'CONFIG_ONLY',
  LINE: 'CONFIG_ONLY',
  FACEBOOK: 'CONFIG_ONLY',
  NAVER_TALKTALK: 'CONFIG_ONLY',
  APP: 'CONFIG_ONLY',
  KIOSK: 'CONFIG_ONLY',
};

/** 화면/안내 문구용 한국어 레이블과 정렬 순서(FR-11-2, FR-0-23). WEB이 항상 첫 번째다. */
export const CHANNEL_TYPE_ORDER: ChannelType[] = [
  'WEB',
  'MOBILE',
  'KAKAOTALK',
  'LINE',
  'FACEBOOK',
  'NAVER_TALKTALK',
  'APP',
  'KIOSK',
];

export const CHANNEL_TYPE_LABELS: Record<ChannelType, string> = {
  WEB: '웹',
  MOBILE: '모바일 앱',
  KAKAOTALK: '카카오톡',
  LINE: '라인',
  FACEBOOK: '페이스북',
  NAVER_TALKTALK: '네이버 톡톡',
  APP: '자체 앱',
  KIOSK: '키오스크',
};

/** 출처 형식: 스킴 + 호스트(+포트). 경로/와일드카드/javascript: 금지(EX-11-4). */
export const AllowedOriginSchema = z
  .string()
  .trim()
  .regex(/^https?:\/\/[a-z0-9.-]+(:\d{1,5})?$/i, '스킴과 도메인 형식(예: https://www.example.co.kr)으로 입력해 주세요.');

export const WebChannelConfigSchema = z
  .object({
    allowedOrigins: z.array(AllowedOriginSchema).max(20).default([]),
    greetingMessage: z.string().max(200).optional(),
    quickReplies: z.array(z.string().trim().min(1).max(20)).max(5).default([]),
    launcherPosition: z.enum(['RIGHT', 'LEFT']).default('RIGHT'),
    showLauncher: z.boolean().default(true),
  })
  .strict(); // ← 미정의 필드는 통과시키지 않는다(EX-11-2) — 자격증명 필드를 보내면 400으로 정직하게 알린다.
export type WebChannelConfig = z.infer<typeof WebChannelConfigSchema>;

export const PlaceholderChannelConfigSchema = z.object({ note: z.string().max(500).optional() }).strict();
export type PlaceholderChannelConfig = z.infer<typeof PlaceholderChannelConfigSchema>;

/** type을 아는 쪽에서 선택한다. 자격증명 필드는 어느 분기에도 존재하지 않는다(NFR-S7). */
export function channelConfigSchemaFor(type: ChannelType): typeof WebChannelConfigSchema | typeof PlaceholderChannelConfigSchema {
  return type === 'WEB' ? WebChannelConfigSchema : PlaceholderChannelConfigSchema;
}

export const ChannelConfigSchema = z.union([WebChannelConfigSchema, PlaceholderChannelConfigSchema]);
export type ChannelConfig = z.infer<typeof ChannelConfigSchema>;

/** 채널 목록/단건 응답(FR-11-2). 레코드 유무와 무관하게 8종 전부를 반환한다. */
export const ChannelListItemSchema = z.object({
  type: ChannelType,
  label: z.string(),
  implementation: ChannelImplementation,
  configured: z.boolean(),
  enabled: z.boolean(),
  config: ChannelConfigSchema,
  updatedAt: z.coerce.date().nullable(),
});
export type ChannelListItem = z.infer<typeof ChannelListItemSchema>;

/** `PATCH /channels/:type` 요청 — upsert. config는 전체 교체(부분 병합 금지). */
export const UpdateChannelSchema = z.object({
  enabled: z.boolean().optional(),
  config: z.unknown().optional(),
});
export type UpdateChannelDto = z.infer<typeof UpdateChannelSchema>;
