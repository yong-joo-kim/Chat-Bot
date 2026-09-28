import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiException } from '../common/api.exception';

/** [신규 No.43] `KB_SYNC_ENABLED=false` → 지식베이스 동기화 API 전부 `404`(FR-0-205 · R-20). */
@Injectable()
export class KbSyncEnabledGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(_context: ExecutionContext): boolean {
    const enabled = this.config.get<boolean>('KB_SYNC_ENABLED') ?? false;
    if (!enabled) throw new ApiException('NOT_FOUND', 404, '지식베이스 동기화 기능이 꺼져 있습니다.');
    return true;
  }
}
