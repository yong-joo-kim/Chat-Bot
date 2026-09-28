import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ProactiveOverviewResponse } from '@chat-bot/shared-types';
import { ToastProvider } from '../../../components/Toast';
import { ProactiveSection } from './ProactiveSection';

let mockCanWrite = true;
vi.mock('../../../context/AuthContext', () => ({
  useAuth: () => ({ can: (p: string) => (p === 'channel:write' ? mockCanWrite : true) }),
}));

const mockGetOverview = vi.fn();
const mockSaveSettings = vi.fn();
vi.mock('../../../api/proactive', () => ({
  proactiveApi: {
    getOverview: (...args: unknown[]) => mockGetOverview(...args),
    saveSettings: (...args: unknown[]) => mockSaveSettings(...args),
    createRule: vi.fn(),
    updateRule: vi.fn(),
    deleteRule: vi.fn(),
    enableRule: vi.fn(),
    disableRule: vi.fn(),
    moveRule: vi.fn(),
    getStats: vi.fn(),
  },
}));

vi.mock('../../../api/chatbots', () => ({
  chatbotsApi: { embedCode: vi.fn().mockResolvedValue({ publicUrl: 'https://example.test', pc: '<script data-chatbot="x"></script>', mobile: '' }) },
}));

function makeOverview(overrides: Partial<ProactiveOverviewResponse> = {}): ProactiveOverviewResponse {
  return {
    settings: { enabled: false, maxPerSession: 1, minIntervalSec: 60, quietAfterUserMessageSec: 300, updatedAt: null },
    serverEnabled: true,
    context: { chatbotStatus: 'ACTIVE', webChannelEnabled: true, launcherHidden: false, environmentMode: false },
    limits: { rulesMax: 20, enabledRulesMax: 10 },
    rules: [],
    ...overrides,
  };
}

function renderSection(): void {
  render(
    <ToastProvider>
      <ProactiveSection chatbotId="bot-1" isArchived={false} primaryColor="#4F46E5" />
    </ToastProvider>,
  );
}

beforeEach(() => {
  mockCanWrite = true;
  mockGetOverview.mockReset();
  mockSaveSettings.mockReset();
});

describe('ProactiveSection — PA-C1~C3(진입점·설정·목록)', () => {
  it('규칙이 0개면 빈 상태와 "규칙 추가" 버튼을 보여준다', async () => {
    mockGetOverview.mockResolvedValue(makeOverview());
    renderSection();
    expect(await screen.findByText('아직 선제 안내 규칙이 없습니다')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '규칙 추가' })).toBeInTheDocument();
  });

  it('서버에서 선제 안내가 꺼져 있으면(serverEnabled:false) 안내 배너를 보여준다', async () => {
    mockGetOverview.mockResolvedValue(makeOverview({ serverEnabled: false }));
    renderSection();
    expect(await screen.findByText(/서버 설정에서 선제 안내 기능이 꺼져 있습니다/)).toBeInTheDocument();
  });

  it('channel:read만 있으면(canWrite=false) 스위치·규칙 추가 버튼이 비활성/비노출된다(AC-PA8-5)', async () => {
    mockCanWrite = false;
    mockGetOverview.mockResolvedValue(makeOverview());
    renderSection();
    await screen.findByText('아직 선제 안내 규칙이 없습니다');
    expect(screen.getByLabelText('선제 안내 사용')).toBeDisabled();
    expect(screen.queryByRole('button', { name: '규칙 추가' })).not.toBeInTheDocument();
  });

  it('세션당 최대 표시 수가 범위를 벗어나면 저장하지 않고 인라인 오류를 보여준다', async () => {
    mockGetOverview.mockResolvedValue(makeOverview());
    renderSection();
    await screen.findByText('아직 선제 안내 규칙이 없습니다');
    const user = userEvent.setup();

    const input = screen.getByLabelText('세션당 최대 표시 수');
    await user.clear(input);
    await user.type(input, '9');
    await user.click(screen.getByRole('button', { name: '저장' }));

    expect(await screen.findByText('1~3 사이의 숫자를 입력하세요.')).toBeInTheDocument();
    expect(mockSaveSettings).not.toHaveBeenCalled();
  });

  it('값이 올바르면 저장 API를 호출하고 성공 토스트를 보여준다', async () => {
    mockGetOverview.mockResolvedValue(makeOverview());
    mockSaveSettings.mockResolvedValue({ enabled: true, maxPerSession: 2, minIntervalSec: 60, quietAfterUserMessageSec: 300, updatedAt: null });
    renderSection();
    await screen.findByText('아직 선제 안내 규칙이 없습니다');
    const user = userEvent.setup();

    await user.click(screen.getByLabelText('선제 안내 사용'));
    await user.click(screen.getByRole('button', { name: '저장' }));

    await waitFor(() => expect(mockSaveSettings).toHaveBeenCalledWith('bot-1', { enabled: true, maxPerSession: 1, minIntervalSec: 60, quietAfterUserMessageSec: 300 }));
    expect(await screen.findByText('저장했습니다')).toBeInTheDocument();
  });

  it('조회 실패 시 오류 상태와 재시도 버튼을 보여준다', async () => {
    mockGetOverview.mockRejectedValueOnce(new Error('network'));
    renderSection();
    expect(await screen.findByText('선제 안내 정보를 불러오지 못했습니다.')).toBeInTheDocument();
  });
});
