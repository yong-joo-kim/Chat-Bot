import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AsyncJobProgress } from './AsyncJobProgress';

/**
 * [No.43 R1 H1] 기본값(`live` 생략·`true`)에서는 기존 동작(루트 `role="status"`/`aria-live="polite"`
 * + sr-only 안내)이 그대로 유지되어야 하고, `live={false}`에서는 그 둘이 빠져야 한다(폴링 화면에서
 * 진행률 숫자가 바뀔 때마다 재낭독되는 것을 막기 위함 — `KbRunProgress` 소비 사례).
 */
describe('AsyncJobProgress', () => {
  it('기본값(live 생략)이면 루트에 role="status"·aria-live="polite"가 있고 sr-only 안내가 렌더된다(기존 동작 유지)', () => {
    const { container } = render(<AsyncJobProgress label="생성 중입니다..." />);
    const root = container.querySelector('.async-job-progress');
    expect(root).toHaveAttribute('role', 'status');
    expect(root).toHaveAttribute('aria-live', 'polite');
    // 화면 표시 span + sr-only 안내 span 둘 다에 같은 문구가 나온다(기본값 동작).
    expect(screen.getAllByText('생성 중입니다...')).toHaveLength(2);
    expect(container.querySelector('.sr-only')).toHaveTextContent('생성 중입니다...');
  });

  it('ariaLiveText를 주면 기본값에서도 그 텍스트가 sr-only로 낭독된다(기존 동작 유지)', () => {
    const { container } = render(<AsyncJobProgress label="진행 중" ariaLiveText="완료되었습니다" />);
    expect(container.querySelector('.sr-only')).toHaveTextContent('완료되었습니다');
  });

  it('live={false}면 루트에서 role·aria-live가 빠지고 sr-only 안내도 렌더되지 않는다(시각 표시 전용)', () => {
    const { container } = render(<AsyncJobProgress label="적재 중 · 120/312 완료" live={false} />);
    const root = container.querySelector('.async-job-progress');
    expect(root).not.toHaveAttribute('role');
    expect(root).not.toHaveAttribute('aria-live');
    expect(container.querySelector('.sr-only')).not.toBeInTheDocument();
    // 시각 표시(스피너·라벨)는 그대로 유지된다.
    expect(screen.getByText('적재 중 · 120/312 완료')).toBeInTheDocument();
  });

  it('진행률(progress)이 있으면 live 값과 무관하게 진행바를 보여준다', () => {
    const { container } = render(<AsyncJobProgress label="적재 중" progress={40} live={false} />);
    expect(container.querySelector('progress')).toHaveAttribute('value', '40');
  });
});
