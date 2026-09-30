import { ApiException } from '../../common/api.exception';
import { classifyExecutionError } from './outcome-classifier';

/** [신규 No.36] 승인 없는 예약 도래 → 영구 실패 `APPROVAL_MISSING`(ai-guardrails-설계.md §10.7). 기존 사례는 기존 spec이 그대로 지킨다. */
describe('classifyExecutionError — ENV_APPROVAL_REQUIRED', () => {
  it('영구 실패 APPROVAL_MISSING(재시도 없음)', () => {
    const e = new ApiException('ENV_APPROVAL_REQUIRED', 409, '2인 승인이 필요합니다.');
    expect(classifyExecutionError(e)).toEqual({ kind: 'PERMANENT', reason: 'APPROVAL_MISSING' });
  });

  it('기존 사례 회귀 — ENV_GATE_NOT_PASSED는 그대로 GATE_NOT_PASSED', () => {
    expect(classifyExecutionError(new ApiException('ENV_GATE_NOT_PASSED', 409, 'x'))).toEqual({ kind: 'PERMANENT', reason: 'GATE_NOT_PASSED' });
  });
});
