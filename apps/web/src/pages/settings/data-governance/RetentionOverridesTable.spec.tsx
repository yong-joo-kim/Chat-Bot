import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { axe, toHaveNoViolations } from 'jest-axe';
import type { RetentionOverrideItem } from '@chat-bot/shared-types';
import { RetentionOverridesTable } from './RetentionOverridesTable';

expect.extend(toHaveNoViolations);

const mockOverrides = vi.fn();

vi.mock('../../../api/governance', () => ({
  governanceApi: { retention: { overrides: (...args: unknown[]) => mockOverrides(...args) } },
}));

function makeItem(overrides: Partial<RetentionOverrideItem> = {}): RetentionOverrideItem {
  return {
    chatbotId: 'bot-1',
    chatbotName: '대출 상담봇',
    status: 'ACTIVE',
    kinds: [
      { kind: 'CONVERSATION_TEXT', days: 90, source: 'CHATBOT' },
      { kind: 'UNANSWERED_CLOSED', days: 180, source: 'GLOBAL' },
      { kind: 'SURVEY_FREE_TEXT', days: 180, source: 'GLOBAL' },
      { kind: 'HANDOFF_TEXT', days: null, source: 'CHATBOT' },
    ],
    ...overrides,
  };
}

/** G1-b — "챗봇별 재정의" 목록(data-governance-ui-spec.md §3.2.1). */
describe('RetentionOverridesTable', () => {
  beforeEach(() => {
    mockOverrides.mockReset();
  });

  it('재정의가 없으면 빈 상태를 보여준다', async () => {
    mockOverrides.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });
    render(
      <MemoryRouter>
        <RetentionOverridesTable />
      </MemoryRouter>,
    );

    await screen.findByText('챗봇별 재정의가 없습니다.');
  });

  it('재정의 항목은 챗봇별 재정의 값(직접 지정/무기한/전역 따름)과 G2로 가는 링크를 함께 보여준다', async () => {
    mockOverrides.mockResolvedValue({ items: [makeItem()], total: 1, page: 1, pageSize: 20 });
    render(
      <MemoryRouter>
        <RetentionOverridesTable />
      </MemoryRouter>,
    );

    await screen.findAllByText('대출 상담봇');
    expect(screen.getAllByText('90일').length).toBeGreaterThan(0);
    expect(screen.getAllByText('무기한').length).toBeGreaterThan(0);
    expect(screen.getAllByText('전역 따름').length).toBeGreaterThan(0);

    const links = screen.getAllByRole('link', { name: '상세 →' });
    expect(links.length).toBeGreaterThan(0);
    expect(links[0]).toHaveAttribute('href', '/chatbots/bot-1/settings?section=retention');
  });

  /** [코드 리뷰 R1 L-6] 링크 전용 열의 빈 헤더를 aria-hidden 대신 sr-only 텍스트로 목적을 고지한다. */
  it('링크 전용 열 헤더는 aria-hidden이 아니라 sr-only 텍스트로 목적을 알린다', async () => {
    mockOverrides.mockResolvedValue({ items: [makeItem()], total: 1, page: 1, pageSize: 20 });
    render(
      <MemoryRouter>
        <RetentionOverridesTable />
      </MemoryRouter>,
    );

    await screen.findAllByText('대출 상담봇');
    const header = screen.getByRole('columnheader', { name: '상세 이동' });
    expect(header.querySelector('[aria-hidden="true"]')).not.toBeInTheDocument();
  });

  /** [코드 리뷰 R1 M-2] axe 접근성 스캔. */
  it('챗봇별 재정의 목록 화면에 구조적 접근성 위반이 없다', async () => {
    mockOverrides.mockResolvedValue({ items: [makeItem()], total: 1, page: 1, pageSize: 20 });
    const { container } = render(
      <MemoryRouter>
        <RetentionOverridesTable />
      </MemoryRouter>,
    );
    await screen.findAllByText('대출 상담봇');

    const results = await axe(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results).toHaveNoViolations();
  });
});
