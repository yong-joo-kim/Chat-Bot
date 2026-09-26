import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { RichUrlPolicyResponse } from '@chat-bot/shared-types';
import { ToastProvider } from '../../../components/Toast';
import { RichUrlPolicySection } from './RichUrlPolicySection';

const mockGet = vi.fn();
const mockUpdate = vi.fn();
vi.mock('../../../api/richMessages', () => ({
  richMessagesApi: {
    getUrlPolicy: (...args: unknown[]) => mockGet(...args),
    updateUrlPolicy: (...args: unknown[]) => mockUpdate(...args),
  },
}));

let mockCan = (_perm: string) => true;
vi.mock('../../../context/AuthContext', () => ({
  useAuth: () => ({ can: (perm: string) => mockCan(perm) }),
}));

function makeResponse(overrides: Partial<RichUrlPolicyResponse> = {}): RichUrlPolicyResponse {
  return {
    chatbotId: '11111111-1111-1111-1111-111111111111',
    hosts: [],
    updatedAt: null,
    outsideNodeCount: 0,
    governanceModeOn: false,
    ...overrides,
  };
}

function renderSection(): ReturnType<typeof render> {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <RichUrlPolicySection chatbotId="bot-1" isArchived={false} />
      </ToastProvider>
    </MemoryRouter>,
  );
}

describe('RichUrlPolicySection — RM-5(§3.5)', () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockUpdate.mockReset();
    mockCan = () => true;
  });

  it('빈 목록이면 "등록된 허용 도메인이 없습니다" 안내가 보인다', async () => {
    mockGet.mockResolvedValue(makeResponse());
    renderSection();
    expect(await screen.findByText('등록된 허용 도메인이 없습니다 — 모든 https 주소를 쓸 수 있습니다.')).toBeInTheDocument();
  });

  it('호스트를 추가하면 로컬 목록에 반영되고, 저장을 눌러야 API가 호출된다', async () => {
    mockGet.mockResolvedValue(makeResponse());
    mockUpdate.mockResolvedValue(makeResponse({ hosts: [{ host: 'img.example.com', includeSubdomains: false }] }));
    const user = userEvent.setup();
    renderSection();

    await screen.findByText(/등록된 허용 도메인이 없습니다/);
    await user.type(screen.getByLabelText('호스트'), 'img.example.com');
    await user.click(screen.getByRole('button', { name: '추가' }));

    expect(screen.getByText('img.example.com')).toBeInTheDocument();
    expect(mockUpdate).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: '저장' }));
    await waitFor(() => expect(mockUpdate).toHaveBeenCalledWith('bot-1', { hosts: [{ host: 'img.example.com', includeSubdomains: false }] }));
  });

  it('형식이 잘못된 호스트는 인라인 오류를 보여준다', async () => {
    mockGet.mockResolvedValue(makeResponse());
    const user = userEvent.setup();
    renderSection();
    await screen.findByText(/등록된 허용 도메인이 없습니다/);

    await user.type(screen.getByLabelText('호스트'), 'https://img.example.com/path');
    await user.click(screen.getByRole('button', { name: '추가' }));

    expect(screen.getByText('호스트 이름만 입력해 주세요(예: img.example.com).')).toBeInTheDocument();
  });

  it('중복 호스트는 거부된다', async () => {
    mockGet.mockResolvedValue(makeResponse({ hosts: [{ host: 'img.example.com', includeSubdomains: false }] }));
    const user = userEvent.setup();
    renderSection();
    await screen.findByText('img.example.com');

    await user.type(screen.getByLabelText('호스트'), 'img.example.com');
    await user.click(screen.getByRole('button', { name: '추가' }));

    expect(screen.getByText('이미 목록에 있는 호스트입니다.')).toBeInTheDocument();
  });

  it('목록 밖 주소를 쓰는 노드 수를 보여주고 노드 목록 링크를 제공한다', async () => {
    mockGet.mockResolvedValue(makeResponse({ hosts: [{ host: 'img.example.com', includeSubdomains: false }], outsideNodeCount: 3 }));
    renderSection();
    expect(await screen.findByText(/목록 밖 주소를 쓰는 초안 노드: 3개/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '노드 목록에서 확인 →' })).toHaveAttribute('href', '/chatbots/bot-1/dialogue/nodes');
  });

  it('거버넌스 모드 + 빈 목록이면 경고 배지가 보인다', async () => {
    mockGet.mockResolvedValue(makeResponse({ governanceModeOn: true }));
    renderSection();
    expect(await screen.findByText('외부 이미지·링크 주소에 제한이 없습니다.')).toBeInTheDocument();
  });

  it('호스트가 50개면 추가 버튼이 비활성이고 상한 안내가 상시 보인다(코드 리뷰 R1 Medium — 도달 불가 분기 제거)', async () => {
    const hosts = Array.from({ length: 50 }, (_, i) => ({ host: `img${i}.example.com`, includeSubdomains: false }));
    mockGet.mockResolvedValue(makeResponse({ hosts }));
    renderSection();
    await screen.findByText('img0.example.com');

    expect(screen.getByRole('button', { name: '추가' })).toBeDisabled();
    expect(screen.getByText('최대 50개까지 등록할 수 있습니다.')).toBeInTheDocument();
    expect(screen.getByText('허용 도메인(50/50)')).toBeInTheDocument();
  });

  it('49개일 때는 상한 안내가 보이지 않고 추가 버튼이 활성 상태다', async () => {
    const hosts = Array.from({ length: 49 }, (_, i) => ({ host: `img${i}.example.com`, includeSubdomains: false }));
    mockGet.mockResolvedValue(makeResponse({ hosts }));
    renderSection();
    await screen.findByText('img0.example.com');

    expect(screen.getByRole('button', { name: '추가' })).toBeEnabled();
    expect(screen.queryByText('최대 50개까지 등록할 수 있습니다.')).not.toBeInTheDocument();
  });

  it('chatbot:write 권한이 없으면(VIEWER) 표만 읽기 전용으로 보이고 추가·저장 요소가 없다', async () => {
    mockCan = (perm: string) => perm !== 'chatbot:write';
    mockGet.mockResolvedValue(makeResponse({ hosts: [{ host: 'img.example.com', includeSubdomains: true }] }));
    renderSection();
    await screen.findByText('img.example.com');

    expect(screen.queryByLabelText('호스트')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '추가' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '저장' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '삭제' })).not.toBeInTheDocument();
  });
});
