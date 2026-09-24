import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BackfillPendingBanner } from './BackfillPendingBanner';

describe('BackfillPendingBanner', () => {
  it('상태 배너로 안내 문구를 렌더하고 닫기 버튼이 없다(UIUX §8 "부분 정정 상태")', () => {
    render(<BackfillPendingBanner />);
    expect(screen.getByRole('status')).toHaveTextContent('과거 데이터 정리 중 — 일부 대화가 집계에서 빠져 있습니다.');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
