import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AuditChainVerifyResponse } from '@chat-bot/shared-types';
import { ApiError } from '../../../api/client';
import { AuditChainVerifyPanel } from './AuditChainVerifyPanel';

const mockVerify = vi.fn();

vi.mock('../../../api/auditLogs', () => ({
  auditLogsApi: { verify: (...args: unknown[]) => mockVerify(...args) },
}));

async function openAndVerify(): Promise<ReturnType<typeof userEvent.setup>> {
  const user = userEvent.setup();
  render(<AuditChainVerifyPanel />);
  await user.click(screen.getByRole('button', { name: '무결성 검증' }));
  await user.click(screen.getByRole('button', { name: '검증' }));
  return user;
}

/** G3 — 감사 해시 체인 무결성 검증(data-governance-ui-spec.md §3.5). 기본 접힘. */
describe('AuditChainVerifyPanel', () => {
  beforeEach(() => {
    mockVerify.mockReset();
  });

  it('기본은 접혀 있고, 펼치면 기간 필드와 검증 버튼이 보인다', () => {
    render(<AuditChainVerifyPanel />);
    expect(screen.queryByRole('button', { name: '검증' })).not.toBeInTheDocument();
  });

  it('정상(OK) 결과는 체인 머리·검증 행수·보증 범위 안내를 함께 보여준다', async () => {
    const res: AuditChainVerifyResponse = {
      status: 'OK',
      range: { fromSeq: 1, toSeq: 412003 },
      checkedRows: 412003,
      preChainRows: 1204,
      outOfChainRows: 0,
      head: { seq: 1882410, hash: '9f3a7c000000000000000000000000' },
      methods: { sha256: 0, hmac: 412003 },
      verifiedAt: new Date('2026-09-26T02:10:00.000Z'),
    };
    mockVerify.mockResolvedValue(res);
    await openAndVerify();

    expect(await screen.findByText('정상')).toBeInTheDocument();
    expect(screen.getByText(/412,003행 검증/)).toBeInTheDocument();
    expect(screen.getByText(/체인 이전 행 1,204건/)).toBeInTheDocument();
    expect(screen.getByText(/체인 머리: seq 1882410/)).toBeInTheDocument();
    expect(screen.getByText(/이 검증은 "기록된 행이 이후 수정·삭제·재배열되지 않았음"을 탐지합니다/)).toBeInTheDocument();
  });

  it('불일치(HASH_MISMATCH) 결과는 firstBadSeq로 "이후 행 신뢰 불가" 문구를 보여준다', async () => {
    const res: AuditChainVerifyResponse = {
      status: 'HASH_MISMATCH',
      firstBadSeq: 1880122,
      range: { fromSeq: 1, toSeq: 412003 },
      checkedRows: 412003,
      preChainRows: 0,
      outOfChainRows: 0,
      head: null,
      methods: { sha256: 0, hmac: 412003 },
      verifiedAt: new Date('2026-09-26T02:10:00.000Z'),
    };
    mockVerify.mockResolvedValue(res);
    await openAndVerify();

    expect(await screen.findByText('불일치')).toBeInTheDocument();
    expect(screen.getByText(/seq 1880122에서 불일치 — 이후 행 신뢰 불가/)).toBeInTheDocument();
  });

  it('AUDIT_RANGE_TOO_WIDE 오류는 기간 필드 인라인 오류로 표시한다(기존 목록 조회와 동일 위치)', async () => {
    mockVerify.mockRejectedValue(new ApiError(400, '조회 기간은 최대 90일까지 지정할 수 있습니다.', 'AUDIT_RANGE_TOO_WIDE'));
    await openAndVerify();

    expect(await screen.findByText('조회 기간은 최대 90일까지 지정할 수 있습니다.')).toBeInTheDocument();
  });
});
