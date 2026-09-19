import { ChatbotSkin, ChatbotSkinSchema, DEFAULT_CHATBOT_SKIN, UpdateChatbotSkinDto } from '@chat-bot/shared-types';

export interface ParseSkinResult {
  skin: ChatbotSkin;
  fellBackToDefault: boolean;
  warning?: string;
}

/**
 * DB에 저장된 JSON 문자열 → 객체 파싱(FR-4-8). 손상되었거나 스키마와 맞지 않으면
 * 기본 스킨으로 폴백한다(EX-4-1). 호출자(mapper/service)가 폴백 발생 시 경고 로그를 남긴다.
 */
export function parseSkin(raw: string): ParseSkinResult {
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return { skin: { ...DEFAULT_CHATBOT_SKIN }, fellBackToDefault: true, warning: 'skin JSON 파싱 실패' };
  }

  const result = ChatbotSkinSchema.safeParse(obj);
  if (!result.success) {
    return {
      skin: { ...DEFAULT_CHATBOT_SKIN },
      fellBackToDefault: true,
      warning: `skin 스키마 검증 실패: ${result.error.issues.map((i) => i.message).join(', ')}`,
    };
  }
  return { skin: result.data, fellBackToDefault: false };
}

export function serializeSkin(skin: ChatbotSkin): string {
  return JSON.stringify(skin);
}

/**
 * 스킨 부분 수정 병합(FR-4-8, D-10).
 * logoUrl: null이면 키 삭제, undefined면 유지, 값이면 교체. 나머지 필드는 값 존재 시에만 덮어쓴다.
 */
export function mergeSkin(current: ChatbotSkin, patch: UpdateChatbotSkinDto): ChatbotSkin {
  const next: ChatbotSkin = { ...current };

  if (patch.primaryColor !== undefined) next.primaryColor = patch.primaryColor;
  if (patch.headerTitle !== undefined) next.headerTitle = patch.headerTitle;

  if (patch.logoUrl === null) {
    delete next.logoUrl;
  } else if (patch.logoUrl !== undefined) {
    next.logoUrl = patch.logoUrl;
  }

  return next;
}
