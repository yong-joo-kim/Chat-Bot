import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import type { ResolvedBundleTarget } from '@chat-bot/shared-types';
import { TargetBadge, targetLabel } from './TargetBadge';

expect.extend(toHaveNoViolations);

function target(overrides: Partial<ResolvedBundleTarget> = {}): ResolvedBundleTarget {
  return {
    kind: 'STAGING',
    versionId: 'ver-44',
    versionNo: 44,
    legacyTiebreak: false,
    semanticMissing: 0,
    ...overrides,
  };
}

describe('targetLabel', () => {
  it('STAGING/PROD는 전용 문구, 그 외는 v{n}만 표시한다', () => {
    expect(targetLabel({ kind: 'STAGING', versionNo: 44 })).toBe('스테이징(v44)');
    expect(targetLabel({ kind: 'PROD', versionNo: 43 })).toBe('운영(v43)');
    expect(targetLabel({ kind: 'VERSION', versionNo: 40 })).toBe('v40');
  });
});

describe('TargetBadge', () => {
  it('target이 없으면(초안) 아무것도 렌더하지 않는다(§4.14)', () => {
    const { container } = render(<TargetBadge />);
    expect(container).toBeEmptyDOMElement();
  });

  it('대상 라벨을 "대상: " 접두사와 함께 보여준다', () => {
    render(<TargetBadge target={target()} />);
    expect(screen.getByText('대상: 스테이징(v44)')).toBeInTheDocument();
  });

  it('legacyTiebreak이면 힌트를 병기한다', () => {
    render(<TargetBadge target={target({ legacyTiebreak: true })} />);
    expect(screen.getByText('이전 형식 — 동점 규칙이 다를 수 있음')).toBeInTheDocument();
  });

  it('semanticMissing > 0이면 준비 중 힌트를 병기한다', () => {
    render(<TargetBadge target={target({ semanticMissing: 2 })} />);
    expect(screen.getByText('의미 색인 준비 중 2건')).toBeInTheDocument();
  });

  it('axe 스캔 위반 0건', async () => {
    const { container } = render(<TargetBadge target={target({ legacyTiebreak: true, semanticMissing: 1 })} />);
    const results = await axe(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results).toHaveNoViolations();
  });
});
