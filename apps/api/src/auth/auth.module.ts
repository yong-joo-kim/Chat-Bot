import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { LoginRateLimitGuard } from './login-rate-limit.guard';

/**
 * 로그인/로그아웃/비밀번호 변경 도메인 모듈. `SessionService`는 `common/auth`(`@Global()`)가
 * 이미 공급하므로 여기서 다시 선언하지 않는다(중복 provider 등록 방지).
 */
@Module({
  controllers: [AuthController],
  providers: [AuthService, LoginRateLimitGuard],
})
export class AuthModule {}
