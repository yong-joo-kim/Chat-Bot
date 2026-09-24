import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiConnectionEditModal } from './ApiConnectionEditModal';

const mockCreate = vi.fn();

vi.mock('../../../api/apiConnections', () => ({
  apiConnectionsApi: {
    create: (...args: unknown[]) => mockCreate(...args),
    update: vi.fn(),
    test: vi.fn(),
  },
}));

/** AC1 — 연결 생성 모달(ui-spec §3.1.1). 원문 송신 확인 필드 불일치 시 저장이 막히는지가 핵심 회귀. */
describe('ApiConnectionEditModal', () => {
  beforeEach(() => {
    mockCreate.mockReset();
  });

  it('이름·URL·허용 메서드를 입력하고 저장하면 CreateApiConnectionDto로 생성 요청이 간다', async () => {
    const user = userEvent.setup();
    mockCreate.mockResolvedValue({});
    const onSaved = vi.fn();

    render(<ApiConnectionEditModal isOpen connection={null} onClose={vi.fn()} onSaved={onSaved} />);

    await user.type(screen.getByLabelText(/이름/), 'ERP 주문');
    await user.type(screen.getByLabelText(/기준 URL/), 'https://erp.corp.local/api');
    await user.click(screen.getByRole('button', { name: '저장' }));

    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockCreate.mock.calls[0][0]).toMatchObject({ name: 'ERP 주문', baseUrl: 'https://erp.corp.local/api', allowedMethods: ['GET'] });
    expect(onSaved).toHaveBeenCalled();
  });

  it('원문 개인정보 송신 허용을 켜고 확인 필드가 이름과 다르면 저장 버튼이 비활성(aria-disabled)된다', async () => {
    const user = userEvent.setup();
    render(<ApiConnectionEditModal isOpen connection={null} onClose={vi.fn()} onSaved={vi.fn()} />);

    await user.type(screen.getByLabelText(/이름/), 'ERP 주문');
    await user.click(screen.getByLabelText(/원문 개인정보 송신 허용/));
    await user.type(screen.getByLabelText(/원문 송신을 켜려면/), '다른이름');

    const saveButton = screen.getByRole('button', { name: '저장' });
    expect(saveButton).toBeDisabled();
    expect(mockCreate).not.toHaveBeenCalled();
  });
});
