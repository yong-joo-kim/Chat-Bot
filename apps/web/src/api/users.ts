import { apiClient } from './client';
import type {
  CreateUserDto,
  CreateUserResponse,
  Paginated,
  PasswordResetResponse,
  RoleListItem,
  UpdateUserDto,
  UpdateUserStatusDto,
  User,
  UserListQuery,
} from '@chat-bot/shared-types';

export interface UserListParams {
  q?: string;
  role?: UserListQuery['role'];
  status?: UserListQuery['status'];
  page?: number;
  pageSize?: number;
  sort?: UserListQuery['sort'];
  order?: UserListQuery['order'];
}

function buildQuery(params: UserListParams): string {
  const qs = new URLSearchParams();
  if (params.q) qs.set('q', params.q);
  if (params.role && params.role.length > 0) qs.set('role', params.role.join(','));
  if (params.status) qs.set('status', params.status);
  qs.set('page', String(params.page ?? 1));
  qs.set('pageSize', String(params.pageSize ?? 20));
  if (params.sort) qs.set('sort', params.sort);
  if (params.order) qs.set('order', params.order);
  return qs.toString();
}

/** 회원 관리(No.12-a, U1). 물리 삭제 API는 없다(비활성화로 대체, FR-12-30). */
export const usersApi = {
  list: (params: UserListParams) => apiClient.get<Paginated<User>>(`/users?${buildQuery(params)}`),
  create: (dto: CreateUserDto) => apiClient.post<CreateUserResponse>('/users', dto),
  findOne: (id: string) => apiClient.get<User>(`/users/${id}`),
  update: (id: string, dto: UpdateUserDto) => apiClient.patch<User>(`/users/${id}`, dto),
  updateStatus: (id: string, dto: UpdateUserStatusDto) => apiClient.patch<User>(`/users/${id}/status`, dto),
  resetPassword: (id: string) => apiClient.post<PasswordResetResponse>(`/users/${id}/password-reset`),
};

/** `GET /roles` — 역할 상수 조회(J-6). 하드코딩하지 않고 서버 값을 그대로 쓴다(FR-12-21). */
export const rolesApi = {
  list: () => apiClient.get<{ items: RoleListItem[] }>('/roles'),
};
