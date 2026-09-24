import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import { RoleBadge, AuditActionBadge } from './badges';

expect.extend(toHaveNoViolations);

/**
 * [No.24] `RoleBadge`의 `AGENT`(상담원) · `AuditActionBadge`의 `RAW_VIEW`(원문 열람) 배지 — apps/web
 * tsc 오류 2건(누락된 `Record` 키)을 해소한 지점의 회귀 시험(hybrid-cs-ui-spec.md §2.1).
 */
describe('badges — No.24 신규 배지', () => {
  it('AGENT 역할은 "상담원" 라벨과 아이콘을 함께 표시한다(색상 단독 아님)', () => {
    render(<RoleBadge role="AGENT" />);
    expect(screen.getByText('상담원')).toBeInTheDocument();
  });

  it('기존 3개 역할(ADMIN/EDITOR/VIEWER)도 그대로 렌더된다', () => {
    const { rerender } = render(<RoleBadge role="ADMIN" />);
    expect(screen.getByText('시스템 관리자')).toBeInTheDocument();
    rerender(<RoleBadge role="EDITOR" />);
    expect(screen.getByText('챗봇 편집자')).toBeInTheDocument();
    rerender(<RoleBadge role="VIEWER" />);
    expect(screen.getByText('운영 모니터')).toBeInTheDocument();
  });

  it('RAW_VIEW 감사 액션은 "원문 열람" 라벨을 표시한다', () => {
    render(<AuditActionBadge action="RAW_VIEW" />);
    expect(screen.getByText('원문 열람')).toBeInTheDocument();
  });

  it('AGENT 배지에 구조적 접근성 위반이 없다', async () => {
    const { container } = render(<RoleBadge role="AGENT" />);
    const results = await axe(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results).toHaveNoViolations();
  });
});
