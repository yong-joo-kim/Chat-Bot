import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe, toHaveNoViolations } from 'jest-axe';
import type { RetentionRunItem } from '@chat-bot/shared-types';
import { PurgeHistoryPage } from './PurgeHistoryPage';

expect.extend(toHaveNoViolations);

const mockRetentionRuns = vi.fn();

vi.mock('../../../api/governance', () => ({
  governanceApi: { retentionRuns: (...args: unknown[]) => mockRetentionRuns(...args) },
}));

vi.mock('../../../context/AuthContext', () => ({
  useAuth: () => ({ user: { governanceModeOn: true }, can: () => true }),
}));

// `ResourcePickerField(resourceType='chatbot')`가 참조한다(마운트 시 호출되지 않지만 모듈 import가 필요).
vi.mock('../../../api/chatbots', () => ({ chatbotsApi: { list: vi.fn(), findOne: vi.fn() } }));

function makeRun(overrides: Partial<RetentionRunItem> = {}): RetentionRunItem {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    runId: 'run-1',
    kind: 'PURGE',
    target: 'CONVERSATION_TEXT',
    chatbotId: null,
    days: 180,
    cutoff: new Date('2026-04-06T00:00:00.000Z'),
    affectedCount: 1190002,
    status: 'SUCCEEDED',
    resultCode: null,
    headSeq: null,
    headHash: null,
    anchorSeq: null,
    startedAt: new Date('2026-09-26T02:00:00.000Z'),
    finishedAt: new Date('2026-09-26T02:05:00.000Z'),
    ...overrides,
  };
}

/** G1-c — 파기 이력(data-governance-ui-spec.md §3.3). */
describe('PurgeHistoryPage', () => {
  beforeEach(() => {
    mockRetentionRuns.mockReset();
  });

  it('결과가 없으면 빈 상태 안내를 보여준다', async () => {
    mockRetentionRuns.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });
    render(<PurgeHistoryPage />);

    await screen.findByText('아직 파기 실행 이력이 없습니다.');
    expect(screen.getByText('보존 정책이 전부 무기한이면 파기할 대상이 없습니다.')).toBeInTheDocument();
  });

  it('부분 처리 행은 상태 배지와 resultCode 보조 문구를 함께 보여준다', async () => {
    mockRetentionRuns.mockResolvedValue({
      items: [makeRun({ status: 'PARTIAL', resultCode: 'MAX_ROWS', affectedCount: 892010 })],
      total: 1,
      page: 1,
      pageSize: 20,
    });
    render(<PurgeHistoryPage />);

    await screen.findAllByText('◐');
    expect(screen.getAllByText('부분 처리').length).toBeGreaterThan(0);
    expect(screen.getAllByText('1회 처리 상한에 도달해 다음 창에 이어서 처리합니다').length).toBeGreaterThan(0);
  });

  it('kind=CHAIN_VERIFY 행은 체인 검증 상태 배지(6값 라벨)로 결과를 표시한다', async () => {
    mockRetentionRuns.mockResolvedValue({
      items: [makeRun({ id: 'run-cv', kind: 'CHAIN_VERIFY', target: null, days: null, cutoff: null, status: 'SUCCEEDED', resultCode: 'SEQ_GAP', affectedCount: 412003 })],
      total: 1,
      page: 1,
      pageSize: 20,
    });
    render(<PurgeHistoryPage />);

    expect(await screen.findAllByText('순번 결손')).not.toHaveLength(0);
  });

  /**
   * [신규 No.45 2차] `resultCode`는 `kind`별로 값 집합이 다르다(§4 — 2차 계약 확정).
   * - CHAIN_VERIFY: `AuditChainVerifyStatus`(OK 포함) 그대로 → `ChainVerifyResultBadge`.
   * - PURGE: `'MAX_ROWS'`(부분 처리) 또는 `null`(성공).
   * - BACKFILL/REENCRYPT: 항상 `null`.
   */
  describe('resultCode 분기(kind별)', () => {
    it('kind=CHAIN_VERIFY · resultCode=OK면 "정상" 배지를 보여준다(체인 검증 배지 경로)', async () => {
      mockRetentionRuns.mockResolvedValue({
        items: [makeRun({ id: 'run-cv-ok', kind: 'CHAIN_VERIFY', target: null, days: null, cutoff: null, status: 'SUCCEEDED', resultCode: 'OK', affectedCount: 412003 })],
        total: 1,
        page: 1,
        pageSize: 20,
      });
      render(<PurgeHistoryPage />);

      expect(await screen.findAllByText('정상')).not.toHaveLength(0);
    });

    it('kind=PURGE · resultCode=null(성공)이면 파기 결과 배지만 보이고 보조 문구는 없다', async () => {
      mockRetentionRuns.mockResolvedValue({
        items: [makeRun({ id: 'run-purge-ok', kind: 'PURGE', status: 'SUCCEEDED', resultCode: null })],
        total: 1,
        page: 1,
        pageSize: 20,
      });
      render(<PurgeHistoryPage />);

      expect(await screen.findAllByText('성공')).not.toHaveLength(0);
      expect(screen.queryByText('1회 처리 상한에 도달해 다음 창에 이어서 처리합니다')).not.toBeInTheDocument();
    });

    it('kind=BACKFILL · resultCode는 항상 null이며 파기 결과 배지(성공)로 표시된다', async () => {
      mockRetentionRuns.mockResolvedValue({
        items: [makeRun({ id: 'run-backfill', kind: 'BACKFILL', target: 'HANDOFF_TEXT', status: 'SUCCEEDED', resultCode: null })],
        total: 1,
        page: 1,
        pageSize: 20,
      });
      render(<PurgeHistoryPage />);

      expect(await screen.findAllByText('성공')).not.toHaveLength(0);
      // CHAIN_VERIFY 전용 배지(체인 검증 라벨)가 아니라 일반 파기 결과 배지여야 한다.
      expect(screen.queryByText('검증 대상 없음')).not.toBeInTheDocument();
    });

    it('kind=REENCRYPT · resultCode는 항상 null이며 파기 결과 배지(성공)로 표시된다', async () => {
      mockRetentionRuns.mockResolvedValue({
        items: [makeRun({ id: 'run-reencrypt', kind: 'REENCRYPT', target: 'HANDOFF_TEXT', status: 'SUCCEEDED', resultCode: null })],
        total: 1,
        page: 1,
        pageSize: 20,
      });
      render(<PurgeHistoryPage />);

      expect(await screen.findAllByText('성공')).not.toHaveLength(0);
    });
  });

  /** [코드 리뷰 R1 M-1] 펼친 행의 headHash를 `TruncatedHash`(앞 12자리 + 복사)로 표시한다. */
  it('행을 펼치면 체인 머리 해시를 앞 12자리 + 복사 버튼으로 보여준다', async () => {
    const user = userEvent.setup();
    mockRetentionRuns.mockResolvedValue({
      items: [makeRun({ id: 'run-with-hash', headSeq: 1882410, headHash: '9f3a7c1234567890abcdef', anchorSeq: 42 })],
      total: 1,
      page: 1,
      pageSize: 20,
    });
    render(<PurgeHistoryPage />);

    await screen.findAllByText('1,190,002');
    const expandButtons = screen.getAllByRole('button', { name: '펼치기' });
    await user.click(expandButtons[0]);

    expect(screen.getByText('9f3a7c123456…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '복사' })).toBeInTheDocument();
  });

  /** [코드 리뷰 R1 M-2] axe 접근성 스캔. */
  it('파기 이력 화면에 구조적 접근성 위반이 없다', async () => {
    mockRetentionRuns.mockResolvedValue({
      items: [makeRun({ status: 'PARTIAL', resultCode: 'MAX_ROWS' }), makeRun({ id: 'run-2', kind: 'CHAIN_VERIFY', target: null, days: null, cutoff: null, resultCode: 'OK' })],
      total: 2,
      page: 1,
      pageSize: 20,
    });
    const { container } = render(<PurgeHistoryPage />);
    await screen.findAllByText('1,190,002');

    const results = await axe(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results).toHaveNoViolations();
  });
});
