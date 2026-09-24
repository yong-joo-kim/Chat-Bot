import { HttpException } from '@nestjs/common';
import type { ApiErrorCode } from '@chat-bot/shared-types';

export interface ApiExceptionDetail {
  field: string;
  message: string;
  /** 대상이 여러 챗봇에 걸치는 전역 자원 참조 목록에서만 채운다(`ApiErrorDetailSchema`와 동일). */
  chatbotId?: string;
}

export interface ApiExceptionBody {
  code: ApiErrorCode;
  message: string;
  details?: ApiExceptionDetail[];
}

/**
 * 도메인 서비스/파이프가 던지는 단일 예외 타입(ADR-0003).
 * `AllExceptionsFilter`가 이를 `{ statusCode, code, message, details? }` 오류 봉투로 직렬화한다.
 */
export class ApiException extends HttpException {
  constructor(code: ApiErrorCode, status: number, message: string, details?: ApiExceptionDetail[]) {
    super({ code, message, details } satisfies ApiExceptionBody, status);
  }
}
