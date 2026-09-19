import { ApiError } from '../api/client';
import { MESSAGES } from '../constants/messages';

/** `details[].field` → 메시지 맵으로 변환한다(FR-0-3, AC-5-2). 필드 오류가 없으면 빈 객체. */
export function fieldErrorsFromApiError(error: unknown): Record<string, string> {
  if (error instanceof ApiError && error.details && error.details.length > 0) {
    const map: Record<string, string> = {};
    for (const d of error.details) {
      map[d.field] = d.message;
    }
    return map;
  }
  return {};
}

/** 필드에 매핑되지 않는 오류(409 등)를 폼/모달 상단 배너에 표시할 문구로 변환한다(ui-spec §2.4). */
export function bannerMessageFromApiError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.details && error.details.length > 0) return '';
    return error.message || MESSAGES.errors.generic;
  }
  return MESSAGES.errors.generic;
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}
