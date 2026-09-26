import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { GovernanceViewAuditBanner } from './GovernanceViewAuditBanner';
import { DataGovernanceModeBanner } from './DataGovernanceModeBanner';

/**
 * G7 — 열람 감사 안내 배너(data-governance-ui-spec.md §3.10). 정적 텍스트이며 `role`/`aria-live`를
 * 쓰지 않는다(PM 확정 — §3.10 접근성 규칙).
 */
describe('GovernanceViewAuditBanner', () => {
  it('visible=true면 배너 문구를 정적 문단으로 렌더하고 role/aria-live를 쓰지 않는다', () => {
    render(<GovernanceViewAuditBanner visible />);
    const banner = screen.getByText('이 화면 열람은 감사로그에 기록됩니다.');
    expect(banner.tagName).toBe('P');
    expect(banner).not.toHaveAttribute('role');
    expect(banner).not.toHaveAttribute('aria-live');
  });

  it('visible=false면 아무것도 렌더하지 않는다', () => {
    const { container } = render(<GovernanceViewAuditBanner visible={false} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('DataGovernanceModeBanner', () => {
  it('visible=true면 모드 꺼짐 안내를 렌더한다', () => {
    render(<DataGovernanceModeBanner visible />);
    expect(screen.getByText(/거버넌스 모드 꺼짐/)).toBeInTheDocument();
  });

  it('visible=false면 아무것도 렌더하지 않는다', () => {
    const { container } = render(<DataGovernanceModeBanner visible={false} />);
    expect(container).toBeEmptyDOMElement();
  });
});
