import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { ChangePasswordDto, ChangePasswordSchema, CurrentUser, LoginRequestDto, LoginRequestSchema, LoginResponse } from '@chat-bot/shared-types';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { Public, PasswordChangeExempt } from '../common/auth/public.decorator';
import { CurrentUser as CurrentUserDecorator } from '../common/auth/current-user.decorator';
import { buildClearCookie, buildSetCookie, parseCookieHeader, SESSION_COOKIE_NAME } from '../common/auth/lib/cookie';
import type { SessionUser } from '../common/auth/session-context';
import { AuthService } from './auth.service';
import { LoginRateLimitGuard } from './login-rate-limit.guard';

/**
 * 인증 엔드포인트(No.12-c, ADR-0014). 쿠키를 만지는 유일한 컨트롤러다(§2.1 계층 규약 —
 * `AuthService`는 토큰 문자열만 반환하고 쿠키 설정은 이 컨트롤러가 담당한다).
 */
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly config: ConfigService,
  ) {}

  private cookieSecure(): boolean {
    return this.config.get<boolean>('AUTH_COOKIE_SECURE') ?? false;
  }

  private cookieMaxAgeSec(): number {
    const hours = this.config.get<number>('SESSION_ABSOLUTE_TIMEOUT_HOURS') ?? 12;
    return hours * 3600;
  }

  @Post('login')
  @Public()
  @UseGuards(LoginRateLimitGuard)
  @HttpCode(HttpStatus.OK)
  async login(
    @Body(new ZodValidationPipe(LoginRequestSchema)) dto: LoginRequestDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoginResponse> {
    const result = await this.authService.login(dto, { ip: req.ip, userAgent: req.headers['user-agent'] });
    res.setHeader(
      'Set-Cookie',
      buildSetCookie(result.token, { maxAgeSec: this.cookieMaxAgeSec(), secure: this.cookieSecure() }),
    );
    return { status: 'OK', user: result.user };
  }

  /** 멱등(FR-12-8) — 만료된 세션으로 호출해도 204다. `@Public()`(DD-45, ADR-0015 §4). */
  @Post('logout')
  @Public()
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    const cookies = parseCookieHeader(req.headers.cookie);
    await this.authService.logout(cookies[SESSION_COOKIE_NAME]);
    res.setHeader('Set-Cookie', buildClearCookie(this.cookieSecure()));
  }

  @Get('me')
  @PasswordChangeExempt()
  me(@CurrentUserDecorator() user: SessionUser): CurrentUser {
    return this.authService.getMe(user);
  }

  @Post('password')
  @PasswordChangeExempt()
  @HttpCode(HttpStatus.NO_CONTENT)
  async changePassword(
    @CurrentUserDecorator() user: SessionUser,
    @Body(new ZodValidationPipe(ChangePasswordSchema)) dto: ChangePasswordDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const newToken = await this.authService.changePassword(user, dto);
    res.setHeader('Set-Cookie', buildSetCookie(newToken, { maxAgeSec: this.cookieMaxAgeSec(), secure: this.cookieSecure() }));
  }
}
