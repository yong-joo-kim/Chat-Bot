import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { planFeedbackAttempt } from './feedback';

describe('core/feedback — planFeedbackAttempt(§13.5)', () => {
  it('200(OK)은 완료다', () => {
    expect(planFeedbackAttempt('OK', 1)).toEqual({ action: 'DONE_OK' });
  });

  it('404(NOT_FOUND) 1회차는 1초 뒤 재시도, 2회차는 UNAVAILABLE + 잠김이다', () => {
    expect(planFeedbackAttempt('NOT_FOUND', 1)).toEqual({ action: 'RETRY', delayMs: 1000 });
    expect(planFeedbackAttempt('NOT_FOUND', 2)).toEqual({ action: 'DONE_FAIL', notice: 'UNAVAILABLE', disable: true });
  });

  it('네트워크·5xx 1회차는 재시도, 2회차는 SAVE_FAILED(잠금 없음)다', () => {
    expect(planFeedbackAttempt('NETWORK', 1)).toEqual({ action: 'RETRY', delayMs: 1000 });
    expect(planFeedbackAttempt('NETWORK', 2)).toEqual({ action: 'DONE_FAIL', notice: 'SAVE_FAILED', disable: false });
    expect(planFeedbackAttempt('SERVER', 1)).toEqual({ action: 'RETRY', delayMs: 1000 });
    expect(planFeedbackAttempt('SERVER', 2)).toEqual({ action: 'DONE_FAIL', notice: 'SAVE_FAILED', disable: false });
  });

  it('409(CLOSED)는 재시도 없이 LOCKED + 잠김이다', () => {
    expect(planFeedbackAttempt('CLOSED', 1)).toEqual({ action: 'DONE_FAIL', notice: 'LOCKED', disable: true });
    expect(planFeedbackAttempt('CLOSED', 2)).toEqual({ action: 'DONE_FAIL', notice: 'LOCKED', disable: true });
  });

  it('429(RATE_LIMITED)는 재시도 없이 SILENT(잠금 없음)다', () => {
    expect(planFeedbackAttempt('RATE_LIMITED', 1)).toEqual({ action: 'DONE_FAIL', notice: 'SILENT', disable: false });
  });

  it('403(DISABLED)은 재시도 없이 UNAVAILABLE + 잠김이다', () => {
    expect(planFeedbackAttempt('DISABLED', 1)).toEqual({ action: 'DONE_FAIL', notice: 'UNAVAILABLE', disable: true });
  });
});

describe('core/feedback — sessionStorage/localStorage 미사용(F-16)', () => {
  it('소스 코드에 sessionStorage·localStorage 참조가 없다', () => {
    const target = path.resolve(process.cwd(), 'src/core/feedback.ts');
    const src = readFileSync(target, 'utf-8');
    expect(src).not.toContain('sessionStorage');
    expect(src).not.toContain('localStorage');
  });
});
