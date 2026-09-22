import { apiClient } from './client';
import type { ChangePasswordDto, CurrentUser, LoginRequestDto, LoginResponse } from '@chat-bot/shared-types';

/** 인증 4종(No.12-c, `security-audit-설계.md` §5.1). 쿠키(`cb_session`)는 브라우저가 자동 관리한다. */
export const authApi = {
  login: (dto: LoginRequestDto) => apiClient.post<LoginResponse>('/auth/login', dto),
  logout: () => apiClient.post<void>('/auth/logout'),
  me: () => apiClient.get<CurrentUser>('/auth/me'),
  changePassword: (dto: ChangePasswordDto) => apiClient.post<void>('/auth/password', dto),
};
