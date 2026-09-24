import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe, toHaveNoViolations } from 'jest-axe';
import { RawTextToggle } from './RawTextToggle';

expect.extend(toHaveNoViolations);

/**
 * [No.24] 원문 보기 토글(hybrid-cs-ui-spec.md §2.2·§3.3, §12-3). 노출 조건·기본 꺼짐·켜기 전 고지를 검증한다.
 */
describe('RawTextToggle', () => {
  it('visible=false면 아예 렌더되지 않는다(비활성 표시조차 하지 않음)', () => {
    const { container } = render(<RawTextToggle visible={false} enabled={false} onToggle={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('visible=true면 렌더되고, 기본값은 꺼짐(체크 안 됨)이다', () => {
    render(<RawTextToggle visible enabled={false} onToggle={vi.fn()} />);
    const checkbox = screen.getByRole('checkbox', { name: '원문 보기' });
    expect(checkbox).not.toBeChecked();
  });

  it('켤 때는 고지 팝오버를 먼저 보여주고, 확인해야 onToggle(true)가 호출된다', async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(<RawTextToggle visible enabled={false} onToggle={onToggle} />);

    await user.click(screen.getByRole('checkbox', { name: '원문 보기' }));
    // 고지 팝오버가 뜨고, 아직 onToggle은 호출되지 않는다.
    expect(screen.getByText('이 상담의 원문을 확인하면 열람 기록이 남습니다. 계속할까요?')).toBeInTheDocument();
    expect(onToggle).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: '원문 보기' }));
    expect(onToggle).toHaveBeenCalledWith(true);
  });

  it('취소를 누르면 onToggle이 호출되지 않는다', async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(<RawTextToggle visible enabled={false} onToggle={onToggle} />);

    await user.click(screen.getByRole('checkbox', { name: '원문 보기' }));
    await user.click(screen.getByRole('button', { name: '취소' }));
    expect(onToggle).not.toHaveBeenCalled();
  });

  it('끄는 동작은 고지 없이 즉시 onToggle(false)를 호출한다', async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(<RawTextToggle visible enabled onToggle={onToggle} />);

    await user.click(screen.getByRole('checkbox', { name: '원문 보기' }));
    expect(onToggle).toHaveBeenCalledWith(false);
  });

  it('접근성 위반이 없다', async () => {
    const { container } = render(<RawTextToggle visible enabled={false} onToggle={vi.fn()} />);
    const results = await axe(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results).toHaveNoViolations();
  });
});
