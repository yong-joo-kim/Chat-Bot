import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ApiConnectionPickerField } from './ApiConnectionPickerField';

const mockPicker = vi.fn();
const mockCan = vi.fn();

vi.mock('../../../../api/apiConnections', () => ({
  apiConnectionsApi: { picker: (...args: unknown[]) => mockPicker(...args) },
}));
vi.mock('../../../../context/AuthContext', () => ({
  useAuth: () => ({ can: (...args: unknown[]) => mockCan(...args) }),
}));

/** [No.26 1차 코드리뷰 반영] AC1 0건 안내(설계 §2.2) — 권한에 따라 링크/텍스트를 가른다. */
describe('ApiConnectionPickerField — 검색 결과 0건 안내', () => {
  it('security:write가 있으면 "API 연결 관리로 이동 →" 링크를 보여준다', async () => {
    mockPicker.mockResolvedValue({ items: [] });
    mockCan.mockReturnValue(true);
    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <ApiConnectionPickerField id="picker" label="연결" value={null} onChange={vi.fn()} />
      </MemoryRouter>,
    );

    await user.type(screen.getByRole('combobox'), 'ERP');

    expect(await screen.findByText("'ERP'에 해당하는 연결이 없습니다.")).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'API 연결 관리로 이동 →' })).toHaveAttribute('href', '/settings/api-connections');
  });

  it('security:write가 없으면 링크 대신 안내 텍스트만 보여준다', async () => {
    mockPicker.mockResolvedValue({ items: [] });
    mockCan.mockReturnValue(false);
    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <ApiConnectionPickerField id="picker" label="연결" value={null} onChange={vi.fn()} />
      </MemoryRouter>,
    );

    await user.type(screen.getByRole('combobox'), 'ERP');

    expect(await screen.findByText("'ERP'에 해당하는 연결이 없습니다.")).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /API 연결 관리로 이동/ })).not.toBeInTheDocument();
    expect(screen.getByText('관리자에게 연결 등록을 요청하세요.')).toBeInTheDocument();
  });
});
