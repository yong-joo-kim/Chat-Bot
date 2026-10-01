import { forwardRef } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe, toHaveNoViolations } from 'jest-axe';
import type { VoiceOverviewResponse } from '@chat-bot/shared-types';
import { ToastProvider } from '../../../components/Toast';
import { VoiceSection } from './VoiceSection';
import { VoiceGovernanceCard } from './VoiceGovernanceCard';

expect.extend(toHaveNoViolations);

let canWrite = true;
vi.mock('../../../context/AuthContext', () => ({
  useAuth: () => ({ can: (p: string) => (p === 'channel:write' ? canWrite : true) }),
}));
const mockGetOverview = vi.fn();
const mockSave = vi.fn();
vi.mock('../../../api/voice', () => ({
  voiceApi: {
    getOverview: (...a: unknown[]) => mockGetOverview(...a),
    saveSettings: (...a: unknown[]) => mockSave(...a),
    getStats: vi.fn().mockResolvedValue({
      from: '2026-09-25',
      to: '2026-10-01',
      totals: { requested: 3, ok: 2, empty: 1, invalid: 0, failed: 0, busy: 0 },
      daily: [{ day: '2026-10-01', requested: 3, ok: 2, empty: 1, invalid: 0, failed: 0, busy: 0 }],
    }),
  },
}));
vi.mock('../../../api/dialogue', () => ({ dialogNodesApi: { findOne: vi.fn() } }));
vi.mock('../../../components/ResourcePickerField', () => ({
  ResourcePickerField: forwardRef<HTMLInputElement, { id: string; label: string }>(function MockPicker({ id, label }, ref) {
    return (
      <div className="form-field">
        <label htmlFor={id}>{label}</label>
        <input id={id} ref={ref} readOnly />
      </div>
    );
  }),
}));

function overview(over: Partial<VoiceOverviewResponse> = {}): VoiceOverviewResponse {
  return {
    settings: {
      inputEnabled: true,
      ttsEnabled: true,
      autoReadToggleVisible: true,
      rateMultiplier: 1.05,
      defaultTone: 'CALM',
      toneByKind: { UNANSWERED: 'APOLOGETIC' },
      nodeTones: [
        { nodeId: '33333333-3333-4333-8333-333333333333', tone: 'BRIGHT', nodeName: '인사' },
        { nodeId: '44444444-4444-4444-8444-444444444444', tone: 'CALM', nodeName: '환불 안내', nodeMissing: true },
      ],
      updatedAt: new Date('2026-10-01T00:00:00Z'),
    },
    server: { enabled: true, provider: 'local', inputAvailable: true },
    context: { webChannelEnabled: true, chatbotStatus: 'ACTIVE' },
    limits: { nodeTonesMax: 200 },
    ...over,
  } as VoiceOverviewResponse;
}

function renderSection(): { container: HTMLElement } {
  return render(
    <ToastProvider>
      <VoiceSection chatbotId="bot-1" isArchived={false} />
    </ToastProvider>,
  );
}

beforeEach(() => {
  canWrite = true;
  mockGetOverview.mockReset().mockResolvedValue(overview());
  mockSave.mockReset().mockResolvedValue({});
});

/** UIUX §3·§6·§7 — 음성 섹션 접근성(레이블·역할·키보드). 색 대비는 jsdom이 계산하지 못해 기존 시험과 같이 끈다(대비는 토큰으로 보증). */
describe('VoiceSection — axe 접근성 스캔', () => {
  it('저장값이 채워진 화면(노드 행·삭제된 노드 배지 포함)에 구조적 접근성 위반이 없다', async () => {
    const { container } = renderSection();
    await screen.findByRole('switch', { name: '음성 입력 사용' });
    await screen.findByRole('table', { name: '일별 음성 인식 숫자' });
    const results = await axe(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results).toHaveNoViolations();
  });

  it('기본값(빈 상태) 화면에도 위반이 없다', async () => {
    mockGetOverview.mockResolvedValue(overview({ settings: { ...overview().settings, inputEnabled: false, ttsEnabled: false, nodeTones: [], toneByKind: {}, updatedAt: null } } as never));
    const { container } = renderSection();
    await screen.findByRole('switch', { name: '음성 입력 사용' });
    const results = await axe(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results).toHaveNoViolations();
  });

  it('읽기 전용(권한 없음) · 서버 불가 화면에도 위반이 없다', async () => {
    canWrite = false;
    mockGetOverview.mockResolvedValue(overview({ server: { enabled: false, provider: 'local', inputAvailable: false, reason: 'SERVER_DISABLED' } } as never));
    const { container } = renderSection();
    await screen.findByRole('switch', { name: '음성 입력 사용' });
    const results = await axe(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results).toHaveNoViolations();
  });

  it('말투 값 표·순서 안내를 펼친 화면에도 위반이 없다', async () => {
    const { container } = renderSection();
    await screen.findByRole('switch', { name: '음성 입력 사용' });
    await userEvent.click(screen.getByRole('button', { name: '말투 값 보기' }));
    await userEvent.click(screen.getByRole('button', { name: '말투가 정해지는 순서' }));
    const results = await axe(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results).toHaveNoViolations();
  });

  it('데이터 지도 음성 카드에도 위반이 없다', async () => {
    const { container } = render(
      <VoiceGovernanceCard
        map={{
          serverEnabled: true,
          provider: 'local',
          chatbotsInputEnabled: 1,
          chatbotsTtsEnabled: 2,
          audioStored: false,
          audioDiskWrite: false,
          transcriptStored: 'ONLY_WHEN_SENT',
          ttsLocation: 'USER_DEVICE',
          ttsServerEgress: false,
          onlineVoicesExcluded: true,
          counters: 'CHATBOT_DAILY_COUNTS_ONLY',
        }}
      />,
    );
    const results = await axe(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results).toHaveNoViolations();
  });
});

describe('VoiceSection — 키보드만으로 설정·저장(UIUX §3)', () => {
  it('Tab으로 스위치에 닿고 Space/Enter로 켜고 끄며, 저장 버튼에서 Enter로 저장한다', async () => {
    mockGetOverview.mockResolvedValue(overview({ settings: { ...overview().settings, ttsEnabled: false, nodeTones: [] } } as never));
    renderSection();
    const input = await screen.findByRole('switch', { name: '음성 입력 사용' });
    input.focus();
    expect(input).toHaveFocus();
    await userEvent.keyboard('{Enter}'); // 켜짐 → 꺼짐
    expect(input).toHaveAttribute('aria-checked', 'false');
    await userEvent.keyboard(' '); // 꺼짐 → 켜짐
    expect(input).toHaveAttribute('aria-checked', 'true');
    await userEvent.tab(); // 다음 = 답변 듣기 스위치(DOM 순서)
    const tts = screen.getByRole('switch', { name: '답변 듣기 사용' });
    expect(tts).toHaveFocus();
    await userEvent.keyboard(' ');
    expect(tts).toHaveAttribute('aria-checked', 'true');
    const save = screen.getByRole('button', { name: '저장' });
    save.focus();
    await userEvent.keyboard('{Enter}');
    await vi.waitFor(() => expect(mockSave).toHaveBeenCalledTimes(1));
  });

  it('슬라이더는 방향키·Home/End를 네이티브로 받고 숫자 입력이 같은 값을 보인다', async () => {
    renderSection();
    const slider = (await screen.findByLabelText('읽기 속도 슬라이더')) as HTMLInputElement;
    expect(slider.tagName).toBe('INPUT');
    expect(slider.type).toBe('range');
    expect(within(slider.closest('.voice-rate-field') as HTMLElement).getByLabelText('읽기 속도 숫자 입력')).toBeInTheDocument();
  });

  it('모든 컨트롤에 접근 가능한 이름이 있다(레이블 없는 입력 0)', async () => {
    renderSection();
    await screen.findByRole('switch', { name: '음성 입력 사용' });
    const controls = Array.from(document.querySelectorAll<HTMLElement>('input, select, button, [role="switch"]'));
    const unnamed = controls.filter((el) => {
      const labelled = el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || (el as HTMLInputElement).labels?.length || el.textContent?.trim();
      return !labelled;
    });
    expect(unnamed).toEqual([]);
  });
});
