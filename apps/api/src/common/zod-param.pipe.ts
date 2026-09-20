import { Injectable, PipeTransform } from '@nestjs/common';
import type { ZodSchema } from 'zod';
import { ApiException } from './api.exception';

/**
 * 라우트 파라미터 검증 파이프(quality-channel-설계.md §5.1). 예: `:type`이 `ChannelType` enum이
 * 아니면 `404`(리소스 없음)가 아니라 `400`(잘못된 요청)으로 응답해 오타 경로를 구분한다.
 */
@Injectable()
export class ZodParamPipe implements PipeTransform {
  constructor(private readonly schema: ZodSchema) {}

  transform(value: unknown): unknown {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new ApiException(
        'VALIDATION_FAILED',
        400,
        '요청 경로의 값을 확인해 주세요.',
        result.error.issues.map((issue) => ({
          field: issue.path.length > 0 ? issue.path.join('.') : '(root)',
          message: issue.message,
        })),
      );
    }
    return result.data;
  }
}
