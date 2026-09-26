import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { RoleName, TranscriptResponse } from '@chat-bot/shared-types';
import { TranscriptPanel } from './TranscriptPanel';
import { handoffApi } from '../../api/handoff';

vi.mock('../../api/handoff', () => ({ handoffApi: { transcript: vi.fn() } }));

let mockRole: RoleName = 'ADMIN';
let mockCanWrite = true;
let mockUserName = '박관리';
let mockGovernanceModeOn = false;
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({
    user: { name: mockUserName, role: mockRole, governanceModeOn: mockGovernanceModeOn },
    can: (p: string) => (p === 'cs:write' ? mockCanWrite : true),
  }),
}));

const SESSION_REF = 'a'.repeat(16);
const SESSION_REF_B = 'b'.repeat(16);

function baseResponse(overrides: Partial<TranscriptResponse> = {}): TranscriptResponse {
  return {
    entries: [],
    nextCursor: null,
    handoff: {
      id: 'h1',
      alias: 'a1b2c3',
      status: 'CONNECTED',
      endReason: null,
      clientMode: 'MODERN',
      assignedUserName: '박관리',
      // H1(코드 리뷰 1회차 반영): 서버가 계산해 내려주는 값 — 이 필드가 담당 여부 판정의 단일 소스다
      // (이름 비교는 더 이상 쓰지 않는다). 기본값은 "내가 담당자"인 시나리오.
      isMine: true,
      // M-2(코드 리뷰 2회차 후속): `endButtonLabel`이 `HandoffBriefSchema`로 옮겨져 2초 폴링에도 들어온다.
      endButtonLabel: null,
      startedAt: new Date('2026-09-24T01:00:00.000Z'),
      connectedAt: new Date('2026-09-24T01:00:05.000Z'),
      endedAt: null,
      userMessageCount: 1,
      agentMessageCount: 0,
      unverifiedAttemptCount: 0,
    },
    rawVisible: false,
    blockedDuringHandoff: 0,
    ...overrides,
  };
}

describe('TranscriptPanel — 원문 토글 노출 조건·기본 꺼짐·rawVisible:false 즉시 삭제', () => {
  beforeEach(() => {
    vi.mocked(handoffApi.transcript).mockReset();
    mockRole = 'ADMIN';
    mockCanWrite = true;
    mockUserName = '박관리';
    mockGovernanceModeOn = false;
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('개입 전(handoff 없음)에는 원문 토글을 렌더하지 않는다', async () => {
    vi.mocked(handoffApi.transcript).mockResolvedValue(baseResponse({ handoff: null, rawVisible: false }));
    render(<TranscriptPanel chatbotId="bot-1" sessionRef={SESSION_REF} />);
    await waitFor(() => expect(handoffApi.transcript).toHaveBeenCalled());
    expect(screen.queryByRole('checkbox', { name: '원문 보기' })).not.toBeInTheDocument();
  });

  it('cs:write가 없는 EDITOR에게는 CONNECTED 상태여도 원문 토글을 렌더하지 않는다', async () => {
    mockCanWrite = false;
    vi.mocked(handoffApi.transcript).mockResolvedValue(baseResponse());
    render(<TranscriptPanel chatbotId="bot-1" sessionRef={SESSION_REF} />);
    await waitFor(() => expect(handoffApi.transcript).toHaveBeenCalled());
    expect(screen.queryByRole('checkbox', { name: '원문 보기' })).not.toBeInTheDocument();
  });

  it('ADMIN은 담당자가 아니어도(isMine:false) CONNECTED 상태면 원문 토글을 렌더한다', async () => {
    mockUserName = '다른관리자';
    vi.mocked(handoffApi.transcript).mockResolvedValue(
      baseResponse({ handoff: { ...baseResponse().handoff!, assignedUserName: '박담당', isMine: false } }),
    );
    render(<TranscriptPanel chatbotId="bot-1" sessionRef={SESSION_REF} />);
    expect(await screen.findByRole('checkbox', { name: '원문 보기' })).toBeInTheDocument();
  });

  it('AGENT는 담당자가 아니면(isMine:false) 원문 토글을 렌더하지 않는다', async () => {
    mockRole = 'AGENT';
    mockUserName = '김상담';
    vi.mocked(handoffApi.transcript).mockResolvedValue(
      baseResponse({ handoff: { ...baseResponse().handoff!, assignedUserName: '다른상담원', isMine: false } }),
    );
    render(<TranscriptPanel chatbotId="bot-1" sessionRef={SESSION_REF} />);
    await waitFor(() => expect(handoffApi.transcript).toHaveBeenCalled());
    expect(screen.queryByRole('checkbox', { name: '원문 보기' })).not.toBeInTheDocument();
  });

  it('AGENT는 자신이 담당자면(isMine:true) 원문 토글을 렌더한다 — H1: 서버 isMine을 그대로 신뢰한다', async () => {
    mockRole = 'AGENT';
    mockUserName = '김상담';
    vi.mocked(handoffApi.transcript).mockResolvedValue(
      baseResponse({ handoff: { ...baseResponse().handoff!, assignedUserName: '김상담', isMine: true } }),
    );
    render(<TranscriptPanel chatbotId="bot-1" sessionRef={SESSION_REF} />);
    expect(await screen.findByRole('checkbox', { name: '원문 보기' })).toBeInTheDocument();
  });

  it('기본값은 꺼짐이다 — 첫 조회는 includeRaw=false로 나간다', async () => {
    vi.mocked(handoffApi.transcript).mockResolvedValue(baseResponse());
    render(<TranscriptPanel chatbotId="bot-1" sessionRef={SESSION_REF} />);
    await waitFor(() => expect(handoffApi.transcript).toHaveBeenCalled());
    const [, , query] = vi.mocked(handoffApi.transcript).mock.calls[0];
    expect(query.includeRaw).toBe(false);
    expect(screen.getByRole('checkbox', { name: '원문 보기' })).not.toBeChecked();
  });

  it('켜서 원문을 보다가 서버가 rawVisible:false를 주면 즉시 원문이 사라지고 토글도 꺼진다', { timeout: 8000 }, async () => {
    const user = userEvent.setup();
    vi.mocked(handoffApi.transcript)
      .mockResolvedValueOnce(baseResponse()) // 최초(꺼짐)
      .mockResolvedValueOnce(
        baseResponse({
          rawVisible: true,
          entries: [
            {
              kind: 'HANDOFF',
              messageId: 'm1',
              handoffId: 'h1',
              seq: 1,
              at: new Date('2026-09-24T01:05:00.000Z'),
              sender: 'USER',
              text: '제 번호 010-****-5678이에요',
              rawText: '010-1234-5678',
            },
          ],
        }),
      ) // 켜짐(원문 재조회)
      .mockResolvedValue(baseResponse({ rawVisible: false })); // 만료 후 폴링

    render(<TranscriptPanel chatbotId="bot-1" sessionRef={SESSION_REF} />);
    await waitFor(() => expect(handoffApi.transcript).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole('checkbox', { name: '원문 보기' }));
    await user.click(screen.getByRole('button', { name: '원문 보기' })); // 고지 팝오버 확인

    await waitFor(() => expect(handoffApi.transcript).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('010-1234-5678')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: '원문 보기' })).toBeChecked();

    // 3번째 응답(rawVisible:false)을 트리거한다 — 실제 2초 폴링 주기가 지나가기를 기다린다.
    await waitFor(() => expect(handoffApi.transcript).toHaveBeenCalledTimes(3), { timeout: 5000, interval: 200 });
    await waitFor(() => expect(screen.queryByText('010-1234-5678')).not.toBeInTheDocument());
    expect(screen.getByRole('checkbox', { name: '원문 보기' })).not.toBeChecked();
    expect(screen.getByText('원문 보관 시간이 지났습니다.')).toBeInTheDocument();
  });

  it('C1(코드 리뷰 1회차 Critical): 세션이 바뀌면 원문 보기 상태가 전부 리셋되고, 새 세션의 첫 조회는 includeRaw=false다', async () => {
    const user = userEvent.setup();
    vi.mocked(handoffApi.transcript)
      .mockResolvedValueOnce(baseResponse()) // 세션 A 최초(꺼짐)
      .mockResolvedValueOnce(
        baseResponse({
          rawVisible: true,
          entries: [
            {
              kind: 'HANDOFF',
              messageId: 'm1',
              handoffId: 'h1',
              seq: 1,
              at: new Date('2026-09-24T01:05:00.000Z'),
              sender: 'USER',
              text: '제 번호 010-****-5678이에요',
              rawText: '010-1234-5678',
            },
          ],
        }),
      ) // 세션 A에서 원문 보기 켬
      .mockResolvedValue(baseResponse({ handoff: { ...baseResponse().handoff!, alias: 'b1c2d3' } })); // 세션 B

    const { rerender } = render(<TranscriptPanel chatbotId="bot-1" sessionRef={SESSION_REF} />);
    await waitFor(() => expect(handoffApi.transcript).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole('checkbox', { name: '원문 보기' }));
    await user.click(screen.getByRole('button', { name: '원문 보기' }));
    await waitFor(() => expect(handoffApi.transcript).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('010-1234-5678')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: '원문 보기' })).toBeChecked();

    // 세션 B로 전환한다 — 동의 고지 없이 원문 요청이 나가면 안 된다.
    rerender(<TranscriptPanel chatbotId="bot-1" sessionRef={SESSION_REF_B} />);

    // 리셋은 동기적으로 반영되어야 한다(다음 fetch 완료를 기다릴 필요 없이 즉시 꺼짐 상태).
    expect(screen.getByRole('checkbox', { name: '원문 보기' })).not.toBeChecked();
    expect(screen.queryByText('010-1234-5678')).not.toBeInTheDocument();

    await waitFor(() => expect(handoffApi.transcript).toHaveBeenCalledTimes(3));
    const [calledChatbotId, calledSessionRef, query] = vi.mocked(handoffApi.transcript).mock.calls[2];
    expect(calledChatbotId).toBe('bot-1');
    expect(calledSessionRef).toBe(SESSION_REF_B);
    expect(query.includeRaw).toBe(false);
  });
});

/** [신규 No.45] G5 파기 표시·G7 열람 감사 배너(data-governance-ui-spec.md §3.7·§3.10). */
describe('TranscriptPanel — 데이터 거버넌스(No.45) 표시', () => {
  beforeEach(() => {
    vi.mocked(handoffApi.transcript).mockReset();
    mockRole = 'ADMIN';
    mockCanWrite = true;
    mockUserName = '박관리';
    mockGovernanceModeOn = false;
  });

  it('purged:true인 BOT_TURN/HANDOFF 항목은 원문 대신 "보존기간 경과로 파기됨"을 보여준다', async () => {
    vi.mocked(handoffApi.transcript).mockResolvedValue(
      baseResponse({
        entries: [
          {
            kind: 'BOT_TURN',
            logId: 'log-1',
            at: new Date('2026-09-24T01:00:00.000Z'),
            userText: '',
            botText: '',
            isAnswered: true,
            blocked: false,
            purged: true,
          },
          {
            kind: 'HANDOFF',
            messageId: 'm1',
            handoffId: 'h1',
            seq: 1,
            at: new Date('2026-09-24T01:05:00.000Z'),
            sender: 'AGENT',
            text: '',
            purged: true,
          },
        ],
      }),
    );
    render(<TranscriptPanel chatbotId="bot-1" sessionRef={SESSION_REF} />);

    // BOT_TURN은 userText·botText 둘 다 소거되고(2건), HANDOFF는 text 1건 — 총 3건.
    const notices = await screen.findAllByText('보존기간 경과로 파기됨');
    expect(notices.length).toBe(3);
  });

  it('governanceModeOn=true면 대화 로그 위에 G7 배너를 보여준다', async () => {
    mockGovernanceModeOn = true;
    vi.mocked(handoffApi.transcript).mockResolvedValue(baseResponse({ handoff: null }));
    render(<TranscriptPanel chatbotId="bot-1" sessionRef={SESSION_REF} />);
    expect(await screen.findByText('이 화면 열람은 감사로그에 기록됩니다.')).toBeInTheDocument();
  });

  it('governanceModeOn=false면 G7 배너를 보여주지 않는다', async () => {
    mockGovernanceModeOn = false;
    vi.mocked(handoffApi.transcript).mockResolvedValue(baseResponse({ handoff: null }));
    render(<TranscriptPanel chatbotId="bot-1" sessionRef={SESSION_REF} />);
    await waitFor(() => expect(handoffApi.transcript).toHaveBeenCalled());
    expect(screen.queryByText('이 화면 열람은 감사로그에 기록됩니다.')).not.toBeInTheDocument();
  });
});
