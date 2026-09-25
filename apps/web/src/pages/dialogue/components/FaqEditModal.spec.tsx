import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { DialogueOverlay, EnvironmentStatus } from '@chat-bot/shared-types';
import { ToastProvider } from '../../../components/Toast';
import { FaqEditModal } from './FaqEditModal';

// [R1 L-1] `environmentStatus`가 `SimulatorDrawer`까지 전달되는지 확인하려고 켜진 상태로 둔다.
const ENV_ENABLED: EnvironmentStatus = {
  enabled: true,
  enabledAt: new Date('2026-09-20T00:00:00.000Z'),
  prod: { versionId: 'ver-43', versionNo: 43, capturedAt: new Date(), label: null, switchedAt: new Date(), legacyTiebreak: false, readFailed: false, semanticPending: 0 },
  staging: { versionId: 'ver-44', versionNo: 44, capturedAt: new Date(), label: null, legacyTiebreak: false, semanticPending: 0 },
  draft: { contentHash: 'a'.repeat(64), sameAsProd: false, sameAsStaging: false },
  gate: { mode: 'WARN', testSetId: null, minPassRate: 95, validHours: 24 },
  activeSwitchSchedule: null,
} as EnvironmentStatus;

const mockFindOne = vi.fn();
const mockSuggest = vi.fn();
vi.mock('../../../api/dialogue', () => ({
  faqsApi: {
    findOne: (...args: unknown[]) => mockFindOne(...args),
    suggest: (...args: unknown[]) => mockSuggest(...args),
    create: vi.fn(),
    update: vi.fn(),
  },
}));

let capturedDrawerProps: { isOpen: boolean; overlay?: DialogueOverlay; environmentStatus?: EnvironmentStatus | null } | undefined;
vi.mock('../../chatbot-detail/simulator/SimulatorDrawer', () => ({
  SimulatorDrawer: (props: { isOpen: boolean; overlay?: DialogueOverlay; environmentStatus?: EnvironmentStatus | null }) => {
    capturedDrawerProps = props;
    if (!props.isOpen) return null;
    return <div data-testid="sim-drawer-stub">드로어 열림</div>;
  },
}));

function renderModal(): ReturnType<typeof render> {
  return render(
    <ToastProvider>
      <FaqEditModal isOpen chatbotId="bot-1" faqId={null} onClose={vi.fn()} onSaved={vi.fn()} environmentStatus={ENV_ENABLED} />
    </ToastProvider>,
  );
}

/** SIM1-D 드로어 진입 지점 3/3 — FAQ 편집 모달(FR-10-17/23, ui-spec §4.2). */
describe('FaqEditModal — SIM1-D 드로어 진입("이 설정으로 테스트")', () => {
  beforeEach(() => {
    mockFindOne.mockReset();
    mockSuggest.mockReset().mockResolvedValue([]);
    capturedDrawerProps = undefined;
  });

  it('버튼을 누르면 현재 질문/답변 초안이 오버레이로 직렬화되어 드로어가 열린다', async () => {
    renderModal();
    expect(capturedDrawerProps?.isOpen).toBe(false);

    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/^질문/), '영업시간이 어떻게 되나요?');
    await user.type(screen.getByLabelText(/^답변/), '평일 09:00~18:00입니다.');
    await user.click(screen.getByRole('button', { name: '이 설정으로 테스트' }));

    expect(screen.getByTestId('sim-drawer-stub')).toBeInTheDocument();
    expect(capturedDrawerProps?.overlay?.faqs?.[0]).toMatchObject({
      id: 'draft-1',
      question: '영업시간이 어떻게 되나요?',
      answer: '평일 09:00~18:00입니다.',
    });
  });

  // [R1 L-1] `environmentStatus` prop이 `SimulatorDrawer`까지 그대로 전달돼야 오버레이 모드에서
  // 대상 컨트롤이 aria-disabled로 보인다(§4.13, AC-EN6-2).
  it('environmentStatus prop을 SimulatorDrawer에 그대로 넘긴다', async () => {
    renderModal();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: '이 설정으로 테스트' }));

    expect(capturedDrawerProps?.environmentStatus).toBe(ENV_ENABLED);
  });

  it('모달을 닫아도 드로어가 항상 함께 닫힌다(SimulatorDrawer 내부 useEffect)', async () => {
    const { rerender } = render(
      <ToastProvider>
        <FaqEditModal isOpen chatbotId="bot-1" faqId={null} onClose={vi.fn()} onSaved={vi.fn()} />
      </ToastProvider>,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: '이 설정으로 테스트' }));
    expect(capturedDrawerProps?.isOpen).toBe(true);

    rerender(
      <ToastProvider>
        <FaqEditModal isOpen={false} chatbotId="bot-1" faqId={null} onClose={vi.fn()} onSaved={vi.fn()} />
      </ToastProvider>,
    );
    expect(capturedDrawerProps?.isOpen).toBe(false);
  });
});
