import { Global, Module } from '@nestjs/common';
import { SessionService } from '../../auth/session.service';

/**
 * 인증 인프라 전역 모듈(ADR-0015). `PermissionGuard`가 `APP_GUARD`로 전역 등록되므로,
 * 가드가 주입받는 `SessionService`도 전역으로 노출해야 한다 — 그렇지 않으면 `AppModule`의
 * 프로바이더 그래프에서 `SessionService`를 찾지 못한다. `auth`(도메인) 모듈도 이 전역
 * 공급을 그대로 재사용한다(중복 등록하지 않는다).
 */
@Global()
@Module({
  providers: [SessionService],
  exports: [SessionService],
})
export class CommonAuthModule {}
