import { ArgumentsHost, Catch, ExceptionFilter, PayloadTooLargeException } from '@nestjs/common';
import type { Response } from 'express';
import { IMPORT_LIMITS } from '@chat-bot/shared-types';

/**
 * multer `limits.fileSize` 초과(413)를 설계서 §7.1의 `400 IMPORT_TOO_LARGE`로 바꾼다 — 기본 필터는 413을 일반
 * 오류로 내려 화면이 원인 문구를 만들 수 없다. 오류 봉투는 `AllExceptionsFilter`와 같은 모양이다(ADR-0003).
 */
@Catch(PayloadTooLargeException)
export class UtteranceUploadTooLargeFilter implements ExceptionFilter {
  catch(_exception: PayloadTooLargeException, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    response.status(400).json({
      statusCode: 400,
      code: 'IMPORT_TOO_LARGE',
      message: `파일이 너무 큽니다. 최대 ${IMPORT_LIMITS.maxFileBytes / (1024 * 1024)}MB까지 올릴 수 있습니다. 나눠서 올려 주세요.`,
    });
  }
}
