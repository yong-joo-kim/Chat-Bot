import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { ChannelToggle } from '../pages/chatbot-detail/channels/ChannelToggle';
import { ChipListEditor } from './ChipListEditor';

function Harness({ split = false, invalid }: { split?: boolean; invalid?: string[] }): JSX.Element {
  const [values, setValues] = useState<string[]>([]);
  return <ChipListEditor id="chips" label="표현" placeholder="표현 입력" values={values} onChange={setValues} splitPastedLines={split} invalidValues={invalid} maxItems={3} limitMessage="최대 3개" />;
}

describe('ChipListEditor — [No.36] 줄바꿈 붙여넣기 분할·오류 칩 강조', () => {
  it('기본(splitPastedLines 꺼짐)은 기존과 같이 붙여넣기를 가로채지 않는다', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const input = screen.getByLabelText('표현 입력');
    input.focus();
    await user.paste('가나\n다라');
    expect(screen.queryByText('가나')).toBeNull();
  });

  it('splitPastedLines: 줄마다 하나씩 추가하고 빈 줄·중복은 건너뛰며 최대 개수를 넘기지 않는다', async () => {
    const user = userEvent.setup();
    render(<Harness split />);
    const input = screen.getByLabelText('표현 입력');
    input.focus();
    await user.paste('가나\n\n가나\n다라\n마바\n사아');
    expect(screen.getByText('가나')).toBeInTheDocument();
    expect(screen.getByText('다라')).toBeInTheDocument();
    expect(screen.getByText('마바')).toBeInTheDocument();
    expect(screen.queryByText('사아')).toBeNull();
    expect(screen.getByText('이미 추가된 항목입니다.')).toBeInTheDocument();
    expect(input).toBeDisabled();
    expect(screen.getByText('최대 3개')).toBeInTheDocument();
  });

  it('invalidValues에 든 칩은 글자 표식(⚠)과 강조 클래스를 함께 가진다(색 단독 금지)', async () => {
    const user = userEvent.setup();
    render(<Harness invalid={['가나']} />);
    await user.type(screen.getByLabelText('표현 입력'), '가나{Enter}');
    const chip = screen.getByText(/가나/, { selector: '.chip' });
    expect(chip).toHaveClass('chip--invalid');
    expect(chip.textContent).toContain('⚠');
    expect(screen.getByRole('button', { name: '가나 제거' })).toBeInTheDocument();
  });
});

describe('ChannelToggle — [No.36] 글자 교체·진행 중 상태', () => {
  it('기본 라벨은 기존("사용 중/사용 안 함")이고 onLabel/offLabel로 바꿀 수 있다', () => {
    const { rerender } = render(<ChannelToggle id="t" enabled locked={false} onToggle={vi.fn()} />);
    expect(screen.getByRole('switch')).toHaveTextContent('사용 중');
    rerender(<ChannelToggle id="t" enabled={false} locked={false} onToggle={vi.fn()} onLabel="켜짐" offLabel="꺼짐" />);
    expect(screen.getByRole('switch')).toHaveTextContent('꺼짐');
  });

  it('busy는 aria-disabled(포커스 유지)이고 잠금 아이콘·사유 없이 클릭을 무시한다', async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(<ChannelToggle id="t" enabled locked={false} busy onToggle={onToggle} />);
    const sw = screen.getByRole('switch');
    expect(sw).toHaveAttribute('aria-disabled', 'true');
    expect(sw.textContent).not.toContain('🔒');
    await user.click(sw);
    expect(onToggle).not.toHaveBeenCalled();
  });
});
