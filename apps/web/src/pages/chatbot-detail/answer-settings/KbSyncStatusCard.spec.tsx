import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { KbSyncStatusCard } from './KbSyncStatusCard';

const mockGet = vi.fn();

vi.mock('../../../api/kbChatbotStatus', () => ({
  chatbotKbStatusApi: { get: (...args: unknown[]) => mockGet(...args) },
}));

/** KB10 — 챗봇 답변 설정: 지식베이스 동기화 상태 카드(kb-crawling-ui-spec.md §3.7). */
describe('KbSyncStatusCard', () => {
  beforeEach(() => {
    mockGet.mockReset();
  });

  it('소스가 있으면 소스 수·마지막 동기화·정리 필요 건수를 보여준다', async () => {
    mockGet.mockResolvedValue({
      sources: [
        { id: 's1', name: '인사규정 게시판', lastRunStatus: 'SUCCEEDED', lastSyncedAt: new Date(Date.now() - 2 * 60 * 60 * 1000), needsCleanupCount: 0 },
        { id: 's2', name: '사내 공지 크롤러', lastRunStatus: 'SUCCEEDED', lastSyncedAt: new Date(Date.now() - 24 * 60 * 60 * 1000), needsCleanupCount: 1 },
      ],
      environmentModeOn: true,
    });
    render(<KbSyncStatusCard chatbotId="c1" />);

    expect(await screen.findByText('이 스코프로 자동 수집하는 소스 2개')).toBeInTheDocument();
    expect(screen.getByText(/인사규정 게시판/)).toBeInTheDocument();
    expect(screen.getByText(/정리 필요 1/)).toBeInTheDocument();
    expect(screen.getByText(/지식베이스 동기화는 환경\(스테이징\/운영\)과 무관하게 즉시 반영됩니다/)).toBeInTheDocument();
  });

  it('이 스코프를 읽는 소스가 0개면 안내 문구를 보여준다', async () => {
    mockGet.mockResolvedValue({ sources: [], environmentModeOn: false });
    render(<KbSyncStatusCard chatbotId="c1" />);

    expect(await screen.findByText('이 스코프로 자동 수집하는 소스가 없습니다.')).toBeInTheDocument();
    expect(screen.queryByText(/즉시 반영됩니다/)).not.toBeInTheDocument();
  });

  it('조회 실패(기능 꺼짐 404 포함)면 카드를 조용히 생략한다(오류 표시 없음)', async () => {
    mockGet.mockRejectedValue(new Error('404'));
    const { container } = render(<KbSyncStatusCard chatbotId="c1" />);

    await waitFor(() => expect(container.querySelector('.kb-sync-status-card')).not.toBeInTheDocument());
    expect(container.textContent).toBe('');
  });
});
