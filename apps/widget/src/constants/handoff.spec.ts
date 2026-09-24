import { describe, expect, it } from 'vitest';
// 시험 전용 import — 프로덕션 코드는 zod를 끌어오지 않기 위해 이 값들을 로컬에 복제한다(§10.2).
// 이 시험은 두 원천이 어긋나지 않는지만 단언한다.
import {
  HANDOFF_SESSION_HEADER as SHARED_HANDOFF_SESSION_HEADER,
  HANDOFF_TOKEN_HEADER as SHARED_HANDOFF_TOKEN_HEADER,
  WIDGET_FEATURE_HANDOFF_V1 as SHARED_WIDGET_FEATURE_HANDOFF_V1,
} from '@chat-bot/shared-types';
import { HANDOFF_SESSION_HEADER, HANDOFF_TOKEN_HEADER, WIDGET_FEATURE_HANDOFF_V1 } from './handoff';

describe('widget constants/handoff — shared-types 상수 복제본 동일성(§10.2)', () => {
  it('세션·토큰 헤더 이름이 shared-types와 같다', () => {
    expect(HANDOFF_SESSION_HEADER).toBe(SHARED_HANDOFF_SESSION_HEADER);
    expect(HANDOFF_TOKEN_HEADER).toBe(SHARED_HANDOFF_TOKEN_HEADER);
  });

  it('기능 선언 문자열이 shared-types와 같다', () => {
    expect(WIDGET_FEATURE_HANDOFF_V1).toBe(SHARED_WIDGET_FEATURE_HANDOFF_V1);
  });
});
