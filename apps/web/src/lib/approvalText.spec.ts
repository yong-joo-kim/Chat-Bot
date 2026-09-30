import { describe, expect, it } from 'vitest';
import { ApiError } from '../api/client';
import { approvalActionLabel, approvalErrorView, approvalStatusView, approvalVersionArrow, remainingMinutes } from './approvalText';

const base = { status: 'PENDING', outcome: null, closedReason: null, failureCode: null, decisionNote: null, executedAt: null } as const;

describe('approvalStatusView — 요청 상태 글자(§9.5)', () => {
  it('PENDING = 승인 대기(INFO)', () => {
    expect(approvalStatusView(base)).toMatchObject({ label: '승인 대기', tone: 'INFO' });
  });

  it('APPROVED 결과별 글자', () => {
    expect(approvalStatusView({ ...base, status: 'APPROVED', outcome: 'APPLIED' })).toMatchObject({ label: '승인됨 · 운영에 적용됨', tone: 'SUCCESS' });
    expect(approvalStatusView({ ...base, status: 'APPROVED', outcome: 'SCHEDULED' })).toMatchObject({ label: '승인됨 · 예약 시각에 전환 예정', tone: 'INFO' });
    expect(approvalStatusView({ ...base, status: 'APPROVED', outcome: 'SCHEDULED', executedAt: new Date() })).toMatchObject({ label: '승인됨 · 예약 시각에 운영에 적용됨', tone: 'SUCCESS' });
    expect(approvalStatusView({ ...base, status: 'APPROVED', outcome: 'NOOP' }).label).toBe('승인됨 · 변경 없음(이미 같은 버전)');
  });

  it('APPROVED+FAILED는 실패 코드를 사유 글자로 옮기고 모르는 코드는 "알 수 없는 사유"', () => {
    expect(approvalStatusView({ ...base, status: 'APPROVED', outcome: 'FAILED', failureCode: 'ENV_GATE_NOT_PASSED' })).toMatchObject({ label: '승인됨 · 적용 실패(필수 시험 기준 미달)', tone: 'ERROR' });
    expect(approvalStatusView({ ...base, status: 'APPROVED', outcome: 'FAILED', failureCode: 'WHATEVER' }).label).toBe('승인됨 · 적용 실패(알 수 없는 사유)');
  });

  it('반려는 메모를 줄 아래 붙이고, 취소·만료는 사유별 글자', () => {
    expect(approvalStatusView({ ...base, status: 'REJECTED', decisionNote: '문구 재확인' })).toMatchObject({ label: '반려됨', note: '사유: 문구 재확인' });
    expect(approvalStatusView({ ...base, status: 'CANCELLED', closedReason: 'REQUESTER' }).label).toBe('요청자가 취소함');
    expect(approvalStatusView({ ...base, status: 'CANCELLED', closedReason: 'POLICY_OFF' }).label).toBe('2인 승인을 꺼서 취소됨');
    expect(approvalStatusView({ ...base, status: 'CANCELLED', closedReason: 'BASE_CHANGED' })).toMatchObject({ label: '운영 버전이 바뀌어 종료됨', tone: 'WARNING' });
    expect(approvalStatusView({ ...base, status: 'CANCELLED', closedReason: 'SCHEDULE_INACTIVE' }).label).toBe('예약이 취소·실행되어 종료됨');
    expect(approvalStatusView({ ...base, status: 'EXPIRED' })).toMatchObject({ label: '기한이 지나 만료됨', tone: 'WARNING' });
  });
});

describe('동작·대상 글자', () => {
  it('동작 글자와 "대상 ← 기준"', () => {
    const target = { versionId: 'a', versionNo: 13 };
    const from = { versionId: 'b', versionNo: 12 };
    expect(approvalActionLabel({ action: 'PROD_ROLLBACK', scheduledAt: null })).toBe('되돌리기 요청');
    expect(approvalActionLabel({ action: 'SCHEDULED_PROD_SWITCH', scheduledAt: new Date('2026-10-05T00:00:00.000Z') })).toContain('예약 전환 요청(예약 ');
    expect(approvalVersionArrow({ target, base: from })).toBe('v13 ← v12');
  });

  it('남은 시간(분, 올림)', () => {
    const now = new Date('2026-10-01T00:00:00.000Z');
    expect(remainingMinutes(new Date('2026-10-01T00:09:30.000Z'), now)).toBe(10);
    expect(remainingMinutes(new Date('2026-09-30T23:59:00.000Z'), now)).toBeLessThanOrEqual(0);
  });
});

describe('approvalErrorView — 오류 코드 → 화면 문구(§13.2)', () => {
  const err = (status: number, code: string, details?: Array<{ field: string; message: string }>): ApiError => new ApiError(status, '서버 문구', code as never, details);

  it('ENV_APPROVAL_REQUIRED: reason에 따라 요청 안내/끄기 잠금', () => {
    expect(approvalErrorView(err(409, 'ENV_APPROVAL_REQUIRED', [{ field: 'reason', message: 'APPROVAL_REQUIRED' }])).kind).toBe('APPROVAL_REQUIRED');
    expect(approvalErrorView(err(409, 'ENV_APPROVAL_REQUIRED', [{ field: 'reason', message: 'POLICY_ACTIVE' }]))).toMatchObject({ kind: 'POLICY_ACTIVE', text: expect.stringContaining('환경 분리를 끌 수 없습니다') });
  });

  it('APPROVAL_NOT_PENDING은 status별 문구', () => {
    expect(approvalErrorView(err(409, 'APPROVAL_NOT_PENDING', [{ field: 'status', message: 'APPROVED' }])).text).toBe('이미 다른 관리자가 승인했습니다. 최신 상태를 불러왔습니다.');
    expect(approvalErrorView(err(409, 'APPROVAL_NOT_PENDING', [{ field: 'status', message: 'REJECTED' }])).text).toBe('이미 반려된 요청입니다.');
    expect(approvalErrorView(err(409, 'APPROVAL_NOT_PENDING', [{ field: 'status', message: 'CANCELLED' }])).text).toBe('이미 취소된 요청입니다.');
    expect(approvalErrorView(err(409, 'APPROVAL_NOT_PENDING', [{ field: 'status', message: 'EXPIRED' }])).text).toContain('만료되었습니다');
  });

  it('자기 승인·기준 변경·대기 중복(요청 id 동반)·정책 사용 불가 사유', () => {
    expect(approvalErrorView(err(403, 'APPROVAL_SELF_FORBIDDEN')).kind).toBe('SELF_FORBIDDEN');
    expect(approvalErrorView(err(409, 'APPROVAL_BASE_CHANGED')).kind).toBe('BASE_CHANGED');
    expect(approvalErrorView(err(409, 'APPROVAL_PENDING_EXISTS', [{ field: 'requestId', message: 'req-1' }]))).toMatchObject({ kind: 'PENDING_EXISTS', requestId: 'req-1' });
    expect(approvalErrorView(err(409, 'APPROVAL_POLICY_UNAVAILABLE', [{ field: 'reason', message: 'NOT_ENOUGH_APPROVERS' }])).text).toBe('활성 상태의 관리자가 2명 이상이어야 켤 수 있습니다.');
    expect(approvalErrorView(err(409, 'APPROVAL_POLICY_UNAVAILABLE', [{ field: 'reason', message: 'ENV_MODE_DISABLED' }])).text).toBe('환경 분리가 꺼져 있어 2인 승인을 쓸 수 없습니다.');
    expect(approvalErrorView(err(409, 'APPROVAL_POLICY_UNAVAILABLE', [{ field: 'reason', message: 'OFF_LOCKED' }])).text).toContain('끄기가 잠겨 있습니다');
    expect(approvalErrorView(err(409, 'APPROVAL_POLICY_UNAVAILABLE', [{ field: 'reason', message: 'NOT_REQUIRED' }])).text).toContain('승인 요청이 필요하지 않습니다');
  });

  it('승인 뒤 적용 실패(requestStatus=APPROVED)는 "승인은 기록되었지만…" 문구', () => {
    const details = [{ field: 'requestStatus', message: 'APPROVED' }, { field: 'outcome', message: 'FAILED' }];
    expect(approvalErrorView(err(409, 'ENV_GATE_NOT_PASSED', details))).toMatchObject({ kind: 'APPLY_FAILED', text: expect.stringContaining('승인은 기록되었지만 필수 시험 기준') });
    expect(approvalErrorView(err(409, 'ENV_TARGET_NOT_STAGING', details)).text).toContain('전환 대상이 아니어서');
    expect(approvalErrorView(err(404, 'NOT_FOUND', details)).text).toContain('대상 버전을 찾을 수 없어');
    expect(approvalErrorView(err(409, 'CHATBOT_ARCHIVED', details)).text).toContain('보관되었거나 환경 분리가 꺼져');
  });

  it('403 취소·예약 요청 위치별 문구, 그 밖은 일반 오류', () => {
    expect(approvalErrorView(err(403, 'FORBIDDEN'), 'CANCEL').text).toBe('요청한 사람만 취소할 수 있습니다.');
    expect(approvalErrorView(err(403, 'FORBIDDEN'), 'SCHEDULE_REQUEST').text).toBe('예약을 만든 사람만 승인 요청을 보낼 수 있습니다.');
    expect(approvalErrorView(err(404, 'NOT_FOUND')).kind).toBe('NOT_FOUND');
    expect(approvalErrorView(new Error('x')).kind).toBe('OTHER');
    expect(approvalErrorView(err(500, 'INTERNAL_ERROR')).text).toContain('처리하지 못했습니다');
  });
});
