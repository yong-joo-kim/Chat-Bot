import { Injectable, PipeTransform } from '@nestjs/common';
import type { ZodSchema } from 'zod';
import { ApiException } from './api.exception';

/**
 * 요청 body 검증 파이프(ADR-0003). strip 모드 — 스키마에 없는 필드는 무시한다(FR-0-2).
 * 검증 실패 시 `ApiException(VALIDATION_FAILED, 400, ..., details[])`을 던진다.
 */
@Injectable()
export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: ZodSchema) {}

  transform(value: unknown): unknown {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new ApiException(
        'VALIDATION_FAILED',
        400,
        '입력값을 확인해 주세요.',
        result.error.issues.map((issue) => ({
          field: issue.path.length > 0 ? issue.path.join('.') : '(root)',
          message: issue.message,
        })),
      );
    }
    return result.data;
  }
}
