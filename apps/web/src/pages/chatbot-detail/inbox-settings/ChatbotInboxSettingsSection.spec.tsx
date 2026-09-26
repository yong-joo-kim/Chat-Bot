import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider } from '../../../components/Toast';
import { ChatbotInboxSettingsSection } from './ChatbotInboxSettingsSection';
import { inboxApi } from '../../../api/inbox';
import type { ChatbotInboxSettingsResponse } from '@chat-bot/shared-types';

let mockPermissions = { chatbotWrite: true, securityWrite: true };
vi.mock('../../../context/AuthContext', () => ({
  useAuth: () => ({
    can: (p: string) => (p === 'chatbot:write' ? mockPermissions.chatbotWrite : p === 'security:write' ? mockPermissions.securityWrite : true),
  }),
}));

vi.mock('../../../api/inbox', () => ({
  inboxApi: { settings: { get: vi.fn(), update: vi.fn(), updateIdentity: vi.fn() }, identitySpaces: vi.fn() },
}));

function makeSettings(overrides: Partial<ChatbotInboxSettingsResponse> = {}): ChatbotInboxSettingsResponse {
  return {
    chatbotId: 'bot-1',
    enabled: false,
    openOnWarning: false,
    identity: {
      secretRef: null,
      secretStatus: 'NOT_SET',
      customerKeyStatus: 'CONFIGURED',
      keyFingerprintChanged: false,
      stats24h: {
        verified: 0,
        failures: { MALFORMED: 0, SIGNATURE: 0, EXPIRED: 0, NOT_YET_VALID: 0, TTL_TOO_LONG: 0, SECRET_MISSING: 0, CONFLICT: 0 },
        scope: 'INSTANCE',
      },
    },
    environmentNotice: 'OUTSIDE_ENVIRONMENT',
    updatedAt: null,
    ...overrides,
  };
}

function renderSection(isArchived = false): ReturnType<typeof render> {
  return render(
    <ToastProvider>
      <ChatbotInboxSettingsSection chatbotId="bot-1" isArchived={isArchived} />
    </ToastProvider>,
  );
}

describe('ChatbotInboxSettingsSection(OI-9)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPermissions = { chatbotWrite: true, securityWrite: true };
    vi.mocked(inboxApi.identitySpaces).mockResolvedValue([]);
  });

  it('조회 성공 시 참여·경고·식별 상태를 보여준다', async () => {
    vi.mocked(inboxApi.settings.get).mockResolvedValue(makeSettings());
    renderSection();

    expect(await screen.findByText('통합 인박스 참여')).toBeInTheDocument();
    expect(screen.getByText('미지정')).toBeInTheDocument();
  });

  it('chatbot:write가 없으면(EDITOR·VIEWER) 참여 스위치가 비활성화된다', async () => {
    mockPermissions = { chatbotWrite: false, securityWrite: false };
    vi.mocked(inboxApi.settings.get).mockResolvedValue(makeSettings());
    renderSection();

    await screen.findByText('통합 인박스 참여');
    expect(screen.getByLabelText('통합 인박스 참여')).toBeDisabled();
    expect(screen.queryByRole('textbox', { name: '식별 비밀 참조' })).not.toBeInTheDocument();
  });

  it('security:write가 있으면 식별 비밀 참조를 입력하고 별도 버튼으로 저장한다', async () => {
    const user = userEvent.setup();
    vi.mocked(inboxApi.settings.get).mockResolvedValue(makeSettings());
    vi.mocked(inboxApi.settings.updateIdentity).mockResolvedValue(makeSettings({ identity: { ...makeSettings().identity, secretRef: 'SHOPMALL', secretStatus: 'CONFIGURED' } }));
    renderSection();

    await screen.findByText('통합 인박스 참여');
    const input = screen.getByLabelText('식별 비밀 참조');
    await user.type(input, 'SHOPMALL');
    const saveButtons = screen.getAllByRole('button', { name: '저장' });
    await user.click(saveButtons[saveButtons.length - 1]);

    expect(inboxApi.settings.updateIdentity).toHaveBeenCalledWith('bot-1', { identitySecretRef: 'SHOPMALL' });
    expect(inboxApi.settings.update).not.toHaveBeenCalled();
  });

  it('형식에 맞지 않는 식별 비밀 참조는 인라인 오류를 보여주고 저장을 막는다', async () => {
    const user = userEvent.setup();
    vi.mocked(inboxApi.settings.get).mockResolvedValue(makeSettings());
    renderSection();

    await screen.findByText('통합 인박스 참여');
    const input = screen.getByLabelText('식별 비밀 참조');
    await user.type(input, 'shopmall!!');
    const saveButtons = screen.getAllByRole('button', { name: '저장' });
    await user.click(saveButtons[saveButtons.length - 1]);

    expect(inboxApi.settings.updateIdentity).not.toHaveBeenCalled();
  });

  it('같은 참조를 쓰는 다른 챗봇이 있으면 안내 줄을 보여준다(2026-09-26 계약 보강)', async () => {
    vi.mocked(inboxApi.settings.get).mockResolvedValue(makeSettings({ identity: { ...makeSettings().identity, secretRef: 'SHOPMALL', secretStatus: 'CONFIGURED' } }));
    vi.mocked(inboxApi.identitySpaces).mockResolvedValue([
      { ref: 'SHOPMALL', chatbots: [{ id: 'bot-1', name: '이 챗봇' }, { id: 'bot-2', name: '회원혜택봇' }] },
    ]);
    renderSection();

    expect(await screen.findByText('같은 참조를 쓰는 다른 챗봇: 회원혜택봇')).toBeInTheDocument();
  });

  it('자기 자신만 있고 다른 챗봇이 없으면 안내 줄이 보이지 않는다', async () => {
    vi.mocked(inboxApi.settings.get).mockResolvedValue(makeSettings({ identity: { ...makeSettings().identity, secretRef: 'SHOPMALL', secretStatus: 'CONFIGURED' } }));
    vi.mocked(inboxApi.identitySpaces).mockResolvedValue([{ ref: 'SHOPMALL', chatbots: [{ id: 'bot-1', name: '이 챗봇' }] }]);
    renderSection();

    await screen.findByText('통합 인박스 참여');
    expect(screen.queryByText(/같은 참조를 쓰는 다른 챗봇/)).not.toBeInTheDocument();
  });

  it('식별 실패 통계 7종을 방어 코드 없이 그대로 표시한다', async () => {
    vi.mocked(inboxApi.settings.get).mockResolvedValue(
      makeSettings({
        identity: {
          ...makeSettings().identity,
          stats24h: {
            verified: 128,
            failures: { MALFORMED: 0, SIGNATURE: 3, EXPIRED: 5, NOT_YET_VALID: 0, TTL_TOO_LONG: 0, SECRET_MISSING: 0, CONFLICT: 1 },
            scope: 'INSTANCE',
          },
        },
      }),
    );
    renderSection();

    expect(await screen.findByText(/성공 128/)).toBeInTheDocument();
    expect(screen.getByText(/서명불일치 3/)).toBeInTheDocument();
    expect(screen.getByText(/만료 5/)).toBeInTheDocument();
    expect(screen.getByText(/충돌 1/)).toBeInTheDocument();
  });
});
