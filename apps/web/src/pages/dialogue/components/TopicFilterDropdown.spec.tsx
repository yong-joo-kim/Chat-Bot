import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { makeTopic } from '../../../test/fixtures';
import { TopicFilterDropdown } from './TopicFilterDropdown';

/** [코드 리뷰 1회차 M-2] URL에 남은 삭제된 토픽 id를 "삭제된 토픽" 칩으로 보여주고 제거할 수 있다(EX-TP-24). */
describe('TopicFilterDropdown — 삭제된 토픽 칩(M-2)', () => {
  it('선택 목록에 존재하지 않는 토픽 id가 있으면 "삭제된 토픽" 칩을 보여준다', () => {
    const topics = [makeTopic({ id: 'topic-1', name: '배송', enabled: true })];
    render(<TopicFilterDropdown topics={topics} selected={['topic-1', 'topic-deleted']} onChange={vi.fn()} />);

    expect(screen.getByText('삭제된 토픽')).toBeInTheDocument();
  });

  it('존재하는 토픽/공통만 선택되어 있으면 삭제된 토픽 칩이 없다', () => {
    const topics = [makeTopic({ id: 'topic-1', name: '배송', enabled: true })];
    render(<TopicFilterDropdown topics={topics} selected={['topic-1', 'common']} onChange={vi.fn()} />);

    expect(screen.queryByText('삭제된 토픽')).not.toBeInTheDocument();
  });

  it('삭제된 토픽 칩의 제거 버튼을 누르면 onChange가 그 id를 뺀 배열로 호출된다', async () => {
    const user = userEvent.setup();
    const topics = [makeTopic({ id: 'topic-1', name: '배송', enabled: true })];
    const onChange = vi.fn();
    render(<TopicFilterDropdown topics={topics} selected={['topic-1', 'topic-deleted']} onChange={onChange} />);

    await user.click(screen.getByRole('button', { name: '삭제된 토픽 제거' }));

    expect(onChange).toHaveBeenCalledWith(['topic-1']);
  });
});
