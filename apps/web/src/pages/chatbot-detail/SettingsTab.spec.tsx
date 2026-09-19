import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider } from '../../components/Toast';
import { makeChatbot } from '../../test/fixtures';
import type { ChatbotDetailContext } from '../ChatbotDetailLayout';
import { SettingsTab } from './SettingsTab';

const chatbot = makeChatbot({ slug: 'order-bot', status: 'ACTIVE' });

// vitest는 vi.mock 팩토리 내부에서 바깥 스코프 변수를 참조할 때 "mock" 접두어가 붙은
// 변수만 호이스팅 예외로 허용한다 — 아래 변수명이 모두 mock으로 시작하는 이유.
const mockContext: ChatbotDetailContext = {
  chatbot,
  reload: vi.fn().mockResolvedValue(undefined),
  setUnsavedGuard: vi.fn(),
};

const mockEmbedCode = vi.fn().mockResolvedValue({
  pc: '<script data-chatbot="order-bot"></script>',
  mobile: '<script data-chatbot="order-bot" data-mode="mobile"></script>',
  publicUrl: 'https://widget.example.com/c/order-bot',
  scriptUrl: 'https://widget.example.com/widget.js',
});
const mockSlugAvailable = vi
  .fn()
  .mockResolvedValue({ slug: 'order-bot-v2', available: true, message: '사용 가능한 고유 URL입니다.' });
const mockUpdateSettings = vi.fn();

vi.mock('../ChatbotDetailLayout', () => ({
  useChatbotDetailContext: () => mockContext,
}));

vi.mock('../../api/chatbots', () => ({
  chatbotsApi: {
    embedCode: (...args: unknown[]) => mockEmbedCode(...args),
    slugAvailable: (...args: unknown[]) => mockSlugAvailable(...args),
    updateSettings: (...args: unknown[]) => mockUpdateSettings(...args),
  },
}));

function renderSettingsTab(): ReturnType<typeof render> {
  return render(
    <ToastProvider>
      <SettingsTab />
    </ToastProvider>,
  );
}

/**
 * AC-3-7/FR-3-8: slug 변경 시 저장 전 경고 모달이 먼저 표시되고, 확인해야만 PATCH가 전송된다.
 * AC-5-5: Esc로 취소하면 아무 변경도 발생하지 않는다.
 * code-reviewer 지목 항목 (b) "slug 변경 경고 모달"의 핵심 커버리지.
 */
describe('SettingsTab — slug 변경 경고 모달 (AC-3-7)', () => {
  beforeEach(() => {
    mockUpdateSettings.mockReset();
    mockUpdateSettings.mockResolvedValue({
      ...chatbot,
      slug: 'order-bot-v2',
      updatedAt: new Date('2026-09-19T01:00:00.000Z'),
    });
  });

  it('slug를 변경하지 않고 저장하면 경고 모달 없이 바로 저장된다', async () => {
    const user = userEvent.setup();
    renderSettingsTab();

    const nameInput = await screen.findByLabelText('이름 *');
    await user.clear(nameInput);
    await user.type(nameInput, '주문 상담봇(수정)');

    await user.click(screen.getByRole('button', { name: '저장' }));

    expect(screen.queryByRole('dialog', { name: '고유 URL 변경 확인' })).not.toBeInTheDocument();
    await waitFor(() => expect(mockUpdateSettings).toHaveBeenCalledWith(chatbot.id, { name: '주문 상담봇(수정)' }));
  });

  it('slug를 변경 후 저장을 누르면 경고 모달이 먼저 뜨고, PATCH는 아직 전송되지 않는다', async () => {
    const user = userEvent.setup();
    renderSettingsTab();

    const slugInput = await screen.findByLabelText('고유 URL(slug) *');
    await user.clear(slugInput);
    await user.type(slugInput, 'order-bot-v2');

    await user.click(screen.getByRole('button', { name: '저장' }));

    const dialog = await screen.findByRole('dialog', { name: '고유 URL 변경 확인' });
    expect(dialog).toHaveTextContent('기존에 배포된 임베드 코드와 공유 링크가 더 이상 동작하지 않을 수 있습니다');
    expect(mockUpdateSettings).not.toHaveBeenCalled();
  });

  it('경고 모달에서 Esc를 누르면 취소되고 PATCH가 전송되지 않는다(AC-5-5)', async () => {
    const user = userEvent.setup();
    renderSettingsTab();

    const slugInput = await screen.findByLabelText('고유 URL(slug) *');
    await user.clear(slugInput);
    await user.type(slugInput, 'order-bot-v2');
    await user.click(screen.getByRole('button', { name: '저장' }));

    await screen.findByRole('dialog', { name: '고유 URL 변경 확인' });
    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(mockUpdateSettings).not.toHaveBeenCalled();
  });

  it('경고 모달에서 "변경 후 저장"을 확인하면 그제서야 PATCH가 전송되고 저장 완료 토스트가 뜬다', async () => {
    const user = userEvent.setup();
    renderSettingsTab();

    const slugInput = await screen.findByLabelText('고유 URL(slug) *');
    await user.clear(slugInput);
    await user.type(slugInput, 'order-bot-v2');
    await user.click(screen.getByRole('button', { name: '저장' }));

    await screen.findByRole('dialog', { name: '고유 URL 변경 확인' });
    await user.click(screen.getByRole('button', { name: '변경 후 저장' }));

    await waitFor(() => expect(mockUpdateSettings).toHaveBeenCalledWith(chatbot.id, { slug: 'order-bot-v2' }));
    expect(await screen.findByText('저장되었습니다.')).toBeInTheDocument();
  });
});
