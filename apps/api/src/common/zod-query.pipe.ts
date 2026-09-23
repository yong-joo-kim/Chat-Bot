import { Injectable, PipeTransform } from '@nestjs/common';
import type { ZodSchema } from 'zod';
import { ApiException } from './api.exception';

/**
 * 쿼리스트링 검증 파이프(ADR-0003). 숫자 변환은 스키마의 `z.coerce`, 불리언은 `queryBoolean()`(`z.coerce.boolean()` 금지 — "false"→true)이 담당한다.
 * 복수 선택 필터는 콤마 구분 단일 파라미터(`csvEnumArray`)로 전처리된다.
 */
@Injectable()
export class ZodQueryPipe implements PipeTransform {
  constructor(private readonly schema: ZodSchema) {}

  transform(value: unknown): unknown {
    const result = this.schema.safeParse(value ?? {});
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
