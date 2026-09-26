import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThreadActionPanel, type LinkedConversationRow } from './ThreadActionPanel';
import { makeThreadDetail } from '../../test/inboxFixtures';

/**
 * IDENTITY 연결 분리 UI(§3.2 접근·연결 동작 상세)를 단위로 검증한다(2026-09-26 계약 보강 이후
 * `linkId`가 항상 채워진다 — 통합 경로는 `InboxThreadDetailPage.spec.tsx`에서 함께 검증한다).
 */
const IDENTITY_ROW: LinkedConversationRow = { linkId: 'link-1', chatbotName: '쇼핑봇', channelLabel: '웹', source: 'IDENTITY', sessionRef: 'a'.repeat(16) };

function baseProps(overrides: Partial<Parameters<typeof ThreadActionPanel>[0]> = {}) {
  const detail = makeThreadDetail();
  return {
    detail,
    assignees: [],
    allTags: [],
    isAdmin: false,
    isMine: false,
    canWrite: true,
    canManageTags: false,
    linkedConversations: [IDENTITY_ROW],
    onStatusChange: vi.fn(),
    onClaim: vi.fn(),
    onAssign: vi.fn(),
    onRelease: vi.fn(),
    onSetTags: vi.fn(),
    onOpenNote: vi.fn(),
    onOpenRecord: vi.fn(),
    onOpenLinkForm: vi.fn(),
    onOpenMerge: vi.fn(),
    onUnlink: vi.fn(),
    ...overrides,
  };
}

describe('ThreadActionPanel — IDENTITY 연결 분리(R-11, §3.2)', () => {
  it('ADMIN이 아니면 "분리" 버튼 대신 자물쇠 안내만 보인다', () => {
    render(<ThreadActionPanel {...baseProps({ isAdmin: false })} />);
    expect(screen.getByText('관리자만 해제할 수 있어요')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '분리' })).not.toBeInTheDocument();
  });

  it('ADMIN이면 "분리" 버튼이 보이고, 클릭해도 onUnlink를 곧바로 호출하지 않는다(호출부가 확인 모달을 띄운다)', async () => {
    const user = userEvent.setup();
    const onUnlink = vi.fn();
    render(<ThreadActionPanel {...baseProps({ isAdmin: true, onUnlink })} />);

    const unlinkButton = screen.getByRole('button', { name: '분리' });
    await user.click(unlinkButton);
    expect(onUnlink).toHaveBeenCalledWith('link-1', 'IDENTITY');
  });

  it('MANUAL/SYSTEM 연결은 ADMIN이 아니어도 "분리" 버튼이 바로 보인다', () => {
    const manualRow: LinkedConversationRow = { linkId: 'link-2', chatbotName: '전화', channelLabel: '전화 기록', source: 'MANUAL', sessionRef: 'b'.repeat(16) };
    render(<ThreadActionPanel {...baseProps({ isAdmin: false, linkedConversations: [manualRow] })} />);
    expect(screen.getByRole('button', { name: '분리' })).toBeInTheDocument();
  });

  it('담당자만 놓기 버튼이 활성화된다(본인/ADMIN이 아니면 비활성 + 사유)', () => {
    render(<ThreadActionPanel {...baseProps({ isAdmin: false, isMine: false })} />);
    expect(screen.getByRole('button', { name: '놓기' })).toBeDisabled();
    expect(screen.getByText('담당자만 놓을 수 있어요')).toBeInTheDocument();
  });

  it('병합 버튼은 IDENTIFIED 고객 스레드에서는 렌더되지 않는다', () => {
    const identifiedDetail = makeThreadDetail();
    render(<ThreadActionPanel {...baseProps({ detail: identifiedDetail })} />);
    expect(screen.queryByRole('button', { name: '병합' })).not.toBeInTheDocument();
  });
});
