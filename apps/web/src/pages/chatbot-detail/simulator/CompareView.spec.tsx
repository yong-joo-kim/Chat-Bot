import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CompareResponse, DialogueOverlay } from '@chat-bot/shared-types';
import { CompareView } from './CompareView';

const mockCompare = vi.fn();
vi.mock('../../../api/simulation', () => ({
  simulationApi: {
    simulate: vi.fn(),
    compare: (...args: unknown[]) => mockCompare(...args),
  },
}));

function makeCompareResponse(overrides: Partial<CompareResponse> = {}): CompareResponse {
  return {
    turns: [
      {
        index: 0,
        message: '배송 조회',
        a: { outputs: [{ type: 'TEXT', payload: { text: '배송은 2~3일 소요됩니다' } }], unsupportedOutputs: [], trace: [] },
        b: { outputs: [{ type: 'TEXT', payload: { text: '배송은 2~3일 소요됩니다' } }], unsupportedOutputs: [], trace: [] },
        diff: { status: 'SAME', outputsChanged: false, matchChanged: false },
      },
      {
        index: 1,
        message: '환불',
        a: { outputs: [{ type: 'TEXT', payload: { text: '환불은 영업일 기준 5일' } }], unsupportedOutputs: [], trace: [] },
        b: { outputs: [{ type: 'TEXT', payload: { text: '환불은 영업일 기준 3일' } }], unsupportedOutputs: [], trace: [] },
        diff: { status: 'DIFFERENT', outputsChanged: true, matchChanged: false },
      },
    ],
    summary: { total: 2, same: 1, different: 1 },
    elapsedMs: 12,
    resolvedAt: new Date('2026-09-20T00:00:00.000Z'),
  } as CompareResponse;
}

const overlay: DialogueOverlay = { dialogNodes: [{ id: 'draft-1' } as never] };

function renderCompare(overlayArg: DialogueOverlay | undefined): ReturnType<typeof render> {
  return render(<CompareView chatbotId="bot-1" overlay={overlayArg} />);
}

describe('CompareView — A/B 비교 diff 표시(FR-10-25~30, AC-10B-7/8)', () => {
  beforeEach(() => {
    mockCompare.mockReset();
  });

  it('오버레이가 없으면 비교 실행이 차단되고 안내가 표시된다(FR-10-31, AC-10B-10)', () => {
    renderCompare(undefined);
    expect(screen.getByText(/비교할 변경 내용이 없습니다/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '비교 실행' })).toHaveAttribute('aria-disabled', 'true');
  });

  it('비교 실행 후 요약과 변경된 행에만 "변경됨" 배지가 표시된다', async () => {
    mockCompare.mockResolvedValue(makeCompareResponse());
    renderCompare(overlay);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText('문장 입력(줄바꿈으로 구분, 최대 20건)'), '배송 조회\n환불');
    await user.click(screen.getByRole('button', { name: '비교 실행' }));

    expect(await screen.findByText('완료 · 2턴 · 차이 1건')).toBeInTheDocument();
    expect(mockCompare).toHaveBeenCalledWith('bot-1', expect.objectContaining({ messages: ['배송 조회', '환불'], overlay }));

    // 변경된 행("환불")에만 배지가 붙고, 동일한 행("배송 조회")에는 배지가 없다(NFR-A2 — 노이즈 최소화).
    const changedBadges = screen.getAllByText('변경됨');
    expect(changedBadges).toHaveLength(1);

    expect(screen.getByText('1. 배송 조회', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('2. 환불', { exact: false })).toBeInTheDocument();
  });

  it('"달라진 것만 보기"를 체크하면 SAME 행이 숨겨진다(재요청 없음)', async () => {
    mockCompare.mockResolvedValue(makeCompareResponse());
    renderCompare(overlay);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText('문장 입력(줄바꿈으로 구분, 최대 20건)'), '배송 조회\n환불');
    await user.click(screen.getByRole('button', { name: '비교 실행' }));
    await screen.findByText('완료 · 2턴 · 차이 1건');

    await user.click(screen.getByRole('checkbox', { name: '달라진 것만 보기' }));

    expect(screen.queryByText('1. 배송 조회', { exact: false })).not.toBeInTheDocument();
    expect(screen.getByText('2. 환불', { exact: false })).toBeInTheDocument();
    expect(mockCompare).toHaveBeenCalledTimes(1);
  });
});
