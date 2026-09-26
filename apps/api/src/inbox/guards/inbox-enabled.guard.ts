import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiException } from '../../common/api.exception';

/** [신규 No.42] `OMNI_INBOX_ENABLED=false` → 인박스·설정 API 전부 `404`(EX-OC-18). */
@Injectable()
export class InboxEnabledGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(_context: ExecutionContext): boolean {
    const enabled = this.config.get<boolean>('OMNI_INBOX_ENABLED') ?? true;
    if (!enabled) throw new ApiException('NOT_FOUND', 404, '통합 인박스 기능이 꺼져 있습니다.');
    return true;
  }
}
