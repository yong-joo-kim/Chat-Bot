import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import type { ResolvedBundleTarget } from '@chat-bot/shared-types';
import { EnvFingerprintDiffBanner } from './EnvFingerprintDiffBanner';

expect.extend(toHaveNoViolations);

function target(overrides: Partial<ResolvedBundleTarget> = {}): ResolvedBundleTarget {
  return { kind: 'STAGING', versionId: 'ver-44', versionNo: 44, legacyTiebreak: false, semanticMissing: 0, ...overrides };
}

/** [신규 No.40] 두 실행의 대상이 다를 때 정보성 경고(`environment-separation-ui-spec.md` §4.14). */
describe('EnvFingerprintDiffBanner — 대상 다름 경고(No.40)', () => {
  it('diffs가 비어 있고 대상도 같으면(둘 다 초안) 아무것도 렌더하지 않는다', () => {
    const { container } = render(<EnvFingerprintDiffBanner diffs={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('대상이 다르면(A: 초안, B: 스테이징) diffs가 없어도 경고를 렌더한다', () => {
    render(<EnvFingerprintDiffBanner diffs={[]} targetTarget={target()} />);
    expect(screen.getByText('두 실행의 대상이 다릅니다(A: 초안, B: 스테이징(v44)) — 결과 차이가 대상 차이 때문일 수 있습니다.')).toBeInTheDocument();
  });

  it('두 대상이 같은 버전이면(둘 다 스테이징 v44) 경고를 렌더하지 않는다', () => {
    render(<EnvFingerprintDiffBanner diffs={[]} baseTarget={target()} targetTarget={target()} />);
    expect(screen.queryByText(/두 실행의 대상이 다릅니다/)).not.toBeInTheDocument();
  });

  it('기존 지문 차이 배지와 대상 다름 경고가 함께 보일 수 있다', () => {
    render(
      <EnvFingerprintDiffBanner
        diffs={[{ key: 'thresholds', label: '임계값이 달라졌습니다', severity: 'WARNING' }]}
        baseTarget={undefined}
        targetTarget={target({ kind: 'PROD', versionNo: 43 })}
      />,
    );
    expect(screen.getByText('두 실행 사이에 환경이 달라졌습니다')).toBeInTheDocument();
    expect(screen.getByText('두 실행의 대상이 다릅니다(A: 초안, B: 운영(v43)) — 결과 차이가 대상 차이 때문일 수 있습니다.')).toBeInTheDocument();
  });

  it('대상 다름 경고가 보이는 상태 — axe 스캔 위반 0건', async () => {
    const { container } = render(<EnvFingerprintDiffBanner diffs={[]} targetTarget={target()} />);
    const results = await axe(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results).toHaveNoViolations();
  });
});
