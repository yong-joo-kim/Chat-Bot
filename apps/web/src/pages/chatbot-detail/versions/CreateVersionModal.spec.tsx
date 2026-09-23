import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CreateChatbotVersionResponse } from '@chat-bot/shared-types';
import { ApiError } from '../../../api/client';
import { CreateVersionModal } from './CreateVersionModal';

const mockCreate = vi.fn();
const mockUpdate = vi.fn();

vi.mock('../../../api/versions', () => ({
  versionsApi: {
    create: (...args: unknown[]) => mockCreate(...args),
    update: (...args: unknown[]) => mockUpdate(...args),
  },
}));

function renderModal(onCreated = vi.fn(), onClose = vi.fn()): ReturnType<typeof render> {
  return render(<CreateVersionModal chatbotId="bot-1" isOpen onClose={onClose} onCreated={onCreated} />);
}

/**
 * L1 수동 저장 모달(`version-history-ui-spec.md` §4.1.1, AC-H1-2). 이전에는 전용 컴포넌트
 * 시험이 없었다(2026-09-23 신규 — No.25 커버리지 공백 보강). `unchanged:true` 단축 흐름
 * (라벨/메모를 기존 최신 버전에 PATCH)까지 포함한다.
 */
describe('CreateVersionModal', () => {
  beforeEach(() => {
    mockCreate.mockReset();
    mockUpdate.mockReset();
  });

  it('라벨/메모를 입력해 저장하면 create()가 호출되고, 성공(unchanged:false) 시 onCreated가 versionNo로 호출된다', async () => {
    const response: CreateChatbotVersionResponse = {
      unchanged: false,
      version: {
        id: 'ver-5',
        versionNo: 5,
        trigger: 'MANUAL',
        triggerLabel: '수동 저장',
        triggerContext: null,
        schemaVersion: 1,
        schemaSupported: true,
        contentHash: 'a'.repeat(64),
        counts: {
          intents: 1,
          intentExamples: 1,
          keywords: 0,
          homonyms: 0,
          contexts: 0,
          dialogNodes: 0,
          nodeIntentLinks: 0,
          nodeKeywordLinks: 0,
          faqs: 0,
          answerSetting: 0,
        },
        sizeBytes: 100,
        integrityWarningCount: 0,
        label: '5월 개편 전',
        memo: null,
        pinned: false,
        restoredFromVersionNo: null,
        createdById: 'user-1',
        createdByEmail: 'editor@chat-bot.local',
        createdAt: new Date('2026-09-20T09:51:00.000Z'),
        updatedAt: new Date('2026-09-20T09:51:00.000Z'),
        integrityWarnings: [],
        payloadStatus: 'OK',
      },
    };
    mockCreate.mockResolvedValue(response);
    const onCreated = vi.fn();
    renderModal(onCreated);

    const user = userEvent.setup();
    await user.type(screen.getByLabelText('라벨'), '5월 개편 전');
    await user.type(screen.getByLabelText('메모'), '대규모 개편 직전 저장');
    await user.click(screen.getByRole('button', { name: '저장' }));

    await waitFor(() =>
      expect(mockCreate).toHaveBeenCalledWith('bot-1', { label: '5월 개편 전', memo: '대규모 개편 직전 저장' }),
    );
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(5));
  });

  it('unchanged:true면 모달을 닫지 않고 안내로 전환하며, onCreated는 호출되지 않는다(AC-H1-2)', async () => {
    mockCreate.mockResolvedValue({ unchanged: true, latestVersionNo: 9, latestVersionId: 'ver-9' } satisfies CreateChatbotVersionResponse);
    const onCreated = vi.fn();
    renderModal(onCreated);

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: '저장' }));

    expect(await screen.findByRole('status')).toHaveTextContent('직전 버전(v9)과 내용이 같아 새로 저장하지 않았습니다.');
    expect(onCreated).not.toHaveBeenCalled();
  });

  it('unchanged 상태에서 라벨을 입력해 둔 뒤 단축 버튼을 누르면 기존 최신 버전에 update()가 호출된다(단축 흐름)', async () => {
    mockCreate.mockResolvedValue({ unchanged: true, latestVersionNo: 9, latestVersionId: 'ver-9' } satisfies CreateChatbotVersionResponse);
    mockUpdate.mockResolvedValue({});
    const onCreated = vi.fn();
    renderModal(onCreated);

    const user = userEvent.setup();
    await user.type(screen.getByLabelText('라벨'), '캠페인 전');
    await user.click(screen.getByRole('button', { name: '저장' }));

    const shortcutButton = await screen.findByRole('button', { name: 'v9에 라벨/메모 달기' });
    await user.click(shortcutButton);

    await waitFor(() => expect(mockUpdate).toHaveBeenCalledWith('bot-1', 'ver-9', { label: '캠페인 전', memo: undefined }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(9));
  });

  it('unchanged 상태에서 라벨/메모를 입력하지 않았으면 단축 버튼이 렌더되지 않는다', async () => {
    mockCreate.mockResolvedValue({ unchanged: true, latestVersionNo: 9, latestVersionId: 'ver-9' } satisfies CreateChatbotVersionResponse);
    renderModal();

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: '저장' }));

    await screen.findByRole('status');
    expect(screen.queryByRole('button', { name: /라벨\/메모 달기/ })).not.toBeInTheDocument();
  });

  it('VERSION_SNAPSHOT_TOO_LARGE 오류는 전용 문구로 표시된다', async () => {
    mockCreate.mockRejectedValue(new ApiError(422, '스냅샷 크기가 상한을 초과합니다.', 'VERSION_SNAPSHOT_TOO_LARGE'));
    renderModal();

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: '저장' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('저장할 수 없습니다 — 자산 크기가 상한(20MB)을 초과합니다.');
  });

  it('그 외 오류는 서버 메시지를 그대로 표시한다', async () => {
    mockCreate.mockRejectedValue(new ApiError(500, '일시적인 오류가 발생했습니다.'));
    renderModal();

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: '저장' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('일시적인 오류가 발생했습니다.');
  });

  it('취소 버튼을 누르면 onClose가 호출되고 create()는 호출되지 않는다', async () => {
    const onClose = vi.fn();
    renderModal(vi.fn(), onClose);

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: '취소' }));

    expect(onClose).toHaveBeenCalled();
    expect(mockCreate).not.toHaveBeenCalled();
  });
});
