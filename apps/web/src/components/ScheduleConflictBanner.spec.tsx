import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { DeployScheduleNotice } from '@chat-bot/shared-types';
import { makeDeployScheduleMeta } from '../test/fixtures';
import { resetDeployScheduleMetaCacheForTests } from '../lib/useDeployScheduleMeta';
import { ScheduleConflictBanner } from './ScheduleConflictBanner';

const mockNotice = vi.fn();
const mockMeta = vi.fn();
vi.mock('../api/deploySchedules', () => ({
  deploySchedulesApi: {
    notice: (...args: unknown[]) => mockNotice(...args),
    meta: (...args: unknown[]) => mockMeta(...args),
  },
}));

function baseNotice(overrides: Partial<DeployScheduleNotice> = {}): DeployScheduleNotice {
  return {
    upcomingRestore: null,
    activeCount: 0,
    ...overrides,
  };
}

/**
 * E4 — 대화 자산 편집 화면군 공용 배너(`scheduled-deploy-ui-spec.md` §4.6.2). 마운트 시 1회
 * `notice`를 조회하고, `upcomingRestore`가 있을 때만 배너를 렌더한다(저장을 막지 않는다).
 */
describe('ScheduleConflictBanner', () => {
  beforeEach(() => {
    mockNotice.mockReset();
    mockMeta.mockReset();
    mockMeta.mockResolvedValue(makeDeployScheduleMeta());
    resetDeployScheduleMetaCacheForTests();
  });

  it('upcomingRestore가 null이면(예약 없음) 아무것도 렌더하지 않는다', async () => {
    mockNotice.mockResolvedValue(baseNotice());
    const { container } = render(
      <MemoryRouter>
        <ScheduleConflictBanner chatbotId="bot-1" />
      </MemoryRouter>,
    );

    await waitFor(() => expect(mockNotice).toHaveBeenCalledWith('bot-1'));
    expect(container).toBeEmptyDOMElement();
  });

  it('upcomingRestore가 있으면 예정 시각·버전·예약 배포 링크를 포함한 경고 배너를 렌더한다', async () => {
    mockNotice.mockResolvedValue(
      baseNotice({
        upcomingRestore: { scheduleId: 'sched-1', scheduledAt: new Date('2027-11-01T00:00:00+09:00'), status: 'PENDING', targetVersionNo: 30, chainLength: 1 },
        activeCount: 1,
      }),
    );
    render(
      <MemoryRouter>
        <ScheduleConflictBanner chatbotId="bot-1" />
      </MemoryRouter>,
    );

    expect(await screen.findByText(/이 챗봇에 예약된 복원이 있습니다/)).toBeInTheDocument();
    expect(screen.getByText(/v30/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '예약 배포에서 보기 →' })).toHaveAttribute('href', '/chatbots/bot-1/deploy-schedules');
  });

  it('체인 길이가 1보다 크면 "외 n건"이 함께 표시된다', async () => {
    mockNotice.mockResolvedValue(
      baseNotice({
        upcomingRestore: { scheduleId: 'sched-1', scheduledAt: new Date('2027-11-01T00:00:00+09:00'), status: 'PENDING', targetVersionNo: 30, chainLength: 3 },
        activeCount: 3,
      }),
    );
    render(
      <MemoryRouter>
        <ScheduleConflictBanner chatbotId="bot-1" />
      </MemoryRouter>,
    );

    expect(await screen.findByText(/외 2건/)).toBeInTheDocument();
  });

  it('조회가 실패하면 조용히 숨기고(화면을 막지 않음) 오류를 띄우지 않는다', async () => {
    mockNotice.mockRejectedValue(new Error('network'));
    const { container } = render(
      <MemoryRouter>
        <ScheduleConflictBanner chatbotId="bot-1" />
      </MemoryRouter>,
    );

    await waitFor(() => expect(mockNotice).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});
