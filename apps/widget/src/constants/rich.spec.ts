import { describe, expect, it } from 'vitest';
// 시험 전용 import — 프로덕션 코드는 zod를 끌어오지 않기 위해 이 값을 로컬에 복제한다(RM-14).
// 이 시험은 두 원천이 어긋나지 않는지만 단언한다.
import { WIDGET_FEATURE_RICH_V1 as SHARED_WIDGET_FEATURE_RICH_V1 } from '@chat-bot/shared-types';
import { WIDGET_FEATURE_RICH_V1 } from './rich';

describe('widget constants/rich — shared-types 상수 복제본 동일성(RM-14)', () => {
  it('기능 선언 문자열이 shared-types와 같다', () => {
    expect(WIDGET_FEATURE_RICH_V1).toBe(SHARED_WIDGET_FEATURE_RICH_V1);
    expect(WIDGET_FEATURE_RICH_V1).toBe('rich-v1');
  });
});
