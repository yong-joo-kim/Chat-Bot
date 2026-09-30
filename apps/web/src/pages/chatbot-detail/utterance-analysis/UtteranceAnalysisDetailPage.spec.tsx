import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import type { AnalyzedUtterance, UtteranceAnalysisDetail } from '@chat-bot/shared-types';
import { ApiError } from '../../../api/client';
import { MESSAGES } from '../../../constants/messages';
import { ToastProvider } from '../../../components/Toast';
import { makeChatbot } from '../../../test/fixtures';
import type { ChatbotDetailContext } from '../../ChatbotDetailLayout';
import { UtteranceAnalysisDetailPage } from './UtteranceAnalysisDetailPage';
import { ANALYSIS_ID, CHATBOT_ID, UNASSIGNED_CLUSTER_ID, makeCluster, makeDetail, makeUnassignedCluster, makeUtterance } from './testFixtures';

let mockContext: ChatbotDetailContext;
vi.mock('../../ChatbotDetailLayout', () => ({
  useChatbotDetailContext: () => mockContext,
}));

let mockPermissions: string[] = [];
let mockGovernanceOn = false;
vi.mock('../../../context/AuthContext', () => ({
  useAuth: () => ({ can: (p: string) => mockPermissions.includes(p), user: { governanceModeOn: mockGovernanceOn } }),
}));

// 의도 검색 콤보박스는 별도 시험이 있으므로 여기서는 값만 고르는 대역으로 바꾼다.
vi.mock('../../../components/ResourcePickerField', () => ({
  ResourcePickerField: (p: { disabled?: boolean; value: unknown; onChange: (v: string | null) => void; errorMessage?: string; label: string }) => (
    <div>
      <button type="button" disabled={p.disabled} onClick={() => p.onChange('intent-existing')}>
        {p.label} 고르기(시험용)
      </button>
      {p.value ? <span>선택됨: {String(p.value)}</span> : null}
      {p.errorMessage ? <p role="alert">{p.errorMessage}</p> : null}
    </div>
  ),
}));

const api = vi.hoisted(() => ({
  get: vi.fn(),
  listUtterances: vi.fn(),
  renameCluster: vi.fn(),
  exportXlsx: vi.fn(),
  previewApply: vi.fn(),
  apply: vi.fn(),
  cancel: vi.fn(),
  remove: vi.fn(),
}));
vi.mock('../../../api/utteranceAnalyses', () => ({ utteranceAnalysesApi: api }));

const base = `/chatbots/${CHATBOT_ID}/stats/utterance-analyses`;
const msg = MESSAGES.utteranceAnalysis;

function utterancePage(items: AnalyzedUtterance[], total = items.length): { items: AnalyzedUtterance[]; total: number; page: number; pageSize: number } {
  return { items, total, page: 1, pageSize: 50 };
}

const U1 = makeUtterance();
const U2 = makeUtterance({
  id: 'u0000000-0000-4000-8000-000000000002',
  text: '[전화번호]로 해지해 주세요',
  hasMaskToken: true,
  learningCandidate: false,
  probe: { answered: true, matchKind: 'INTENT', matchId: 'i1', matchName: '해지문의', band: 'HIGH', score: 0.88, wouldUseRag: false },
  suggestedIntents: [],
});
const U3 = makeUtterance({
  id: 'u0000000-0000-4000-8000-000000000003',
  text: '***** 진짜 화나네',
  hasBannedWord: true,
  probe: { answered: false, matchKind: null, matchId: null, matchName: null, band: null, score: 0.12, wouldUseRag: true },
  suggestedIntents: [{ intentId: 'i9', name: '불만', score: 0.3, source: 'LEXICAL' }],
});
const U4 = makeUtterance({
  id: 'u0000000-0000-4000-8000-000000000004',
  text: '위약금 얼마예요',
  learningCandidate: false,
  probe: { answered: true, matchKind: 'INTENT', matchId: 'i2', matchName: '위약금', band: 'HIGH', score: 0.91, wouldUseRag: false },
  suggestedIntents: [],
  applied: { intentId: 'i2', intentName: '위약금', byEmail: 'lee@example.com', at: new Date('2026-09-29T06:00:00.000Z') },
});

function setup(opts: { permissions?: string[]; chatbot?: Parameters<typeof makeChatbot>[0]; initialQuery?: string } = {}): void {
  mockPermissions = opts.permissions ?? ['dialogue:read', 'dialogue:write'];
  mockContext = {
    chatbot: makeChatbot({ id: CHATBOT_ID, ...opts.chatbot }),
    reload: vi.fn().mockResolvedValue(undefined),
    setUnsavedGuard: vi.fn(),
    learningSummary: null,
    refreshLearningSummary: vi.fn(),
  } as ChatbotDetailContext;
  render(
    <MemoryRouter initialEntries={[`${base}/${ANALYSIS_ID}${opts.initialQuery ?? ''}`]}>
      <ToastProvider>
        <Routes>
          <Route path={`${base}/:analysisId`} element={<><Link to={`${base}/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb`}>다른 분석으로</Link><UtteranceAnalysisDetailPage /></>} />
          <Route path={base} element={<p>분석 목록 화면</p>} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>,
  );
}

function running(overrides: Partial<UtteranceAnalysisDetail> = {}): UtteranceAnalysisDetail {
  return makeDetail({ status: 'RUNNING', stage: 'EMBEDDING', progress: 35, finishedAt: null, clusters: [], durationMs: null, candidateCount: null, clusterCount: null, ...overrides });
}

beforeEach(() => {
  Object.values(api).forEach((fn) => fn.mockReset());
  mockGovernanceOn = false;
  api.get.mockResolvedValue(makeDetail());
  api.listUtterances.mockResolvedValue(utterancePage([U1, U2, U3, U4]));
});

describe('UtteranceAnalysisDetailPage — 처리 중(§5.2)', () => {
  it('단계 목록을 글자(완료/진행 중/대기 중)로 밝히고 현재 단계에 aria-current="step", 진행률 %를 글자로 보인다', async () => {
    api.get.mockResolvedValue(running({ stage: 'CLUSTERING', progress: 42 }));
    setup();

    const list = await screen.findByRole('list', { name: '분석 단계' });
    const items = within(list).getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('1. 파일 확인과 개인정보 가리기 — 완료');
    expect(items[1]).toHaveTextContent('2. 문장 분석 — 완료');
    expect(items[2]).toHaveTextContent('3. 비슷한 말끼리 묶기 — 진행 중');
    expect(items[2]).toHaveAttribute('aria-current', 'step');
    expect(items[3]).toHaveTextContent('대기 중');
    expect(document.querySelector('.ua-progress-percent')).toHaveTextContent('42%');
    // 진행 막대 자체는 낭독 영역이 아니다(live=false).
    expect(document.querySelector('.async-job-progress')).not.toHaveAttribute('role');
    // 결과 영역(묶음 표)은 그리지 않는다.
    expect(screen.queryByRole('table', { name: /묶음 목록/ })).not.toBeInTheDocument();
    expect(screen.getByText(/분석은 서버 전체에서 한 번에 1건만 처리합니다/)).toBeInTheDocument();
    expect(screen.getByText('이 화면을 닫아도 분석은 서버에서 계속됩니다.')).toBeInTheDocument();
  });

  it('QUEUED이면 1단계만 완료이고 나머지는 대기 중이다', async () => {
    api.get.mockResolvedValue(running({ status: 'QUEUED', stage: null, progress: 0 }));
    setup();

    const items = within(await screen.findByRole('list', { name: '분석 단계' })).getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('완료');
    items.slice(1).forEach((li) => expect(li).toHaveTextContent('대기 중'));
    expect(within(screen.getByRole('list', { name: '분석 단계' })).queryByRole('listitem', { current: 'step' })).not.toBeInTheDocument();
  });

  it('대조를 끈 분석은 챗봇 대조 줄이 없고, 이름 제안을 켠 분석만 이름 제안 줄이 있다', async () => {
    api.get.mockResolvedValue(
      running({ conditions: { ...makeDetail().conditions, probe: { enabled: false, target: 'SERVING', scoreThreshold: null }, nameSuggest: true }, stage: 'NAMING' }),
    );
    setup();

    const list = await screen.findByRole('list', { name: '분석 단계' });
    expect(within(list).queryByText(/챗봇 대조/)).not.toBeInTheDocument();
    expect(within(list).getByText(/이름 제안/)).toBeInTheDocument();
  });

  it('쓰기 권한이면 분석 취소 버튼이 있고, 읽기 전용이면 없다', async () => {
    api.get.mockResolvedValue(running());
    setup({ permissions: ['dialogue:read'] });
    await screen.findByRole('list', { name: '분석 단계' });
    expect(screen.queryByRole('button', { name: '분석 취소' })).not.toBeInTheDocument();
  });
});

describe('UtteranceAnalysisDetailPage — 폴링·낭독(§2.3, §5.2)', () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
  afterEach(() => vi.useRealTimers());

  it('2초 폴링: 최초 마운트에는 낭독이 없고, 단계가 바뀔 때만 1회 낭독하며 완료되면 묶음 표가 나타난다', async () => {
    api.get.mockResolvedValue(running({ stage: 'EMBEDDING', progress: 20 }));
    setup();
    await screen.findByRole('list', { name: '분석 단계' });
    const announce = (): string => Array.from(document.querySelectorAll('p.sr-only[role="status"]')).map((e) => e.textContent).join('|');
    expect(announce()).not.toMatch(/넘어갔습니다/);

    // 같은 단계에서 진행률만 바뀌면 낭독하지 않는다.
    api.get.mockResolvedValue(running({ stage: 'EMBEDDING', progress: 30 }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2100);
    });
    await waitFor(() => expect(document.querySelector('.ua-progress-percent')).toHaveTextContent('30%'));
    expect(announce()).not.toMatch(/넘어갔습니다/);

    api.get.mockResolvedValue(running({ stage: 'CLUSTERING', progress: 45 }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2100);
    });
    await waitFor(() => expect(announce()).toContain('문장 분석에서 묶기 단계로 넘어갔습니다'));

    api.get.mockResolvedValue(makeDetail());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2100);
    });
    expect(await screen.findByRole('table', { name: /묶음 목록/ })).toBeInTheDocument();
    await waitFor(() => expect(announce()).toContain('분석이 끝났습니다'));
    const calls = api.get.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000);
    });
    expect(api.get.mock.calls.length).toBe(calls); // 종결 상태에서는 폴링이 멈춘다.
  });

  it('연속 실패가 30초를 넘으면 "연결이 원활하지 않습니다" 배너를 보인다', async () => {
    api.get.mockResolvedValueOnce(running());
    setup();
    await screen.findByRole('list', { name: '분석 단계' });
    api.get.mockRejectedValue(new ApiError(503, 'x'));
    for (let i = 0; i < 17; i += 1) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });
    }
    expect(await screen.findByText('연결이 원활하지 않습니다. 잠시 뒤 다시 시도합니다.')).toBeInTheDocument();
    // 배너가 떠도 마지막으로 받은 진행 화면은 유지된다.
    expect(screen.getByRole('list', { name: '분석 단계' })).toBeInTheDocument();
  });
});

describe('UtteranceAnalysisDetailPage — 오류·취소·없음', () => {
  it('오류: 사유 문구 + 저장된 결과 없음 + 새 분석/삭제(쓰기 권한)', async () => {
    api.get.mockResolvedValue(makeDetail({ status: 'FAILED', failureReason: 'SERVER_RESTART', clusters: [], progress: 30 }));
    setup();

    expect(await screen.findByText('분석이 끝나지 못했습니다')).toBeInTheDocument();
    expect(screen.getByText(/서버가 다시 시작되어 분석이 중단되었습니다/)).toBeInTheDocument();
    expect(screen.getByText(/저장된 결과가 없습니다\. 같은 파일로 다시 요청하면 됩니다/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '새 분석 만들기' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '삭제' })).toBeInTheDocument();
  });

  it('알 수 없는 사유 코드는 서버 원문이 아니라 일반 문구를 쓴다', async () => {
    api.get.mockResolvedValue(makeDetail({ status: 'FAILED', failureReason: 'SOMETHING_NEW', clusters: [] }));
    setup();

    expect(await screen.findByText(/예상하지 못한 문제로 중단되었습니다/)).toBeInTheDocument();
    expect(screen.queryByText(/SOMETHING_NEW/)).not.toBeInTheDocument();
  });

  it('취소됨: 정보 카드', async () => {
    api.get.mockResolvedValue(makeDetail({ status: 'CANCELLED', clusters: [] }));
    setup();

    expect(await screen.findByText('분석이 취소되었습니다. 저장된 결과가 없습니다.')).toBeInTheDocument();
  });

  it('404(삭제·보존 만료)면 "분석을 찾을 수 없습니다" + 목록 링크', async () => {
    api.get.mockRejectedValue(new ApiError(404, 'Not Found'));
    setup();

    expect(await screen.findByText(/분석을 찾을 수 없습니다/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '분석 목록으로' })).toBeInTheDocument();
  });

  it('상세 조회 실패는 ErrorState와 다시 시도', async () => {
    api.get.mockRejectedValueOnce(new ApiError(500, 'x'));
    setup();

    expect(await screen.findByText('분석 결과를 불러오지 못했습니다')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '다시 시도' }));
    expect(await screen.findByRole('table', { name: /묶음 목록/ })).toBeInTheDocument();
  });
});

describe('UtteranceAnalysisDetailPage — 취소·삭제 확인(UA-3b)', () => {
  it('취소: 기본 포커스는 "계속 진행", 확정하면 POST cancel 후 상세를 다시 읽는다', async () => {
    api.get.mockResolvedValue(running());
    api.cancel.mockResolvedValue(undefined);
    setup();
    await userEvent.click((await screen.findAllByRole('button', { name: '분석 취소' }))[0]);

    const dialog = await screen.findByRole('dialog', { name: '분석을 취소할까요?' });
    expect(within(dialog).getByRole('button', { name: '계속 진행' })).toHaveFocus();
    api.get.mockResolvedValue(makeDetail({ status: 'CANCELLED', clusters: [] }));
    await userEvent.click(within(dialog).getByRole('button', { name: '분석 취소' }));

    await waitFor(() => expect(api.cancel).toHaveBeenCalledWith(CHATBOT_ID, ANALYSIS_ID));
    expect(await screen.findByText('분석이 취소되었습니다. 저장된 결과가 없습니다.')).toBeInTheDocument();
  });

  it('취소 409(저장 중)는 원인+해결 문구를 보이고 상세를 다시 읽는다', async () => {
    api.get.mockResolvedValue(running({ stage: 'SAVING' }));
    api.cancel.mockRejectedValue(new ApiError(409, 'x', 'INVALID_STATUS_TRANSITION'));
    setup();
    await userEvent.click((await screen.findAllByRole('button', { name: '분석 취소' }))[0]);
    const dialog = await screen.findByRole('dialog');
    const callsBefore = api.get.mock.calls.length;
    await userEvent.click(within(dialog).getByRole('button', { name: '분석 취소' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('이미 끝났거나 저장 중이라 취소할 수 없습니다');
    await waitFor(() => expect(api.get.mock.calls.length).toBeGreaterThan(callsBefore));
  });

  it('상세 삭제: 취소 정리 중 409는 전용 문구로 열린 채 남고, 처리 중 삭제 409의 기존 문구는 유지된다', async () => {
    api.remove
      .mockRejectedValueOnce(new ApiError(409, '취소를 정리하는 중입니다. 잠시 뒤 다시 삭제해 주세요.', 'INVALID_STATUS_TRANSITION'))
      .mockRejectedValueOnce(new ApiError(409, '처리 중인 분석은 삭제할 수 없습니다.', 'INVALID_STATUS_TRANSITION'));
    setup();
    await userEvent.click(await screen.findByRole('button', { name: '삭제' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: '삭제' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('취소를 정리하는 중입니다. 잠시 뒤 다시 삭제해 주세요.');

    await userEvent.click(within(dialog).getByRole('button', { name: '삭제' }));
    await waitFor(() => expect(within(dialog).getByRole('alert')).toHaveTextContent('처리 중인 분석은 삭제할 수 없습니다. 먼저 취소해 주세요.'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('삭제 성공(204)이면 목록으로 이동한다', async () => {
    api.remove.mockResolvedValue(undefined);
    setup();
    await userEvent.click(await screen.findByRole('button', { name: '삭제' }));
    const dialog = await screen.findByRole('dialog', { name: '분석 결과를 삭제할까요?' });
    expect(within(dialog).getByRole('button', { name: '취소' })).toHaveFocus();
    await userEvent.click(within(dialog).getByRole('button', { name: '삭제' }));

    expect(await screen.findByText('분석 목록 화면')).toBeInTheDocument();
    expect(api.remove).toHaveBeenCalledWith(CHATBOT_ID, ANALYSIS_ID);
  });
});

describe('UtteranceAnalysisDetailPage — 완료 상단(§5.4)', () => {
  it('요약 수치·안내 배너·보존 안내·엑셀 감사 고지가 글자로 보인다', async () => {
    setup();

    const summary = (await screen.findByText('분석한 발화')).closest('dl') as HTMLElement;
    expect(within(summary).getByText('2,870개')).toBeInTheDocument();
    expect(within(summary).getByText('412개')).toBeInTheDocument();
    expect(within(summary).getByText('45개')).toBeInTheDocument(); // 미분류
    expect(screen.getByText(msg.maskNotice)).toBeInTheDocument();
    expect(screen.getByText(msg.notIntentNotice)).toBeInTheDocument();
    expect(screen.getByText(/2026-12-28에 자동으로 삭제됩니다\. 이미 의도에 넣은 예문은 지워지지 않습니다/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '엑셀로 받기' })).toBeInTheDocument();
    expect(screen.getByText(msg.governanceExport)).toBeInTheDocument();
    // 알고리즘 버전·분석기 ID 같은 기술 정보는 화면에 없다.
    expect(document.body.textContent).not.toContain('kiwi');
  });

  it('거버넌스 모드 ON이면 열람 감사 배너, OFF면 없다', async () => {
    mockGovernanceOn = true;
    setup();
    expect(await screen.findByText(MESSAGES.dataGovernance.viewAuditBanner)).toBeInTheDocument();
  });

  it('거버넌스 모드 OFF에는 열람 감사 배너가 없다', async () => {
    setup();
    await screen.findByRole('table', { name: /묶음 목록/ });
    expect(screen.queryByText(MESSAGES.dataGovernance.viewAuditBanner)).not.toBeInTheDocument();
  });

  it('알림: 목표 미달·기본 분석기·이전 모델·대조 실패·2단계 넘김·이름 제안 일부 실패', async () => {
    api.get.mockResolvedValue(
      makeDetail({
        notices: ['FEWER_THAN_TARGET', 'HEURISTIC_ANALYZER'],
        staleModel: true,
        probe: { status: 'DONE', failureReason: null, targetKind: 'PROD', versionNo: 7, threshold: 0.6, wouldUseRagCount: 5 },
        nameSuggest: { status: 'PARTIAL', failureReason: null },
      }),
    );
    setup();

    expect(await screen.findByText(/묶음이 목표\(10개\)보다 적은 2개로 나왔습니다/)).toBeInTheDocument();
    expect(screen.getByText(msg.notices.HEURISTIC_ANALYZER)).toBeInTheDocument();
    expect(screen.getByText(msg.notices.staleModel)).toBeInTheDocument();
    expect(screen.getByText(/5개 발화는 챗봇이 1단계에서 답하지 못하고/)).toBeInTheDocument();
    expect(screen.getByText(msg.notices.nameSuggestPartial)).toBeInTheDocument();
  });

  it('대조 실패/끔이면 학습 후보 안내가 바뀌고 요약에서 학습 후보 칸이 빠진다', async () => {
    api.get.mockResolvedValue(makeDetail({ probe: { status: 'FAILED', failureReason: 'TARGET_VERSION_UNREADABLE', targetKind: null, versionNo: null, threshold: null, wouldUseRagCount: 0 } }));
    setup();

    expect(await screen.findByText(/챗봇 대조에 실패해 '학습 후보' 표시가 없습니다\.\(운영 중인 버전을 읽지 못했습니다\)/)).toBeInTheDocument();
    expect(within(screen.getByText('분석한 발화').closest('dl') as HTMLElement).queryByText('학습 후보')).not.toBeInTheDocument();
  });

  it('NO_CLUSTER: 미분류만 있고 쓰기 권한이면 "조건을 바꿔 새 분석" 링크를 준다', async () => {
    api.get.mockResolvedValue(makeDetail({ notices: ['NO_CLUSTER'], clusters: [makeUnassignedCluster({ ordinal: 1 })] }));
    setup();

    expect(await screen.findByText(/묶음을 만들지 못했습니다/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '조건을 바꿔 새 분석' })).toHaveAttribute('href', `${base}/new`);
  });

  it('처리 정보는 기본 접힘이며 조건·대조 대상(운영 v7)을 보여 준다', async () => {
    setup();
    const summary = await screen.findByText('분석 조건과 처리 정보 보기');
    const details = summary.closest('details') as HTMLDetailsElement;
    expect(details.open).toBe(false);
    expect(within(details).getByText('운영 중인 답변 v7')).toBeInTheDocument();
    expect(within(details).getByText('60')).toBeInTheDocument();
  });

  it('엑셀 받기: 서버 파일 이름으로 저장하고 토스트를 띄운다', async () => {
    const createUrl = vi.fn(() => 'blob:x');
    const revoke = vi.fn();
    Object.assign(URL, { createObjectURL: createUrl, revokeObjectURL: revoke });
    api.exportXlsx.mockResolvedValue({ blob: new Blob(['x']), filename: '발화묶음-20260930.xlsx' });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    setup({ permissions: ['dialogue:read'] }); // 읽기 권한만으로도 받을 수 있다.
    await userEvent.click(await screen.findByRole('button', { name: '엑셀로 받기' }));

    await waitFor(() => expect(api.exportXlsx).toHaveBeenCalledWith(CHATBOT_ID, ANALYSIS_ID));
    expect(await screen.findByText('엑셀을 내려받았습니다. 받은 기록이 남습니다.')).toBeInTheDocument();
    expect(createUrl).toHaveBeenCalled();
    click.mockRestore();
  });

  it('엑셀 받기 실패는 원인 문구를 보인다', async () => {
    api.exportXlsx.mockRejectedValue(new ApiError(500, 'x'));
    setup();
    await userEvent.click(await screen.findByRole('button', { name: '엑셀로 받기' }));

    expect(await screen.findByText(msg.exportFailed)).toBeInTheDocument();
  });
});

describe('UtteranceAnalysisDetailPage — 묶음 표(§5.5)', () => {
  it('미분류가 항상 마지막 행이고 번호 칸에 "미분류"라고만 적는다', async () => {
    setup();

    const table = await screen.findByRole('table', { name: /묶음 목록/ });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(within(rows[0]).getAllByRole('cell')[0]).toHaveTextContent('1');
    expect(within(rows[1]).getAllByRole('cell')[0]).toHaveTextContent('2');
    expect(within(rows[2]).getAllByRole('cell')[0]).toHaveTextContent('미분류');
    expect(within(rows[2]).getAllByRole('cell')[0]).not.toHaveTextContent('11');
    expect(within(rows[2]).getByText('(키워드 없음)')).toBeInTheDocument();
    // 미분류는 이름을 바꿀 수 없다.
    expect(within(rows[2]).queryByRole('button', { name: /이름 바꾸기/ })).not.toBeInTheDocument();
    expect(screen.getByText(/어느 묶음에도 넣기 어려웠거나/)).toBeInTheDocument();
  });

  it('발화(발생 합)·학습 후보 비율은 숫자 글자로, 키워드는 쉼표로 이어 보인다', async () => {
    setup();

    const table = await screen.findByRole('table', { name: /묶음 목록/ });
    const first = within(table).getAllByRole('row')[1];
    expect(within(first).getByText('380 (1,204)')).toBeInTheDocument();
    expect(within(first).getByText('72% (274/380)')).toBeInTheDocument();
    expect(within(first).getByText('해지')).toHaveAttribute('title', '포함된 발화 120개');
  });

  it('대조를 하지 않은 분석은 비율 열이 "—"이고 열 머리에 "(대조 안 함)"이 붙는다', async () => {
    api.get.mockResolvedValue(makeDetail({ probe: { status: 'OFF', failureReason: null, targetKind: null, versionNo: null, threshold: null, wouldUseRagCount: 0 } }));
    setup();

    const table = await screen.findByRole('table', { name: /묶음 목록/ });
    expect(within(table).getByRole('columnheader', { name: /학습 후보 비율 \(대조 안 함\)/ })).toBeInTheDocument();
    expect(within(within(table).getAllByRole('row')[1]).getAllByRole('cell')[3]).toHaveTextContent('—');
  });

  it('대표 발화 펼침 버튼은 aria-expanded로 토글된다', async () => {
    setup();
    const btn = await screen.findByRole('button', { name: '1번 묶음 대표 발화 보기' });
    expect(btn).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(btn);

    expect(btn).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('해지하고 싶어요')).toBeInTheDocument();
  });

  it('이름 제안 기능이 꺼진 분석(OFF)은 AI 제안 UI가 전혀 없다(제안 이름이 있어도)', async () => {
    api.get.mockResolvedValue(makeDetail({ clusters: [makeCluster({ suggestedName: '해지 및 환급 문의' }), makeUnassignedCluster()] }));
    setup();

    await screen.findByRole('table', { name: /묶음 목록/ });
    expect(screen.queryByText('AI 제안 — 확인 필요')).not.toBeInTheDocument();
    expect(screen.queryByText(/해지 및 환급 문의/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '이 이름 사용' })).not.toBeInTheDocument();
  });

  it('이름 제안이 있으면 "AI 제안 — 확인 필요" 표식과 함께 보이고 "이 이름 사용"이 customName으로 저장한다', async () => {
    const cluster = makeCluster({ suggestedName: '해지 및 환급 문의' });
    api.get.mockResolvedValue(makeDetail({ nameSuggest: { status: 'DONE', failureReason: null }, clusters: [cluster, makeUnassignedCluster()] }));
    api.renameCluster.mockResolvedValue({ ...cluster, customName: '해지 및 환급 문의', displayName: '해지 및 환급 문의' });
    setup();

    expect(await screen.findByText('AI 제안 — 확인 필요')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '이 이름 사용' }));

    await waitFor(() => expect(api.renameCluster).toHaveBeenCalledWith(CHATBOT_ID, ANALYSIS_ID, cluster.id, { customName: '해지 및 환급 문의' }));
    // 채택하면 더는 제안 표식이 남지 않는다(customName과 같아짐).
    await waitFor(() => expect(screen.queryByText('AI 제안 — 확인 필요')).not.toBeInTheDocument());
  });

  it('이름 바꾸기: Enter로 저장하고 저장 뒤 "이름 바꾸기" 버튼으로 포커스가 돌아온다', async () => {
    const cluster = makeCluster();
    api.get.mockResolvedValue(makeDetail({ clusters: [cluster, makeUnassignedCluster()] }));
    api.renameCluster.mockResolvedValue({ ...cluster, customName: '환불 문의', displayName: '환불 문의' });
    setup();
    await userEvent.click(await screen.findByRole('button', { name: '1번 묶음 이름 바꾸기' }));

    const input = screen.getByLabelText('1번 묶음 이름');
    expect(input).toHaveFocus();
    expect(screen.getByText(`${makeCluster().displayName.length}/40`)).toBeInTheDocument();
    await userEvent.clear(input);
    await userEvent.type(input, '환불 문의{Enter}');

    await waitFor(() => expect(api.renameCluster).toHaveBeenCalledWith(CHATBOT_ID, ANALYSIS_ID, cluster.id, { customName: '환불 문의' }));
    expect(await screen.findByText('환불 문의')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: '1번 묶음 이름 바꾸기' })).toHaveFocus());
    expect(await screen.findByText('묶음 이름을 바꿨습니다')).toBeInTheDocument();
  });

  it('이름 바꾸기: Esc는 저장 없이 취소하고 버튼으로 포커스가 돌아온다', async () => {
    setup();
    await userEvent.click(await screen.findByRole('button', { name: '1번 묶음 이름 바꾸기' }));
    await userEvent.type(screen.getByLabelText('1번 묶음 이름'), '{Escape}');

    expect(api.renameCluster).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole('button', { name: '1번 묶음 이름 바꾸기' })).toHaveFocus());
  });

  it('금지어 400은 입력 아래에 원인+해결 문구를, 40자 초과는 요청 없이 길이 문구를 보인다', async () => {
    api.renameCluster.mockRejectedValue(new ApiError(400, 'x', 'BANNED_WORD_BLOCKED'));
    setup();
    await userEvent.click(await screen.findByRole('button', { name: '1번 묶음 이름 바꾸기' }));
    const input = screen.getByLabelText('1번 묶음 이름');
    await userEvent.clear(input);
    await userEvent.type(input, '나쁜말{Enter}');
    expect(await screen.findByText('이름에 사용할 수 없는 표현이 들어 있습니다. 다른 말로 바꿔 주세요.')).toBeInTheDocument();

    await userEvent.clear(input);
    await userEvent.type(input, '가'.repeat(41));
    await userEvent.click(screen.getByRole('button', { name: '저장' }));
    expect(await screen.findByText('이름은 1자 이상 40자 이하로 입력해 주세요.')).toBeInTheDocument();
    expect(api.renameCluster).toHaveBeenCalledTimes(1);
  });

  it('직접 정한 이름은 "자동 이름으로 되돌리기"로 customName=null을 보낸다', async () => {
    const cluster = makeCluster({ customName: '내가 붙인 이름', displayName: '내가 붙인 이름' });
    api.get.mockResolvedValue(makeDetail({ clusters: [cluster, makeUnassignedCluster()] }));
    api.renameCluster.mockResolvedValue({ ...cluster, customName: null, displayName: cluster.autoName });
    setup();
    await userEvent.click(await screen.findByRole('button', { name: '1번 묶음 이름 바꾸기' }));
    await userEvent.click(screen.getByRole('button', { name: '자동 이름으로 되돌리기' }));

    await waitFor(() => expect(api.renameCluster).toHaveBeenCalledWith(CHATBOT_ID, ANALYSIS_ID, cluster.id, { customName: null }));
  });

  it('읽기 전용은 이름 바꾸기·"이 이름 사용"이 없다', async () => {
    api.get.mockResolvedValue(makeDetail({ nameSuggest: { status: 'DONE', failureReason: null }, clusters: [makeCluster({ suggestedName: '제안' }), makeUnassignedCluster()] }));
    setup({ permissions: ['dialogue:read'] });

    expect(await screen.findByText('AI 제안 — 확인 필요')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /이름 바꾸기/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '이 이름 사용' })).not.toBeInTheDocument();
  });
});

describe('UtteranceAnalysisDetailPage — 발화 표·선택(§5.6)', () => {
  it('제안 컨테이너(승인 전 라벨 + 안전 안내) 안에 표가 있고 배지 4종이 글자로 보인다', async () => {
    setup();

    const table = await screen.findByRole('table', { name: /발화 목록/ });
    expect(screen.getByText('분석 결과 (제안 · 승인 전)')).toBeInTheDocument();
    expect(screen.getByText('의도 예문으로 넣기 전까지는 챗봇 답변에 아무 영향이 없습니다.')).toBeInTheDocument();
    expect(within(table).getAllByText('학습 후보', { selector: '.severity-badge' }).length).toBeGreaterThan(0);
    expect(screen.getByText('금지어 포함 — 예문으로 넣을 수 없음')).toBeInTheDocument();
    expect(screen.getByText('가림 표시 포함')).toBeInTheDocument();
    expect(screen.getByText('반영됨 — 위약금')).toBeInTheDocument();
    expect(screen.getByText('답하지 못함')).toBeInTheDocument();
    expect(screen.getByText("답함 — 의도 '해지문의'")).toBeInTheDocument();
    expect(screen.getByText('답하지 못함 — 외부 문서 답변(2단계)으로 넘어감')).toBeInTheDocument();
    expect(screen.getByText('88점')).toBeInTheDocument();
    expect(screen.getByText('해지문의(52점)')).toBeInTheDocument();
    expect(screen.getByText('(글자 비슷함 기준)')).toBeInTheDocument();
  });

  it('금지어 발화와 이미 반영한 발화는 체크박스 대신 "—"+이유 글자이고, 나머지만 선택할 수 있다', async () => {
    setup();
    await screen.findByRole('table', { name: /발화 목록/ });

    expect(screen.getByRole('checkbox', { name: `${U1.text} 선택` })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: `${U2.text} 선택` })).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: `${U3.text} 선택` })).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: `${U4.text} 선택` })).not.toBeInTheDocument();
    expect(screen.getByText('금지어가 들어 있어 넣을 수 없습니다')).toBeInTheDocument();
    expect(screen.getByText('이미 의도에 넣은 발화입니다')).toBeInTheDocument();
  });

  it('읽기 전용은 선택 열·선택 바·넣기 버튼이 아예 없다(표는 동일)', async () => {
    setup({ permissions: ['dialogue:read'] });
    await screen.findByRole('table', { name: /발화 목록/ });

    expect(within(screen.getByRole('table', { name: /발화 목록/ })).queryByRole('checkbox')).toBeNull();
    expect(screen.queryByRole('button', { name: '선택한 발화를 의도 예문으로 넣기' })).not.toBeInTheDocument();
    expect(screen.queryByText('선택한 발화가 없습니다')).not.toBeInTheDocument();
    expect(screen.getByText(U1.text)).toBeInTheDocument();
  });

  it('보관 챗봇은 조회만: 선택 열·넣기·이름 바꾸기가 숨겨진다', async () => {
    setup({ chatbot: { status: 'ARCHIVED' } });
    await screen.findByRole('table', { name: /발화 목록/ });

    expect(within(screen.getByRole('table', { name: /발화 목록/ })).queryByRole('checkbox')).toBeNull();
    expect(screen.queryByRole('button', { name: /이름 바꾸기/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '선택한 발화를 의도 예문으로 넣기' })).not.toBeInTheDocument();
  });

  it('선택 수 글자는 변경이 멈춘 뒤 갱신되고, 0개면 넣기 버튼이 aria-disabled + 이유 글자', async () => {
    setup();
    await screen.findByRole('table', { name: /발화 목록/ });
    const apply = screen.getByRole('button', { name: '선택한 발화를 의도 예문으로 넣기' });
    expect(apply).toHaveAttribute('aria-disabled', 'true');
    expect(document.getElementById(apply.getAttribute('aria-describedby') ?? '')).toHaveTextContent('넣을 발화를 먼저 골라 주세요');
    expect(screen.getByText('선택한 발화가 없습니다')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('checkbox', { name: `${U1.text} 선택` }));
    await userEvent.click(screen.getByRole('checkbox', { name: `${U2.text} 선택` }));
    expect(await screen.findByText('2개 선택됨 — 최대 50개')).toBeInTheDocument();
    expect(apply).not.toHaveAttribute('aria-disabled');

    await userEvent.click(screen.getByRole('button', { name: '선택 모두 해제' }));
    expect(await screen.findByText('선택한 발화가 없습니다')).toBeInTheDocument();
  });

  it('머리 체크박스는 선택 가능한 것만 선택하고 일부만 선택되면 indeterminate이다', async () => {
    setup();
    await screen.findByRole('table', { name: /발화 목록/ });
    const head = screen.getByRole('checkbox', { name: '이 페이지에서 선택 가능한 발화 모두 선택' }) as HTMLInputElement;

    await userEvent.click(screen.getByRole('checkbox', { name: `${U1.text} 선택` }));
    expect(head.indeterminate).toBe(true);
    await userEvent.click(head);
    expect(head.checked).toBe(true);
    expect(await screen.findByText('2개 선택됨 — 최대 50개')).toBeInTheDocument(); // U3(금지어)·U4(반영됨)는 제외
  });

  it('한 번에 50개까지: 초과분은 aria-disabled + 이유 글자이고 "최대 50개까지 골랐습니다"를 알린다', async () => {
    const many = Array.from({ length: 60 }, (_, i) =>
      makeUtterance({ id: `u0000000-0000-4000-8000-${String(i).padStart(12, '0')}`, seq: i, text: `발화 ${i}` }),
    );
    api.listUtterances.mockResolvedValue(utterancePage(many, 60));
    setup();
    await screen.findByRole('table', { name: /발화 목록/ });

    await userEvent.click(screen.getByRole('checkbox', { name: '이 페이지에서 선택 가능한 발화 모두 선택' }));

    expect(await screen.findByText(/50개 선택됨 — 최대 50개 · 최대 50개까지 골랐습니다/)).toBeInTheDocument();
    const overflow = screen.getByRole('checkbox', { name: '발화 55 선택' });
    expect(overflow).toHaveAttribute('aria-disabled', 'true');
    expect(overflow).not.toBeChecked();
    await userEvent.click(overflow);
    expect(overflow).not.toBeChecked();
    expect(document.getElementById(overflow.getAttribute('aria-describedby') ?? '')).toHaveTextContent('한 번에 50개까지 고를 수 있습니다');
  });

  it('선택은 필터가 바뀌어도 유지된다', async () => {
    setup();
    await screen.findByRole('table', { name: /발화 목록/ });
    await userEvent.click(screen.getByRole('checkbox', { name: `${U1.text} 선택` }));
    api.listUtterances.mockResolvedValue(utterancePage([U2]));

    await userEvent.click(screen.getByRole('checkbox', { name: '아직 안 넣은 것만' }));
    await screen.findByRole('checkbox', { name: `${U2.text} 선택` });

    expect(await screen.findByText('1개 선택됨 — 최대 50개')).toBeInTheDocument();
  });
});

describe('UtteranceAnalysisDetailPage — 발화 표 필터·상태(§5.6)', () => {
  it('묶음·학습 후보만·아직 안 넣은 것만은 서버 쿼리로 전달된다(불리언은 true만)', async () => {
    setup();
    await screen.findByRole('table', { name: /발화 목록/ });
    expect(api.listUtterances).toHaveBeenLastCalledWith(CHATBOT_ID, ANALYSIS_ID, expect.objectContaining({ candidateOnly: false, unappliedOnly: false, page: 1, pageSize: 50 }));

    await userEvent.selectOptions(screen.getByLabelText('묶음'), UNASSIGNED_CLUSTER_ID);
    await userEvent.click(screen.getByRole('checkbox', { name: '학습 후보만' }));
    await userEvent.click(screen.getByRole('checkbox', { name: '아직 안 넣은 것만' }));

    await waitFor(() =>
      expect(api.listUtterances).toHaveBeenLastCalledWith(CHATBOT_ID, ANALYSIS_ID, expect.objectContaining({ clusterId: UNASSIGNED_CLUSTER_ID, candidateOnly: true, unappliedOnly: true, page: 1 })),
    );
  });

  it('묶음 필터 옵션은 "{번호}번 {이름}"·"미분류"이고 20개 이하는 select다', async () => {
    setup();
    const select = await screen.findByLabelText('묶음');

    expect(select.tagName).toBe('SELECT');
    expect(within(select).getByRole('option', { name: '1번 해지 · 환급 · 위약금' })).toBeInTheDocument();
    expect(within(select).getByRole('option', { name: '미분류' })).toBeInTheDocument();
  });

  it('묶음이 20개를 넘으면 select 대신 검색 가능한 콤보박스(datalist)를 쓴다', async () => {
    const clusters = Array.from({ length: 25 }, (_, i) => makeCluster({ id: `c0000000-0000-4000-8000-${String(i).padStart(12, '0')}`, ordinal: i + 1, displayName: `묶음${i + 1}` }));
    api.get.mockResolvedValue(makeDetail({ clusters }));
    setup();
    const input = await screen.findByLabelText('묶음');

    expect(input.tagName).toBe('INPUT');
    expect(input).toHaveAttribute('list', 'ua-filter-cluster-options');
    expect(document.querySelectorAll('#ua-filter-cluster-options option')).toHaveLength(25);
  });

  it('발화 검색은 입력이 멈춘 뒤 한 번만 조회하고 1~50자로 제한된다', async () => {
    setup();
    await screen.findByRole('table', { name: /발화 목록/ });
    const before = api.listUtterances.mock.calls.length;
    const search = screen.getByLabelText('발화 검색');
    expect(search).toHaveAttribute('maxlength', '50');
    await userEvent.type(search, '환불');

    await waitFor(() => expect(api.listUtterances).toHaveBeenLastCalledWith(CHATBOT_ID, ANALYSIS_ID, expect.objectContaining({ q: '환불' })), { timeout: 2000 });
    expect(api.listUtterances.mock.calls.length).toBe(before + 1);
  });

  it('대조를 하지 않은 분석은 "학습 후보만"이 비활성이고 이유 글자를 연결한다', async () => {
    api.get.mockResolvedValue(makeDetail({ probe: { status: 'OFF', failureReason: null, targetKind: null, versionNo: null, threshold: null, wouldUseRagCount: 0 } }));
    setup();

    const checkbox = await screen.findByRole('checkbox', { name: '학습 후보만' });
    expect(checkbox).toBeDisabled();
    expect(document.getElementById(checkbox.getAttribute('aria-describedby') ?? '')).toHaveTextContent('챗봇 대조를 하지 않아 사용할 수 없습니다');
  });

  it('결과 개수는 조회가 끝난 뒤 "검색 결과 N개 (전체 M개)"로 알린다', async () => {
    api.listUtterances.mockResolvedValue(utterancePage([U1, U2], 132));
    setup();

    expect(await screen.findByText('검색 결과 132개 (전체 2,870개)')).toBeInTheDocument();
  });

  it('필터 결과 0건이면 EmptyState + 필터 지우기, 조회 실패는 ErrorState + 다시 시도(다른 영역은 유지)', async () => {
    api.listUtterances.mockResolvedValue(utterancePage([], 0));
    setup({ initialQuery: '?candidate=true' });
    expect(await screen.findByText('조건에 맞는 발화가 없습니다')).toBeInTheDocument();
    expect(screen.getByRole('table', { name: /묶음 목록/ })).toBeInTheDocument();
    api.listUtterances.mockResolvedValue(utterancePage([U1]));
    await userEvent.click(screen.getAllByRole('button', { name: '필터 지우기' })[0]);
    expect(await screen.findByRole('table', { name: /발화 목록/ })).toBeInTheDocument();
  });

  it('발화 조회 실패는 표 영역에만 오류를 보인다', async () => {
    api.listUtterances.mockRejectedValueOnce(new ApiError(500, 'x'));
    setup();

    expect(await screen.findByText('발화 목록을 불러오지 못했습니다')).toBeInTheDocument();
    expect(screen.getByRole('table', { name: /묶음 목록/ })).toBeInTheDocument();
  });

  it('"발화 보기"는 그 묶음으로 필터를 걸고 발화 표 제목으로 포커스를 옮긴다', async () => {
    setup();
    await userEvent.click(await screen.findByRole('button', { name: '2번 묶음의 발화 보기' }));

    await waitFor(() => expect(api.listUtterances).toHaveBeenLastCalledWith(CHATBOT_ID, ANALYSIS_ID, expect.objectContaining({ clusterId: 'c2c2c2c2-0000-4000-8000-000000000002' })));
    await waitFor(() => expect(screen.getByRole('heading', { name: '발화 목록' })).toHaveFocus());
  });
});

describe('UtteranceAnalysisDetailPage — 예문으로 넣기 대화상자(UA-3a, §5.7)', () => {
  async function openDialog(): Promise<HTMLElement> {
    await screen.findByRole('table', { name: /발화 목록/ });
    await userEvent.click(screen.getByRole('checkbox', { name: `${U1.text} 선택` }));
    await userEvent.click(screen.getByRole('checkbox', { name: `${U2.text} 선택` }));
    await userEvent.click(await screen.findByRole('button', { name: '선택한 발화를 의도 예문으로 넣기' }));
    return screen.findByRole('dialog', { name: '예문으로 넣기' });
  }

  const preview = {
    target: { resolution: 'NEW' as const, intentId: null, intentName: '환불문의' },
    included: [
      { utteranceId: U1.id, text: U1.text, warnings: [] as Array<'MASK_TOKEN'> },
      { utteranceId: U2.id, text: U2.text, warnings: ['MASK_TOKEN' as const] },
    ],
    excluded: [{ utteranceId: 'ex-1', reason: 'DUPLICATE_IN_OTHER_INTENT' as const, conflictIntentName: '위약금' }],
    resultingExampleCount: 58,
    linkedNodeCount: null,
    draftOnly: false,
  };

  it('1단계: 단계 제목에 포커스, 라디오는 사전 선택 없음, 미선택 제출은 인라인 오류', async () => {
    setup();
    const dialog = await openDialog();

    const title = within(dialog).getByRole('heading', { name: '1/3 넣을 곳 고르기' });
    expect(title).toHaveFocus();
    expect(within(dialog).getByText('선택한 발화 2개를 의도의 예문으로 넣습니다. (한 번에 최대 50개)')).toBeInTheDocument();
    expect(within(dialog).getByRole('radio', { name: '이미 있는 의도에 넣기' })).not.toBeChecked();
    expect(within(dialog).getByRole('radio', { name: '새 의도를 만들어 넣기' })).not.toBeChecked();
    expect(within(dialog).getByText('새 의도는 특정 분류 없이 만들어집니다. 분류는 넣은 뒤 의도 화면에서 바꿀 수 있습니다.')).toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole('button', { name: '미리보기' }));
    expect(await within(dialog).findByText('넣을 곳을 골라 주세요.')).toBeInTheDocument();
    expect(api.previewApply).not.toHaveBeenCalled();
  });

  it('기존 의도를 고르지 않고 미리보기하면 의도 선택 오류를, 새 의도 이름이 비면 이름 오류를 보인다', async () => {
    setup();
    const dialog = await openDialog();
    await userEvent.click(within(dialog).getByRole('radio', { name: '이미 있는 의도에 넣기' }));
    await userEvent.click(within(dialog).getByRole('button', { name: '미리보기' }));
    expect(await within(dialog).findByText('넣을 의도를 골라 주세요.')).toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole('radio', { name: '새 의도를 만들어 넣기' }));
    await userEvent.click(within(dialog).getByRole('button', { name: '미리보기' }));
    expect(await within(dialog).findByText('새 의도 이름을 입력해 주세요.')).toBeInTheDocument();
    expect(api.previewApply).not.toHaveBeenCalled();
  });

  it('2단계 확인: 넣는 문장·빠지는 문장과 이유 문구·예상 예문 수·자동 저장 안내, 확정 버튼은 "예문 N개 넣기"', async () => {
    api.previewApply.mockResolvedValue(preview);
    setup();
    const dialog = await openDialog();
    await userEvent.click(within(dialog).getByRole('radio', { name: '새 의도를 만들어 넣기' }));
    await userEvent.type(within(dialog).getByLabelText(/새 의도 이름/), '환불문의');
    await userEvent.click(within(dialog).getByRole('button', { name: '미리보기' }));

    expect(await within(dialog).findByRole('heading', { name: '2/3 확인' })).toHaveFocus();
    expect(api.previewApply).toHaveBeenCalledWith(CHATBOT_ID, ANALYSIS_ID, { utteranceIds: [U1.id, U2.id], target: { kind: 'NEW', intentName: '환불문의' } });
    expect(within(dialog).getByText(/새 의도 '환불문의'을 만들어 넣습니다\./)).toBeInTheDocument();
    expect(within(dialog).getByText(/새 의도는 아직 어떤 대화상자와도 연결되어 있지 않습니다/)).toBeInTheDocument();
    expect(within(dialog).getByText('넣는 문장 2개 → 넣은 뒤 이 의도의 예문은 총 58개가 됩니다.')).toBeInTheDocument();
    expect(within(dialog).getByText(msg.applyMaskWarning, { exact: false })).toBeInTheDocument();
    expect(within(dialog).getByText('빠지는 문장 1개 (아래 이유로 넣을 수 없습니다)')).toBeInTheDocument();
    expect(within(dialog).getByText("다른 의도 '위약금'에 같은 예문이 이미 있습니다.")).toBeInTheDocument();
    expect(within(dialog).getByText('저장하면 바로 이 의도에 들어갑니다. 저장 직전 상태는 자동으로 버전 이력에 남습니다.', { exact: false })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: '예문 2개 넣기' })).toBeEnabled();
    // 초기 포커스는 확정 버튼이 아니다.
    expect(within(dialog).getByRole('button', { name: '예문 2개 넣기' })).not.toHaveFocus();
  });

  it('2단계: 제외 사유 7종이 각자의 문구로 나온다', async () => {
    api.previewApply.mockResolvedValue({
      ...preview,
      excluded: (['NOT_FOUND', 'ALREADY_APPLIED', 'BANNED_WORD', 'TOO_LONG', 'DUPLICATE_IN_TARGET', 'DUPLICATE_IN_OTHER_INTENT', 'TARGET_LIMIT'] as const).map((reason, i) => ({
        utteranceId: `ex-${i}`,
        reason,
        conflictIntentName: '위약금',
      })),
    });
    setup();
    const dialog = await openDialog();
    await userEvent.click(within(dialog).getByRole('radio', { name: '새 의도를 만들어 넣기' }));
    await userEvent.type(within(dialog).getByLabelText(/새 의도 이름/), 'x');
    await userEvent.click(within(dialog).getByRole('button', { name: '미리보기' }));

    const table = await within(dialog).findByRole('table', { name: '빠지는 문장과 이유' });
    for (const text of [
      '이 분석에 없는 발화입니다.',
      '이미 의도에 넣은 발화입니다.',
      '금지어가 들어 있는 문장입니다.',
      '200자를 넘는 문장입니다.',
      '이 의도에 같은 예문이 이미 있습니다.',
      "다른 의도 '위약금'에 같은 예문이 이미 있습니다.",
      '의도 하나에 넣을 수 있는 예문 수(500개)를 넘어 넣을 수 없습니다.',
    ]) {
      expect(within(table).getByText(text)).toBeInTheDocument();
    }
  });

  it('2단계: 환경 분리(draftOnly)·같은 이름 의도·연결 대화상자 0개 안내를 보이고, 넣을 문장이 0개면 확정 버튼이 aria-disabled', async () => {
    api.previewApply.mockResolvedValue({
      target: { resolution: 'EXISTING_BY_NAME', intentId: 'i-x', intentName: '환불문의' },
      included: [],
      excluded: [{ utteranceId: U1.id, reason: 'ALREADY_APPLIED' }],
      resultingExampleCount: 3,
      linkedNodeCount: 0,
      draftOnly: true,
    });
    setup();
    const dialog = await openDialog();
    await userEvent.click(within(dialog).getByRole('radio', { name: '새 의도를 만들어 넣기' }));
    await userEvent.type(within(dialog).getByLabelText(/새 의도 이름/), '환불문의');
    await userEvent.click(within(dialog).getByRole('button', { name: '미리보기' }));

    expect(await within(dialog).findByText(/같은 이름의 의도 '환불문의'이 이미 있어, 새로 만들지 않고 그 의도에 넣습니다/)).toBeInTheDocument();
    expect(within(dialog).getByText(/환경 분리 모드입니다\. 예문은 "초안"에만 들어가며/)).toBeInTheDocument();
    expect(within(dialog).getByText(/이 의도를 쓰는 대화상자가 없습니다/)).toBeInTheDocument();
    expect(within(dialog).queryByText(/저장 직전 상태는 자동으로 버전 이력에 남습니다/)).not.toBeInTheDocument();
    const confirm = within(dialog).getByRole('button', { name: '예문 0개 넣기' });
    expect(confirm).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(confirm);
    expect(api.apply).not.toHaveBeenCalled();
    // 뒤로 가면 1단계로 돌아가고 선택은 그대로다.
    await userEvent.click(within(dialog).getByRole('button', { name: '뒤로' }));
    expect(within(dialog).getByRole('heading', { name: '1/3 넣을 곳 고르기' })).toBeInTheDocument();
  });

  it('의도가 삭제된 경우(404)는 1단계에 머물고 "의도가 없습니다" 안내와 함께 선택기를 비운다', async () => {
    api.previewApply.mockRejectedValue(new ApiError(404, 'x', 'NOT_FOUND'));
    setup();
    const dialog = await openDialog();
    await userEvent.click(within(dialog).getByRole('radio', { name: '이미 있는 의도에 넣기' }));
    await userEvent.click(within(dialog).getByRole('button', { name: '의도 검색 고르기(시험용)' }));
    expect(within(dialog).getByText('선택됨: intent-existing')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: '미리보기' }));

    expect(await within(dialog).findByText('의도가 없습니다. 다른 의도를 골라 주세요.')).toBeInTheDocument();
    expect(within(dialog).getByRole('heading', { name: '1/3 넣을 곳 고르기' })).toBeInTheDocument();
    expect(within(dialog).queryByText('선택됨: intent-existing')).not.toBeInTheDocument();
  });

  it('3단계 결과: appliedImmediately 문구·건수·새 의도 생성·자동 스냅샷·실패 표, 닫으면 실패 발화만 선택에 남고 재조회한다', async () => {
    api.previewApply.mockResolvedValue(preview);
    api.apply.mockResolvedValue({
      succeeded: 1,
      intentId: 'i-new',
      intentName: '환불문의',
      created: true,
      excluded: [{ utteranceId: 'ex-1', reason: 'DUPLICATE_IN_OTHER_INTENT', conflictIntentName: '위약금' }],
      failed: [{ utteranceId: U2.id, code: 'INTERNAL_ERROR', message: '서버 내부 문구(화면에 보이면 안 됨)' }],
      appliedImmediately: true,
      linkedNodeCount: 0,
      draftOnly: false,
      autoSnapshot: { status: 'CREATED', versionNo: 12 },
    });
    setup();
    const dialog = await openDialog();
    await userEvent.click(within(dialog).getByRole('radio', { name: '새 의도를 만들어 넣기' }));
    await userEvent.type(within(dialog).getByLabelText(/새 의도 이름/), '환불문의');
    await userEvent.click(within(dialog).getByRole('button', { name: '미리보기' }));
    const confirm = await within(dialog).findByRole('button', { name: '예문 2개 넣기' });
    const listCalls = api.listUtterances.mock.calls.length;
    await userEvent.click(confirm);

    expect(await within(dialog).findByRole('heading', { name: '3/3 결과' })).toHaveFocus();
    expect(api.apply).toHaveBeenCalledTimes(1);
    expect(within(dialog).getByText(MESSAGES.learning.resolveSuccessImmediate)).toBeInTheDocument();
    expect(within(dialog).getByText('넣은 문장 1개 · 빠진 문장 1개 · 실패한 문장 1개')).toBeInTheDocument();
    expect(within(dialog).getByText("새 의도 '환불문의'을 만들었습니다")).toBeInTheDocument();
    expect(within(dialog).getByText(/v12로 자동 저장되었습니다/)).toBeInTheDocument();
    const failed = within(dialog).getByRole('table', { name: '넣지 못한 문장' });
    expect(within(failed).getByText(U2.text)).toBeInTheDocument();
    expect(within(failed).getByText(msg.genericError)).toBeInTheDocument();
    expect(dialog).not.toHaveTextContent('서버 내부 문구');
    expect(within(dialog).getByText(/이 의도를 쓰는 대화상자가 없습니다/)).toBeInTheDocument();

    await userEvent.click(within(dialog).getByText('닫기', { selector: 'button.btn' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    // 실패한 발화(U2)만 선택이 남는다 → 재시도 가능.
    expect(await screen.findByText('1개 선택됨 — 최대 50개')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: `${U2.text} 선택` })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: `${U1.text} 선택` })).not.toBeChecked();
    await waitFor(() => expect(api.listUtterances.mock.calls.length).toBeGreaterThan(listCalls));
    // 대화상자를 닫으면 트리거 버튼으로 포커스가 돌아온다.
    expect(screen.getByRole('button', { name: '선택한 발화를 의도 예문으로 넣기' })).toHaveFocus();
  });

  it('3단계: appliedImmediately=false는 대기열 문구, draftOnly는 초안 문구, 넣은 수 0은 "넣은 예문이 없습니다"', async () => {
    api.previewApply.mockResolvedValue(preview);
    api.apply.mockResolvedValue({ succeeded: 0, intentId: null, intentName: '환불문의', created: false, excluded: [], failed: [], appliedImmediately: false, linkedNodeCount: 1, draftOnly: false });
    setup();
    let dialog = await openDialog();
    await userEvent.click(within(dialog).getByRole('radio', { name: '새 의도를 만들어 넣기' }));
    await userEvent.type(within(dialog).getByLabelText(/새 의도 이름/), '환불문의');
    await userEvent.click(within(dialog).getByRole('button', { name: '미리보기' }));
    await userEvent.click(await within(dialog).findByRole('button', { name: '예문 2개 넣기' }));

    expect(await within(dialog).findByText('넣은 예문이 없습니다')).toBeInTheDocument();
    expect(within(dialog).queryByText(MESSAGES.learning.resolveSuccessImmediate)).not.toBeInTheDocument();

    // 같은 화면에서 다시 열어 draftOnly·대기열 문구도 확인한다.
    await userEvent.click(within(dialog).getByText('닫기', { selector: 'button.btn' }));
    api.apply.mockResolvedValue({ succeeded: 2, intentId: 'i', intentName: '환불문의', created: false, excluded: [], failed: [], appliedImmediately: false, linkedNodeCount: 1, draftOnly: true });
    await userEvent.click(await screen.findByRole('checkbox', { name: `${U1.text} 선택` }).then(async (c) => (c as HTMLInputElement).checked ? c : (await userEvent.click(c), c)));
    await userEvent.click(screen.getByRole('checkbox', { name: `${U2.text} 선택` }));
    await userEvent.click(await screen.findByRole('button', { name: '선택한 발화를 의도 예문으로 넣기' }));
    dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('radio', { name: '새 의도를 만들어 넣기' }));
    await userEvent.type(within(dialog).getByLabelText(/새 의도 이름/), '환불문의');
    await userEvent.click(within(dialog).getByRole('button', { name: '미리보기' }));
    await userEvent.click(await within(dialog).findByRole('button', { name: '예문 2개 넣기' }));
    expect(await within(dialog).findByText(msg.applyDraftDone)).toBeInTheDocument();
  });

  it('확정 요청 중에는 버튼이 disabled라 중복 실행되지 않고 닫기도 막힌다', async () => {
    api.previewApply.mockResolvedValue(preview);
    let resolve!: (v: unknown) => void;
    api.apply.mockReturnValue(new Promise((r) => (resolve = r)));
    setup();
    const dialog = await openDialog();
    await userEvent.click(within(dialog).getByRole('radio', { name: '새 의도를 만들어 넣기' }));
    await userEvent.type(within(dialog).getByLabelText(/새 의도 이름/), '환불문의');
    await userEvent.click(within(dialog).getByRole('button', { name: '미리보기' }));
    await userEvent.click(await within(dialog).findByRole('button', { name: '예문 2개 넣기' }));

    const busy = await within(dialog).findByRole('button', { name: '넣는 중…' });
    expect(busy).toBeDisabled();
    await userEvent.click(busy);
    await userEvent.keyboard('{Escape}');
    expect(api.apply).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('dialog')).toBeInTheDocument(); // Esc로도 닫히지 않는다.
    await act(async () => resolve({ succeeded: 2, intentId: 'i', intentName: '환불문의', created: true, excluded: [], failed: [], appliedImmediately: true, linkedNodeCount: 1, draftOnly: false }));
    expect(await within(dialog).findByRole('heading', { name: '3/3 결과' })).toBeInTheDocument();
  });

  it('확정 요청 전체 실패(네트워크·5xx)는 "이미 일부가 들어갔을 수 있다"는 경고와 다시 확인 버튼을 보인다', async () => {
    api.previewApply.mockResolvedValue(preview);
    api.apply.mockRejectedValue(new ApiError(500, 'x'));
    setup();
    const dialog = await openDialog();
    await userEvent.click(within(dialog).getByRole('radio', { name: '새 의도를 만들어 넣기' }));
    await userEvent.type(within(dialog).getByLabelText(/새 의도 이름/), '환불문의');
    await userEvent.click(within(dialog).getByRole('button', { name: '미리보기' }));
    await userEvent.click(await within(dialog).findByRole('button', { name: '예문 2개 넣기' }));

    expect(await within(dialog).findByText(/이미 일부가 들어갔을 수 있으니 발화 목록에서 "반영됨" 표시를 확인해 주세요/)).toBeInTheDocument();
    const listCalls = api.listUtterances.mock.calls.length;
    await userEvent.click(within(dialog).getByRole('button', { name: '다시 확인' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(api.listUtterances.mock.calls.length).toBeGreaterThan(listCalls));
  });

  it('409(완료 상태 아님)·보관 챗봇은 원인 문구를 대화상자 배너로 보인다', async () => {
    api.previewApply.mockRejectedValue(new ApiError(409, 'x', 'INVALID_STATUS_TRANSITION'));
    setup();
    const dialog = await openDialog();
    await userEvent.click(within(dialog).getByRole('radio', { name: '새 의도를 만들어 넣기' }));
    await userEvent.type(within(dialog).getByLabelText(/새 의도 이름/), 'x');
    await userEvent.click(within(dialog).getByRole('button', { name: '미리보기' }));

    expect(await within(dialog).findByText('분석이 완료된 상태에서만 넣을 수 있습니다.')).toBeInTheDocument();
  });
});

describe('UtteranceAnalysisDetailPage — 화면 용어 원칙(DC-15)', () => {
  it('완료 화면 전체 텍스트에 "토픽·군집·클러스터·임베딩·벡터"가 없다(도움말 clusterHelp 1문장만 예외)', async () => {
    api.get.mockResolvedValue(makeDetail({ notices: ['FEWER_THAN_TARGET', 'HEURISTIC_ANALYZER'], staleModel: true, nameSuggest: { status: 'PARTIAL', failureReason: null } }));
    setup();
    await screen.findByRole('table', { name: /발화 목록/ });

    const text = (document.body.textContent ?? '').replace(msg.clusterHelp, '');
    for (const word of ['토픽', '군집', '클러스터', '임베딩', '벡터']) {
      expect(text).not.toContain(word);
    }
    // 도움말 한 문장은 그대로 있다.
    expect(document.body.textContent).toContain(msg.clusterHelp);
  });

  it('처리 중·오류 화면에도 금지 용어가 없다', async () => {
    api.get.mockResolvedValue(running({ stage: 'PROBING' }));
    setup();
    await screen.findByRole('list', { name: '분석 단계' });

    const text = (document.body.textContent ?? '').replace(msg.clusterHelp, '');
    for (const word of ['토픽', '군집', '클러스터', '임베딩', '벡터']) {
      expect(text).not.toContain(word);
    }
  });
});

describe('UtteranceAnalysisDetailPage — 분석 전환(L-8)', () => {
  it('analysisId 라우트 파라미터가 바뀌면 선택·발화 목록·상태가 초기화되고 새 분석을 조회한다', async () => {
    setup();
    await screen.findByRole('table', { name: /발화 목록/ });
    await userEvent.click(screen.getByRole('checkbox', { name: `${U1.text} 선택` }));
    expect(await screen.findByText('1개 선택됨 — 최대 50개')).toBeInTheDocument();

    api.get.mockResolvedValue(makeDetail({ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', fileName: '다른파일.csv' }));
    api.listUtterances.mockResolvedValue(utterancePage([U1]));
    await userEvent.click(screen.getByRole('link', { name: '다른 분석으로' }));

    expect(await screen.findByRole('heading', { name: '다른파일.csv' })).toBeInTheDocument();
    expect(api.get).toHaveBeenLastCalledWith(CHATBOT_ID, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
    await screen.findByRole('table', { name: /발화 목록/ });
    expect(screen.getByText('선택한 발화가 없습니다')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: `${U1.text} 선택` })).not.toBeChecked();
  });
});
