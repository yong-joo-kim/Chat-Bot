import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import { makeAuditLogDetail } from '../../../test/fixtures';
import { AuditLogDetailPanel } from './AuditLogDetailPanel';

expect.extend(toHaveNoViolations);

/**
 * [코드 리뷰 R1 L-5] 체인 정보의 두 CopyButton은 서로 다른 접근 가능한 이름(이전 해시/이 행 해시)을
 * 가져야 한다(data-governance-ui-spec.md §3.5).
 */
describe('AuditLogDetailPanel — 체인 정보(No.45)', () => {
  it('chain이 있으면 이전 해시·이 행 해시 복사 버튼을 서로 다른 라벨로 구분한다', () => {
    const detail = makeAuditLogDetail({
      chain: {
        seq: 1882410,
        prevHash: 'aaaaaaaaaaaa1111111111111111111111',
        rowHash: 'bbbbbbbbbbbb2222222222222222222222',
        method: 'HMAC',
      },
    });
    render(<AuditLogDetailPanel detail={detail} />);

    expect(screen.getByRole('button', { name: '이전 해시 복사' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '이 행 해시 복사' })).toBeInTheDocument();
    expect(screen.getByText('aaaaaaaaaaaa…')).toBeInTheDocument();
    expect(screen.getByText('bbbbbbbbbbbb…')).toBeInTheDocument();
  });

  it('chain이 없으면 체인 정보 소절 자체가 렌더되지 않는다', () => {
    const detail = makeAuditLogDetail();
    render(<AuditLogDetailPanel detail={detail} />);

    expect(screen.queryByText('체인 정보')).not.toBeInTheDocument();
  });

  it('체인 정보가 있는 상세 패널에 구조적 접근성 위반이 없다', async () => {
    const detail = makeAuditLogDetail({
      chain: { seq: 1, prevHash: 'g1:genesis', rowHash: 'cccccccccccc3333333333333333333333', method: 'SHA256' },
    });
    const { container } = render(<AuditLogDetailPanel detail={detail} />);

    const results = await axe(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results).toHaveNoViolations();
  });
});
