import { classifyHttpStatus, classifyTransportOutcome } from './classify-result';

describe('No.41 결과 분류(§7.4)', () => {
  it('2xx → SUCCESS', () => {
    expect(classifyHttpStatus(200, null)).toEqual({ kind: 'SUCCESS' });
    expect(classifyHttpStatus(204, null)).toEqual({ kind: 'SUCCESS' });
  });

  it.each([408, 425, 429, 500, 503])('%i → RETRY(HTTP_ERROR)', (status) => {
    const decision = classifyHttpStatus(status, null);
    expect(decision.kind).toBe('RETRY');
    if (decision.kind === 'RETRY') expect(decision.httpStatus).toBe(status);
  });

  it('429 + Retry-After → retryAfterMs가 실린다', () => {
    const decision = classifyHttpStatus(429, 120_000);
    expect(decision).toEqual({ kind: 'RETRY', outcome: 'HTTP_ERROR', httpStatus: 429, retryAfterMs: 120_000 });
  });

  it('그 밖의 4xx(404) → PERMANENT', () => {
    expect(classifyHttpStatus(404, null)).toEqual({ kind: 'PERMANENT', outcome: 'HTTP_ERROR', httpStatus: 404 });
  });

  it('3xx → PERMANENT(전송 계층에서 REDIRECT_NOT_ALLOWED로 이미 걸러짐 — 방어적 분류만)', () => {
    expect(classifyHttpStatus(302, null).kind).toBe('PERMANENT');
  });

  it('TIMEOUT·NETWORK_ERROR → RETRY', () => {
    expect(classifyTransportOutcome('TIMEOUT')).toEqual({ kind: 'RETRY', outcome: 'TIMEOUT' });
    expect(classifyTransportOutcome('NETWORK_ERROR')).toEqual({ kind: 'RETRY', outcome: 'NETWORK_ERROR' });
  });

  it('차단·비밀 없음 등은 PERMANENT', () => {
    expect(classifyTransportOutcome('EGRESS_BLOCKED').kind).toBe('PERMANENT');
    expect(classifyTransportOutcome('BLOCKED_ADDRESS').kind).toBe('PERMANENT');
    expect(classifyTransportOutcome('SECRET_MISSING').kind).toBe('PERMANENT');
    expect(classifyTransportOutcome('TARGET_HOST_MISMATCH').kind).toBe('PERMANENT');
    expect(classifyTransportOutcome('REDIRECT_NOT_ALLOWED').kind).toBe('PERMANENT');
  });
});
