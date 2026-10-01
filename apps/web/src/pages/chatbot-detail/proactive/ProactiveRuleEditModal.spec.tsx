import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProactiveRuleEditModal } from './ProactiveRuleEditModal';

const mockCreateRule = vi.fn();
vi.mock('../../../api/proactive', () => ({
  proactiveApi: {
    createRule: (...args: unknown[]) => mockCreateRule(...args),
    updateRule: vi.fn(),
  },
}));

function renderModal(onSaved = vi.fn()): { onSaved: ReturnType<typeof vi.fn> } {
  render(<ProactiveRuleEditModal isOpen chatbotId="bot-1" rule={null} onClose={vi.fn()} onSaved={onSaved} primaryColor="#4F46E5" />);
  return { onSaved };
}

async function fillMinimumValidForm(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.type(screen.getByLabelText(/이름/), '배송조회 도움');
  await user.type(screen.getAllByLabelText('포함 경로')[0], '/order/**');
  await user.type(screen.getByLabelText(/안내 문구/), '주문·배송 조회를 도와드릴까요?');
}

beforeEach(() => {
  mockCreateRule.mockReset();
});

describe('ProactiveRuleEditModal — PA-C4(용도 확인 강제 · 문구 상한 · 저장)', () => {
  it('용도 확인 체크박스는 매번 미체크로 시작한다(사전 선택 금지, FR-PA1-8)', () => {
    renderModal();
    expect(screen.getByLabelText(/이 안내는 광고·판촉 목적이 아닌 이용 도움 안내입니다/)).not.toBeChecked();
  });

  it('용도 확인 체크 없이 저장하면 인라인 오류로 막고 API를 호출하지 않는다(사전 비활성화가 아니라 제출 시점 오류)', async () => {
    const user = userEvent.setup();
    renderModal();
    await fillMinimumValidForm(user);

    const saveButton = screen.getByRole('button', { name: '저장' });
    expect(saveButton).not.toBeDisabled(); // 클릭 자체는 가능(사전 비활성화 금지)
    await user.click(saveButton);

    expect(await screen.findByText('확인란에 체크해야 저장할 수 있습니다.')).toBeInTheDocument();
    expect(mockCreateRule).not.toHaveBeenCalled();
  });

  it('문구가 120자를 넘으면 저장하지 않고 인라인 오류를 보여준다', async () => {
    const user = userEvent.setup();
    renderModal();
    await user.type(screen.getByLabelText(/이름/), '이름');
    await user.type(screen.getAllByLabelText('포함 경로')[0], '/order/**');
    // maxLength=120이 브라우저 입력 자체를 막으므로, 제거한 뒤 fireEvent.change 1회로 121자를 채운다.
    // (user.type은 키 입력 121회 = 렌더 121회라 병렬 부하에서 기본 5초를 넘었다 — T-4.)
    const textarea = screen.getByLabelText(/안내 문구/) as HTMLTextAreaElement;
    textarea.removeAttribute('maxlength');
    fireEvent.change(textarea, { target: { value: 'a'.repeat(121) } });
    await user.click(screen.getByLabelText(/이 안내는 광고·판촉 목적이 아닌 이용 도움 안내입니다/));

    await user.click(screen.getByRole('button', { name: '저장' }));

    expect(await screen.findByText('120자 이내로 입력하세요.')).toBeInTheDocument();
    expect(mockCreateRule).not.toHaveBeenCalled();
  }, 15_000);

  it('포함 경로가 없으면 저장할 수 없다', async () => {
    const user = userEvent.setup();
    renderModal();
    await user.type(screen.getByLabelText(/이름/), '이름');
    await user.type(screen.getByLabelText(/안내 문구/), '문구');
    await user.click(screen.getByLabelText(/이 안내는 광고·판촉 목적이 아닌 이용 도움 안내입니다/));
    await user.click(screen.getByRole('button', { name: '저장' }));

    expect(await screen.findByText('포함 경로를 1개 이상 입력하세요.')).toBeInTheDocument();
    expect(mockCreateRule).not.toHaveBeenCalled();
  });

  it('모든 값이 유효하고 용도 확인을 체크하면 저장 API를 호출한다', async () => {
    mockCreateRule.mockResolvedValue({ id: 'rule-1' });
    const onSaved = vi.fn();
    const user = userEvent.setup();
    renderModal(onSaved);
    await fillMinimumValidForm(user);
    await user.click(screen.getByLabelText(/이 안내는 광고·판촉 목적이 아닌 이용 도움 안내입니다/));

    await user.click(screen.getByRole('button', { name: '저장' }));

    expect(mockCreateRule).toHaveBeenCalledTimes(1);
    const [chatbotId, dto] = mockCreateRule.mock.calls[0];
    expect(chatbotId).toBe('bot-1');
    expect(dto.purposeConfirmed).toBe(true);
    expect(dto.trigger).toEqual({ kind: 'PAGE_DWELL', pathInclude: ['/order/**'], pathExclude: [], dwellSec: 30 });
    expect(onSaved).toHaveBeenCalledTimes(1);
  });
});
