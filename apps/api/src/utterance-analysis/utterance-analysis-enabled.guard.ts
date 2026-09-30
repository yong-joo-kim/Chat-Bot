import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiException } from '../common/api.exception';

/**
 * `UTTERANCE_ANALYSIS_ENABLED=false` → 발화 묶음 분석 API 13 핸들러 전부 `404`(설계서 §12 — 콘솔은 capability가
 * `404`면 메뉴를 숨긴다. 통합 인박스 `OMNI_INBOX_ENABLED` 선례).
 */
@Injectable()
export class UtteranceAnalysisEnabledGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(_context: ExecutionContext): boolean {
    const enabled = this.config.get<boolean>('UTTERANCE_ANALYSIS_ENABLED') ?? true;
    if (!enabled) throw new ApiException('NOT_FOUND', 404, '발화 묶음 분석 기능이 꺼져 있습니다.');
    return true;
  }
}
