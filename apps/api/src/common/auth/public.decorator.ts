import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * 인증 없이 호출 가능함을 명시하는 opt-out 마커(FR-0-24, FR-12-20, DD-45).
 * 정확히 5곳에만 부착한다 — `GET /api/health`, 공개 대화 2곳(`GET config`/`POST messages`),
 * `POST /auth/login`, `POST /auth/logout`. **핸들러 단위로만 부착**하며 클래스 단위로는 부착하지 않는다
 * (부착 단위가 섞이면 개수 고정 테스트가 의미를 잃는다 — ADR-0015 §4).
 */
export const Public = (): MethodDecorator => SetMetadata(IS_PUBLIC_KEY, true);

export const PASSWORD_CHANGE_EXEMPT_KEY = 'passwordChangeExempt';

/**
 * `mustChangePassword=true`인 사용자도 호출할 수 있는 예외 경로(FR-12-13).
 * `GET /auth/me`, `POST /auth/password`에만 부착한다. (`POST /auth/logout`은 `@Public()`이라
 * 이 판정 자체에 도달하지 않는다.)
 */
export const PasswordChangeExempt = (): MethodDecorator => SetMetadata(PASSWORD_CHANGE_EXEMPT_KEY, true);
