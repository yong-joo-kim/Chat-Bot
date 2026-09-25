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
        return this.mapUniqueConflict(exception);
      }
      if (exception.code === 'P2003') {
        return this.mapForeignKeyConflict(exception);
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

  /**
   * `P2002`(유일성 위반)를 대상 인덱스명으로 구분해 매핑한다(ADR-0006 §결과).
   * 사전 검사(UX)를 통과했지만 경합으로 DB 제약에 걸린 경우의 최종 방어선이다(EX-R-7과 대칭).
   */
  private mapUniqueConflict(exception: Prisma.PrismaClientKnownRequestError): ApiError {
    const target = this.extractMetaText(exception, 'target');
    if (target.includes('questionNormalized')) {
      return { statusCode: HttpStatus.CONFLICT, code: 'DUPLICATE_FAQ', message: '이미 같은 질문이 등록되어 있습니다.' };
    }
    if (target.includes('nameNormalized') || target.includes('wordNormalized')) {
      return {
        statusCode: HttpStatus.CONFLICT,
        code: 'DUPLICATE_NAME',
        message: '이미 같은 이름이 있습니다. 다른 이름을 입력해 주세요.',
      };
    }
    if (target.includes('email')) {
      return {
        statusCode: HttpStatus.CONFLICT,
        code: 'DUPLICATE_EMAIL',
        message: '이미 등록된 이메일입니다.',
      };
    }
    // 운영 예약 배포(No.28) 그룹 추가(code-review M1 방어선) — 부분 유니크 인덱스 2개(schema.prisma
    // 하단 경고 주석 참고)는 `deploy-schedule.service.ts`/`engine/deploy-schedule.repository.ts`가
    // 항상 먼저 잡아 도메인 코드로 변환하므로 이 분기까지 오면 안 되지만, 혹시 새 호출부가 놓쳐도
    // "이미 사용 중인 고유 URL"(DUPLICATE_SLUG)이라는 오분류 메시지가 노출되지 않게 한다.
    if (target.includes('deploy_schedules')) {
      return {
        statusCode: HttpStatus.CONFLICT,
        code: 'DEPLOY_SCHEDULE_INVALID_TIME',
        message: '같은 챗봇의 활성 예약과 시각이 겹칩니다. 다른 시각을 입력해 주세요.',
      };
    }
    return {
      statusCode: HttpStatus.CONFLICT,
      code: 'DUPLICATE_SLUG',
      message: '이미 사용 중인 고유 URL입니다. 다른 값을 입력해 주세요.',
    };
  }

  /** `P2003`(참조 무결성 위반)을 FK 컬럼명으로 구분해 매핑한다(ADR-0005 §근거, EX-R-7). */
  private mapForeignKeyConflict(exception: Prisma.PrismaClientKnownRequestError): ApiError {
    const field = this.extractMetaText(exception, 'field_name');
    const mapping: Array<[string, ApiErrorCode, string]> = [
      ['intentId', 'INTENT_IN_USE', '이 의도를 사용하는 대화 노드가 있습니다. 먼저 조건을 정리해 주세요.'],
      ['keywordId', 'KEYWORD_IN_USE', '이 키워드를 사용하는 대화 노드가 있습니다. 먼저 조건을 정리해 주세요.'],
      ['contextVariableId', 'CONTEXT_IN_USE', '이 컨텍스트를 사용하는 대화 노드가 있습니다. 먼저 조건을 정리해 주세요.'],
      // [신규 No.22] 사전 확인과 삭제 사이 경합으로 자산이 들어온 경우의 최종 방어선(§5.4).
      ['topicId', 'TOPIC_NOT_EMPTY', '토픽에 속한 자산이 있어 삭제할 수 없습니다.'],
    ];
    for (const [needle, code, message] of mapping) {
      if (field.includes(needle)) return { statusCode: HttpStatus.CONFLICT, code, message };
    }
    return {
      statusCode: HttpStatus.CONFLICT,
      code: 'CHATBOT_HAS_CHILDREN',
      message: '연결된 데이터가 있어 삭제할 수 없습니다.',
    };
  }

  private extractMetaText(exception: Prisma.PrismaClientKnownRequestError, key: string): string {
    const meta = exception.meta as Record<string, unknown> | undefined;
    const value = meta?.[key];
    if (Array.isArray(value)) return value.join(',');
    return typeof value === 'string' ? value : '';
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
