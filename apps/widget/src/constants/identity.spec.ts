import { describe, expect, it } from 'vitest';
// 시험 전용 import — 프로덕션 코드는 zod를 끌어오지 않기 위해 이 값을 로컬에 복제한다(§10.2).
import { IDENTITY_TOKEN_HEADER as SHARED_IDENTITY_TOKEN_HEADER } from '@chat-bot/shared-types';
import { IDENTITY_TOKEN_HEADER } from './identity';

describe('widget constants/identity — shared-types 상수 복제본 동일성(§10.2, O-15)', () => {
  it('식별 토큰 헤더 이름이 shared-types와 같다', () => {
    expect(IDENTITY_TOKEN_HEADER).toBe(SHARED_IDENTITY_TOKEN_HEADER);
  });
});
