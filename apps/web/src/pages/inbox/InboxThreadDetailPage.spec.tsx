import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ToastProvider } from '../../components/Toast';
import { InboxThreadDetailPage } from './InboxThreadDetailPage';
import { inboxApi } from '../../api/inbox';
import { ApiError } from '../../api/client';
import { makeMergeSystemEntry, makeThreadDetail, makeThreadListItem, makeThreadListResponse } from '../../test/inboxFixtures';

let mockUser: { id: string; name: string; role: string } = { id: 'agent-1', name: '김상담', role: 'AGENT' };
let mockCan = (_p: string): boolean => true;
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: mockUser, can: (p: string) => mockCan(p) }),
}));

vi.mock('../../api/inbox', () => ({
  inboxApi: {
    threadDetail: vi.fn(),
    assignees: vi.fn().mockResolvedValue([]),
    tags: { list: vi.fn().mockResolvedValue([]) },
    identitySpaces: vi.fn().mockResolvedValue([]),
    threads: vi.fn(),
    claim: vi.fn(),
    updateState: vi.fn(),
    assign: vi.fn(),
    release: vi.fn(),
    setTags: vi.fn(),
    createNote: vi.fn(),
    createRecord: vi.fn(),
    maskPreview: vi.fn(),
    linkSession: vi.fn(),
    searchCustomers: vi.fn(),
    merge: vi.fn(),
    revertMerge: vi.fn(),
    unlink: vi.fn(),
    removeTestCustomer: vi.fn(),
    simulate: vi.fn(),
  },
}));

function renderPage(threadId = 'thread-1'): ReturnType<typeof render> {
  return render(
    <MemoryRouter initialEntries={[`/inbox/${threadId}`]}>
      <ToastProvider>
        <Routes>
          <Route path="/inbox/:threadId" element={<InboxThreadDetailPage />} />
          <Route path="/inbox" element={<div>인박스 목록</div>} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>,
  );
}

describe('InboxThreadDetailPage(OI-2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUser = { id: 'agent-1', name: '김상담', role: 'AGENT' };
    mockCan = () => true;
    vi.mocked(inboxApi.assignees).mockResolvedValue([]);
    vi.mocked(inboxApi.tags.list).mockResolvedValue([]);
    vi.mocked(inboxApi.identitySpaces).mockResolvedValue([]);
    vi.mocked(inboxApi.threads).mockResolvedValue(makeThreadListResponse());
  });

  it('조회 성공 시 고객 카드·상태 배지·타임라인을 보여준다', async () => {
    vi.mocked(inboxApi.threadDetail).mockResolvedValue(makeThreadDetail());
    renderPage();

    expect(await screen.findByText(/인박스 > 홍길동/)).toBeInTheDocument();
    expect(screen.getAllByText('열림').length).toBeGreaterThan(0);
    expect(screen.getByText(/환불하고 싶어요/)).toBeInTheDocument();
  });

  it('스레드를 찾을 수 없으면(404) 오류 화면을 보여준다', async () => {
    vi.mocked(inboxApi.threadDetail).mockRejectedValue(new ApiError(404, 'not found'));
    renderPage();

    expect(await screen.findByText('스레드를 찾을 수 없습니다.')).toBeInTheDocument();
  });

  it('가져가기 경합(409 INBOX_THREAD_CONFLICT) 시 전용 안내 배너 후 자동 재조회한다(코드 리뷰 R1 M-4)', async () => {
    const user = userEvent.setup();
    const unassigned = makeThreadDetail({ thread: makeThreadListItem({ assignee: undefined }) });
    vi.mocked(inboxApi.threadDetail).mockResolvedValueOnce(unassigned).mockResolvedValueOnce(
      makeThreadDetail({ thread: makeThreadListItem({ assignee: { id: 'other', name: '이상담', active: true } }) }),
    );
    vi.mocked(inboxApi.claim).mockRejectedValue(new ApiError(409, '충돌', 'INBOX_THREAD_CONFLICT'));
    renderPage();

    await screen.findByText(/인박스 > 홍길동/);
    await user.click(screen.getByRole('button', { name: '가져가기' }));

    // 가져가기 경합은 일반 충돌 문구가 아니라 전용 문구를 쓴다(§4.4 vs claimConflictBanner).
    expect(await screen.findByText('방금 다른 상담원이 가져갔습니다.')).toBeInTheDocument();
    expect(screen.queryByText('다른 사람이 먼저 바꿨습니다 — 새로 불러옵니다.')).not.toBeInTheDocument();
    await waitFor(() => expect(vi.mocked(inboxApi.threadDetail)).toHaveBeenCalledTimes(2));
  });

  it('상태 변경 경합(409 INBOX_THREAD_CONFLICT)은 일반 충돌 문구를 쓴다', async () => {
    const user = userEvent.setup();
    vi.mocked(inboxApi.threadDetail).mockResolvedValue(makeThreadDetail());
    vi.mocked(inboxApi.updateState).mockRejectedValue(new ApiError(409, '충돌', 'INBOX_THREAD_CONFLICT'));
    renderPage();

    await screen.findByText(/인박스 > 홍길동/);
    await user.selectOptions(screen.getByLabelText('상태'), 'CLOSED');

    expect(await screen.findByText('다른 사람이 먼저 바꿨습니다 — 새로 불러옵니다.')).toBeInTheDocument();
  });

  it('메모를 저장하면 저장 API를 호출하고 모달이 닫힌다', async () => {
    const user = userEvent.setup();
    vi.mocked(inboxApi.threadDetail).mockResolvedValue(makeThreadDetail());
    vi.mocked(inboxApi.createNote).mockResolvedValue(makeThreadListItem());
    renderPage();

    await screen.findByText(/인박스 > 홍길동/);
    await user.click(screen.getByRole('button', { name: '메모 작성' }));
    await user.type(screen.getByRole('textbox', { name: '메모' }), '재문의 대비');
    await user.click(screen.getByRole('button', { name: '저장' }));

    await waitFor(() => expect(inboxApi.createNote).toHaveBeenCalledWith('thread-1', { text: '재문의 대비' }));
  });

  it('시험 고객(kind=TEST)이면 시뮬레이션 패널이 보이고 수동 기록 버튼은 없다', async () => {
    vi.mocked(inboxApi.threadDetail).mockResolvedValue(
      makeThreadDetail({ thread: makeThreadListItem({ customer: { id: 'c-test', alias: 'z9y8x7', kind: 'TEST' } }) }),
    );
    renderPage();

    expect(await screen.findByText(/시뮬레이션 —/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '수동 기록' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '시험 고객 삭제' })).toBeInTheDocument();
  });

  it('시험 고객 스레드인데 simulation:write가 없으면(AGENT) 시뮬레이션 패널 대신 안내 문구를 보여준다(코드 리뷰 R1 M-1)', async () => {
    mockCan = (p: string) => p !== 'simulation:write';
    vi.mocked(inboxApi.threadDetail).mockResolvedValue(
      makeThreadDetail({ thread: makeThreadListItem({ customer: { id: 'c-test', alias: 'z9y8x7', kind: 'TEST' } }) }),
    );
    renderPage();

    await screen.findByText(/인박스 > /);
    expect(screen.queryByText(/시뮬레이션 —/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '시험 고객 삭제' })).not.toBeInTheDocument();
    expect(screen.getByText('시험 고객 시뮬레이션은 실행 권한(simulation:write)이 있어야 볼 수 있습니다.')).toBeInTheDocument();
  });

  it('병합 대상이 다른 로그인 회원(IDENTIFIED)이면 409 CUSTOMER_MERGE_FORBIDDEN 인라인 오류를 보여준다', async () => {
    const user = userEvent.setup();
    vi.mocked(inboxApi.threadDetail).mockResolvedValue(
      makeThreadDetail({ thread: makeThreadListItem({ customer: { id: 'c-anon', alias: 'b2c3d4', kind: 'ANONYMOUS' } }) }),
    );
    vi.mocked(inboxApi.searchCustomers).mockResolvedValue({
      items: [{ customerId: 'target-1', alias: 'e5f6g7', displayName: '최철수', kind: 'IDENTIFIED', identified: true, lastActivityAt: new Date(), linkedConversationCount: 2 }],
    });
    vi.mocked(inboxApi.merge).mockRejectedValue(new ApiError(409, '금지', 'CUSTOMER_MERGE_FORBIDDEN'));
    renderPage();

    await screen.findByText(/인박스 > /);
    await user.click(screen.getByRole('button', { name: '병합' }));
    expect(await screen.findByText('병합 대상 선택')).toBeInTheDocument();

    await user.type(screen.getByLabelText('이름 · 별칭 · 회원번호'), '최철수');
    await user.click(screen.getByRole('button', { name: '검색' }));
    await user.click(await screen.findByRole('button', { name: '병합 대상으로 선택' }));

    expect(await screen.findByText('고객을 합칠까요?')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '합치기' }));

    expect(await screen.findByText('서로 다른 로그인 회원은 합칠 수 없습니다 — 회원 정보가 잘못됐다면 고객사 시스템을 확인하세요.')).toBeInTheDocument();
  });

  it('병합 성공 시 MergeResult.targetThreadId로 이동한다', async () => {
    const user = userEvent.setup();
    vi.mocked(inboxApi.threadDetail).mockResolvedValue(
      makeThreadDetail({ thread: makeThreadListItem({ customer: { id: 'c-anon', alias: 'b2c3d4', kind: 'ANONYMOUS' } }) }),
    );
    vi.mocked(inboxApi.searchCustomers).mockResolvedValue({
      items: [{ customerId: 'target-1', alias: 'e5f6g7', displayName: '최철수', kind: 'IDENTIFIED', identified: true, lastActivityAt: new Date(), linkedConversationCount: 2 }],
    });
    vi.mocked(inboxApi.merge).mockResolvedValue({ mergeId: 'merge-9', movedLinks: 1, movedEntries: 0, movedThread: false, droppedTags: 0, targetThreadId: 'thread-target' });
    renderPage();

    await screen.findByText(/인박스 > /);
    await user.click(screen.getByRole('button', { name: '병합' }));
    await user.type(screen.getByLabelText('이름 · 별칭 · 회원번호'), '최철수');
    await user.click(screen.getByRole('button', { name: '검색' }));
    await user.click(await screen.findByRole('button', { name: '병합 대상으로 선택' }));
    await user.click(await screen.findByRole('button', { name: '합치기' }));

    expect(inboxApi.merge).toHaveBeenCalledWith('c-anon', { targetCustomerId: 'target-1' });
    await screen.findByText(/인박스 > /); // 이동한 스레드(같은 목 데이터라 같은 화면이지만 재조회가 일어난다)
    await waitFor(() => expect(inboxApi.threadDetail).toHaveBeenLastCalledWith('thread-target'));
  });

  it('병합 성공인데 targetThreadId가 null이면 목록으로 이동한다', async () => {
    const user = userEvent.setup();
    vi.mocked(inboxApi.threadDetail).mockResolvedValue(
      makeThreadDetail({ thread: makeThreadListItem({ customer: { id: 'c-anon', alias: 'b2c3d4', kind: 'ANONYMOUS' } }) }),
    );
    vi.mocked(inboxApi.searchCustomers).mockResolvedValue({
      items: [{ customerId: 'target-1', alias: 'e5f6g7', displayName: '최철수', kind: 'ANONYMOUS', identified: false, lastActivityAt: new Date(), linkedConversationCount: 0 }],
    });
    vi.mocked(inboxApi.merge).mockResolvedValue({ mergeId: 'merge-9', movedLinks: 0, movedEntries: 0, movedThread: false, droppedTags: 0, targetThreadId: null });
    renderPage();

    await screen.findByText(/인박스 > /);
    await user.click(screen.getByRole('button', { name: '병합' }));
    await user.type(screen.getByLabelText('이름 · 별칭 · 회원번호'), '최철수');
    await user.click(screen.getByRole('button', { name: '검색' }));
    await user.click(await screen.findByRole('button', { name: '병합 대상으로 선택' }));
    await user.click(await screen.findByRole('button', { name: '합치기' }));

    expect(await screen.findByText('인박스 목록')).toBeInTheDocument();
  });

  it('IDENTITY 연결 분리(ADMIN) — 실제 linkId로 unlink API를 호출한다', async () => {
    const user = userEvent.setup();
    mockUser = { id: 'admin-1', name: '박관리', role: 'ADMIN' };
    vi.mocked(inboxApi.threadDetail).mockResolvedValue(makeThreadDetail());
    vi.mocked(inboxApi.unlink).mockResolvedValue(undefined);
    renderPage();

    await screen.findByText(/인박스 > 홍길동/);
    await user.click(screen.getByRole('button', { name: '분리' }));
    expect(await screen.findByText('이 회원 연결을 강제로 해제할까요?')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '강제로 해제' }));

    await waitFor(() => expect(inboxApi.unlink).toHaveBeenCalledWith('cust-1', 'link-1'));
  });

  it('IDENTITY 강제 분리 실패 시(코드 리뷰 R1 M-3) 모달을 닫지 않고 인라인 오류를 보여준다', async () => {
    const user = userEvent.setup();
    mockUser = { id: 'admin-1', name: '박관리', role: 'ADMIN' };
    vi.mocked(inboxApi.threadDetail).mockResolvedValue(makeThreadDetail());
    vi.mocked(inboxApi.unlink).mockRejectedValue(new ApiError(409, '이미 해제되었습니다', 'CUSTOMER_LINK_LOCKED'));
    renderPage();

    await screen.findByText(/인박스 > 홍길동/);
    await user.click(screen.getByRole('button', { name: '분리' }));
    await screen.findByText('이 회원 연결을 강제로 해제할까요?');
    await user.click(screen.getByRole('button', { name: '강제로 해제' }));

    expect(await screen.findByText('이미 해제되었습니다')).toBeInTheDocument();
    // 모달은 여전히 열려 있어야 한다 — 제목이 그대로 보인다.
    expect(screen.getByText('이 회원 연결을 강제로 해제할까요?')).toBeInTheDocument();
  });

  it('비-IDENTITY 분리(MANUAL/SYSTEM) 실패는 토스트로 알린다(코드 리뷰 R1 M-3 Low)', async () => {
    const user = userEvent.setup();
    mockUser = { id: 'admin-1', name: '박관리', role: 'ADMIN' };
    vi.mocked(inboxApi.threadDetail).mockResolvedValue(
      makeThreadDetail({
        timeline: {
          nextCursor: null,
          units: [
            {
              kind: 'CONVERSATION',
              at: new Date('2026-09-25T14:02:00.000Z'),
              chatbot: { id: 'bot-1', name: '쇼핑봇' },
              channel: { family: 'DEPLOY', type: 'WEB', label: '웹' },
              sessionRef: 'a'.repeat(16),
              sessionAlias: 'a1b2c3',
              linkId: 'link-manual-1',
              linkSource: 'MANUAL',
              startedAt: new Date('2026-09-25T14:02:00.000Z'),
              lastAt: new Date('2026-09-25T14:05:00.000Z'),
              turns: [],
              handoffs: [],
            },
          ],
        },
      }),
    );
    vi.mocked(inboxApi.unlink).mockRejectedValue(new ApiError(500, '서버 오류'));
    renderPage();

    await screen.findByText(/인박스 > 홍길동/);
    await user.click(screen.getByRole('button', { name: '분리' }));

    expect(await screen.findByText('서버 오류')).toBeInTheDocument();
  });

  it('병합 되돌리기 — 확인 모달을 거쳐 mergeId로 되돌리기 API를 호출한다', async () => {
    const user = userEvent.setup();
    vi.mocked(inboxApi.threadDetail).mockResolvedValue(makeThreadDetail({ timeline: { units: [makeMergeSystemEntry()], nextCursor: null } }));
    vi.mocked(inboxApi.revertMerge).mockResolvedValue({ revertedLinks: 1, skippedLinks: 0, revertedEntries: 0 });
    renderPage();

    await screen.findByText(/인박스 > 홍길동/);
    await user.click(screen.getByRole('button', { name: '되돌리기' }));
    expect(await screen.findByText('병합을 되돌릴까요?')).toBeInTheDocument();
    await user.click(screen.getAllByRole('button', { name: '되돌리기' })[1]);

    await waitFor(() => expect(inboxApi.revertMerge).toHaveBeenCalledWith('merge-1'));
  });

  it('병합 되돌리기 실패(409 CUSTOMER_MERGE_NOT_REVERTIBLE)는 확인 모달 안 인라인 오류로 보여준다', async () => {
    const user = userEvent.setup();
    vi.mocked(inboxApi.threadDetail).mockResolvedValue(makeThreadDetail({ timeline: { units: [makeMergeSystemEntry()], nextCursor: null } }));
    vi.mocked(inboxApi.revertMerge).mockRejectedValue(new ApiError(409, '실패', 'CUSTOMER_MERGE_NOT_REVERTIBLE'));
    renderPage();

    await screen.findByText(/인박스 > 홍길동/);
    await user.click(screen.getByRole('button', { name: '되돌리기' }));
    await user.click(screen.getAllByRole('button', { name: '되돌리기' })[1]);

    expect(await screen.findByText('이미 되돌려졌거나, 그 뒤 다시 합쳐져 지금은 되돌릴 수 없습니다.')).toBeInTheDocument();
  });

  it('로그인 승격 병합(PROMOTED)의 되돌리기는 ADMIN이 아니면 비활성 + 사유가 보인다', async () => {
    mockUser = { id: 'agent-1', name: '김상담', role: 'AGENT' };
    vi.mocked(inboxApi.threadDetail).mockResolvedValue(
      makeThreadDetail({ timeline: { units: [makeMergeSystemEntry({ system: { event: 'PROMOTED', data: { mergeId: 'merge-2', sourceAlias: '9a8b7c' } } })], nextCursor: null } }),
    );
    renderPage();

    await screen.findByText(/인박스 > 홍길동/);
    expect(screen.queryByRole('button', { name: '되돌리기' })).not.toBeInTheDocument();
    expect(screen.getByText('관리자만 되돌릴 수 있어요')).toBeInTheDocument();
  });

  describe('MANUAL 병합 되돌리기 사전 판정(코드 리뷰 R1 M-2, 상대 시각 사용)', () => {
    it('본인 + 기한(mergeRevertHours) 이내면 되돌리기 버튼이 활성 상태로 보인다', async () => {
      mockUser = { id: 'agent-1', name: '김상담', role: 'AGENT' };
      vi.mocked(inboxApi.threadDetail).mockResolvedValue(
        makeThreadDetail({
          mergeRevertHours: 24,
          timeline: {
            nextCursor: null,
            units: [
              makeMergeSystemEntry({
                system: { event: 'MERGED_IN', data: { mergeId: 'merge-3', sourceAlias: 'aaaaaa', mergedByUserId: 'agent-1', mergedAt: new Date(Date.now() - 3600_000).toISOString(), mergeKind: 'MANUAL' } },
              }),
            ],
          },
        }),
      );
      renderPage();

      await screen.findByText(/인박스 > 홍길동/);
      expect(screen.getByRole('button', { name: '되돌리기' })).not.toBeDisabled();
    });

    it('본인이 수행했지만 기한(mergeRevertHours)이 지났으면 비활성 + 사유가 보인다', async () => {
      mockUser = { id: 'agent-1', name: '김상담', role: 'AGENT' };
      vi.mocked(inboxApi.threadDetail).mockResolvedValue(
        makeThreadDetail({
          mergeRevertHours: 24,
          timeline: {
            nextCursor: null,
            units: [
              makeMergeSystemEntry({
                system: {
                  event: 'MERGED_IN',
                  data: { mergeId: 'merge-4', sourceAlias: 'bbbbbb', mergedByUserId: 'agent-1', mergedAt: new Date(Date.now() - 25 * 3600_000).toISOString(), mergeKind: 'MANUAL' },
                },
              }),
            ],
          },
        }),
      );
      renderPage();

      await screen.findByText(/인박스 > 홍길동/);
      expect(screen.queryByRole('button', { name: '되돌리기' })).not.toBeInTheDocument();
      expect(screen.getByText('되돌릴 수 있는 시간(24시간)이 지났어요')).toBeInTheDocument();
    });

    it('다른 상담원이 수행한 병합이면(기한 이내라도) 비활성 + "본인 아님" 사유가 보인다', async () => {
      mockUser = { id: 'agent-1', name: '김상담', role: 'AGENT' };
      vi.mocked(inboxApi.threadDetail).mockResolvedValue(
        makeThreadDetail({
          mergeRevertHours: 24,
          timeline: {
            nextCursor: null,
            units: [
              makeMergeSystemEntry({
                system: {
                  event: 'MERGED_IN',
                  data: { mergeId: 'merge-5', sourceAlias: 'cccccc', mergedByUserId: 'other-agent', mergedAt: new Date(Date.now() - 3600_000).toISOString(), mergeKind: 'MANUAL' },
                },
              }),
            ],
          },
        }),
      );
      renderPage();

      await screen.findByText(/인박스 > 홍길동/);
      expect(screen.queryByRole('button', { name: '되돌리기' })).not.toBeInTheDocument();
      expect(screen.getByText('본인이 병합한 경우에만 되돌릴 수 있어요')).toBeInTheDocument();
    });

    it('ADMIN은 본인이 수행하지 않았거나 기한이 지났어도 항상 되돌리기가 활성 상태다', async () => {
      mockUser = { id: 'admin-1', name: '박관리', role: 'ADMIN' };
      vi.mocked(inboxApi.threadDetail).mockResolvedValue(
        makeThreadDetail({
          mergeRevertHours: 24,
          timeline: {
            nextCursor: null,
            units: [
              makeMergeSystemEntry({
                system: {
                  event: 'MERGED_IN',
                  data: { mergeId: 'merge-6', sourceAlias: 'dddddd', mergedByUserId: 'other-agent', mergedAt: new Date(Date.now() - 100 * 3600_000).toISOString(), mergeKind: 'MANUAL' },
                },
              }),
            ],
          },
        }),
      );
      renderPage();

      await screen.findByText(/인박스 > 홍길동/);
      expect(screen.getByRole('button', { name: '되돌리기' })).not.toBeDisabled();
    });

    it('메타 필드(mergedByUserId 등)가 없는 옛 항목은 현행 동작(허용)을 유지한다', async () => {
      mockUser = { id: 'agent-1', name: '김상담', role: 'AGENT' };
      vi.mocked(inboxApi.threadDetail).mockResolvedValue(
        makeThreadDetail({
          mergeRevertHours: 24,
          timeline: { nextCursor: null, units: [makeMergeSystemEntry({ system: { event: 'MERGED_IN', data: { mergeId: 'merge-7', sourceAlias: 'eeeeee' } } })] },
        }),
      );
      renderPage();

      await screen.findByText(/인박스 > 홍길동/);
      expect(screen.getByRole('button', { name: '되돌리기' })).not.toBeDisabled();
    });
  });

  it('타임라인의 상담 구간 메시지가 발신자 라벨과 함께 표시되고, 파기/복호화 실패는 DataGovernanceBadges로 표시된다', async () => {
    vi.mocked(inboxApi.threadDetail).mockResolvedValue(
      makeThreadDetail({
        timeline: {
          nextCursor: null,
          units: [
            {
              kind: 'CONVERSATION',
              at: new Date('2026-09-25T14:02:00.000Z'),
              chatbot: { id: 'bot-1', name: '쇼핑봇' },
              channel: { family: 'DEPLOY', type: 'WEB', label: '웹' },
              sessionRef: 'a'.repeat(16),
              sessionAlias: 'a1b2c3',
              linkId: 'link-1',
              linkSource: 'IDENTITY',
              startedAt: new Date('2026-09-25T14:02:00.000Z'),
              lastAt: new Date('2026-09-25T14:05:00.000Z'),
              turns: [],
              handoffs: [
                {
                  handoffId: 'h1',
                  status: 'ENDED',
                  startedAt: new Date('2026-09-25T14:10:00.000Z'),
                  agentName: '김상담',
                  messages: [
                    { at: new Date('2026-09-25T14:10:00.000Z'), sender: 'AGENT', text: '계좌를 다시 확인해 주세요' },
                    { at: new Date('2026-09-25T14:11:00.000Z'), sender: 'USER', text: '', purged: true },
                    { at: new Date('2026-09-25T14:12:00.000Z'), sender: 'AGENT', text: '[복호화 실패]' },
                  ],
                },
              ],
            },
          ],
        },
      }),
    );
    renderPage();

    await screen.findByText(/인박스 > 홍길동/);
    expect(screen.getByText('계좌를 다시 확인해 주세요')).toBeInTheDocument();
    expect(screen.getByText('보존기간 경과로 파기됨')).toBeInTheDocument();
    expect(screen.getByText('[복호화 실패]')).toBeInTheDocument();
  });
});
