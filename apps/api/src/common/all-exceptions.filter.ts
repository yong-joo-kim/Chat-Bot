import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';
import type { ApiError, ApiErrorCode } from '@chat-bot/shared-types';
import { ApiException } from './api.exception';
import type { ApiExceptionBody } from './api.exception';

/**
 * 전역 예외 필터(ADR-0003). ApiException/ZodError/Prisma 오류/기타 HttpException을
 * 단일 오류 봉투 `{ statusCode, code, message, details? }`로 변환한다.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('AllExceptionsFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const envelope = this.toErrorEnvelope(exception);

    if (envelope.code === 'INTERNAL_ERROR') {
      this.logger.error(exception instanceof Error ? exception.stack ?? exception.message : String(exception));
    }

    response.status(envelope.statusCode).json(envelope);
  }

  private toErrorEnvelope(exception: unknown): ApiError {
    if (exception instanceof ApiException) {
      const body = exception.getResponse() as ApiExceptionBody;
      return {
        statusCode: exception.getStatus(),
        code: body.code,
        message: body.message,
        details: body.details,
      };
    }

    if (exception instanceof ZodError) {
      return {
        statusCode: HttpStatus.BAD_REQUEST,
        code: 'VALIDATION_FAILED',
        message: '입력값을 확인해 주세요.',
        details: exception.issues.map((issue) => ({
          field: issue.path.length > 0 ? issue.path.join('.') : '(root)',
          message: issue.message,
        })),
      };
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === 'P2002') {
        return {
          statusCode: HttpStatus.CONFLICT,
          code: 'DUPLICATE_SLUG',
          message: '이미 사용 중인 고유 URL입니다. 다른 값을 입력해 주세요.',
        };
      }
      if (exception.code === 'P2003') {
        return {
          statusCode: HttpStatus.CONFLICT,
          code: 'CHATBOT_HAS_CHILDREN',
          message: '연결된 데이터가 있어 삭제할 수 없습니다.',
        };
      }
      if (exception.code === 'P2025') {
        return {
          statusCode: HttpStatus.NOT_FOUND,
          code: 'NOT_FOUND',
          message: '요청하신 대상을 찾을 수 없습니다.',
        };
      }
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const rawMessage =
        typeof body === 'string' ? body : ((body as { message?: unknown })?.message ?? exception.message);
      return {
        statusCode: status,
        code: this.inferCodeFromStatus(status),
        message: Array.isArray(rawMessage) ? rawMessage.join(', ') : String(rawMessage),
      };
    }

    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'INTERNAL_ERROR',
      message: '처리 중 오류가 발생했습니다.',
    };
  }

  private inferCodeFromStatus(status: number): ApiErrorCode {
    switch (status) {
      case HttpStatus.BAD_REQUEST:
        return 'VALIDATION_FAILED';
      case HttpStatus.NOT_FOUND:
        return 'NOT_FOUND';
      case HttpStatus.CONFLICT:
        return 'DUPLICATE_SLUG';
      default:
        return 'INTERNAL_ERROR';
    }
  }
}
