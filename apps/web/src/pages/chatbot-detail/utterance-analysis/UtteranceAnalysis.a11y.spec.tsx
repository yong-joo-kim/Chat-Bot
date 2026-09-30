import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe, toHaveNoViolations } from 'jest-axe';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ToastProvider } from '../../../components/Toast';
import { makeChatbot } from '../../../test/fixtures';
import type { ChatbotDetailContext } from '../../ChatbotDetailLayout';
import { NewAnalysisPage } from './NewAnalysisPage';
import { UtteranceAnalysisDataMapSection } from './UtteranceAnalysisDataMapSection';
import { UtteranceAnalysisDetailPage } from './UtteranceAnalysisDetailPage';
import { UtteranceAnalysisListPage } from './UtteranceAnalysisListPage';
import { ANALYSIS_ID, CHATBOT_ID, makeCapability, makeCluster, makeDetail, makeListItem, makePreview, makeUnassignedCluster, makeUtterance } from './testFixtures';

expect.extend(toHaveNoViolations);

let mockContext: ChatbotDetailContext;
vi.mock('../../ChatbotDetailLayout', () => ({
  useChatbotDetailContext: () => mockContext,
}));
vi.mock('../../../context/AuthContext', () => ({
  useAuth: () => ({ can: () => true, user: { governanceModeOn: true } }),
}));
// 대화상자의 의도 검색 콤보박스는 ResourcePickerField 자체 시험이 따로 있어 대역으로 바꾼다.
vi.mock('../../../components/ResourcePickerField', () => ({
  ResourcePickerField: (p: { label: string; onChange: (v: string | null) => void; id: string }) => (
    <div>
      <label htmlFor={p.id}>{p.label}</label>
      <input id={p.id} type="text" onChange={() => p.onChange('intent-existing')} />
    </div>
  ),
}));

const api = vi.hoisted(() => ({
  capability: vi.fn(),
  list: vi.fn(),
  get: vi.fn(),
  listUtterances: vi.fn(),
  preview: vi.fn(),
  create: vi.fn(),
  previewApply: vi.fn(),
  apply: vi.fn(),
  downloadTemplate: vi.fn(),
}));
vi.mock('../../../api/utteranceAnalyses', () => ({ utteranceAnalysesApi: api }));

// 대화상자는 body에 포털로 붙어 body 전체를 스캔해야 한다. 격리 렌더에는 페이지 수준 랜드마크가 없으므로 그 규칙(region)만 끈다.
const BODY_SCAN = { rules: { region: { enabled: false } } };

const base = `/chatbots/${CHATBOT_ID}/stats/utterance-analyses`;

function renderAt(path: string): ReturnType<typeof render> {
  mockContext = {
    chatbot: makeChatbot({ id: CHATBOT_ID }),
    reload: vi.fn().mockResolvedValue(undefined),
    setUnsavedGuard: vi.fn(),
    learningSummary: null,
    refreshLearningSummary: vi.fn(),
  } as ChatbotDetailContext;
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ToastProvider>
        <Routes>
          <Route path={base} element={<UtteranceAnalysisListPage />} />
          <Route path={`${base}/new`} element={<NewAnalysisPage />} />
          <Route path={`${base}/:analysisId`} element={<UtteranceAnalysisDetailPage />} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>,
  );
}

const U1 = makeUtterance();
const U2 = makeUtterance({ id: 'u0000000-0000-4000-8000-000000000002', text: '위약금 얼마예요', learningCandidate: false, hasBannedWord: true });

beforeEach(() => {
  Object.values(api).forEach((fn) => fn.mockReset());
  api.capability.mockResolvedValue(makeCapability({ nameSuggestAvailable: true, envModeEnabled: true }));
  api.list.mockResolvedValue({
    items: [
      makeListItem(),
      makeListItem({ id: 'r2', status: 'RUNNING', stage: 'CLUSTERING', progress: 40, fileName: 'b.csv' }),
      makeListItem({ id: 'r3', status: 'FAILED', fileName: 'c.csv', failureReason: 'SAVE_FAILED' }),
    ],
    total: 3,
    page: 1,
    pageSize: 20,
  });
  api.get.mockResolvedValue(makeDetail({ nameSuggest: { status: 'DONE', failureReason: null }, clusters: [makeCluster({ suggestedName: '제안 이름' }), makeUnassignedCluster()] }));
  api.listUtterances.mockResolvedValue({ items: [U1, U2], total: 2, page: 1, pageSize: 50 });
  api.preview.mockResolvedValue(makePreview());
});

/** NFR-DCA — 신규 화면 axe 스캔 위반 0건(deep-clustering-ui-spec.md §9 공통). */
describe('발화 묶음 분석 화면 — axe 접근성 스캔', () => {
  it('UA-1 분석 목록(완료·처리 중·오류 행)', async () => {
    const { container } = renderAt(base);
    await screen.findByRole('table', { name: '발화 묶음 분석 목록' });
    expect(await axe(container)).toHaveNoViolations();
  });

  it('UA-1 분석 목록 — 빈 상태', async () => {
    api.list.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });
    const { container } = renderAt(base);
    await screen.findByText('아직 만든 분석이 없습니다');
    expect(await axe(container)).toHaveNoViolations();
  });

  it('UA-2 새 분석(검사 결과 표·조건·이름 제안·환경 분리 라디오까지 펼친 상태)', async () => {
    const { container } = renderAt(`${base}/new`);
    await screen.findByText(/대상 챗봇/);
    await userEvent.upload(document.getElementById('ua-file') as HTMLInputElement, new File(['x'], 'a.xlsx'));
    await screen.findByRole('table', { name: /파일 검사 결과/ });
    expect(screen.getByRole('radio', { name: '운영 중인 답변으로 대조' })).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('UA-2 새 분석 — 제출 오류가 모두 표시된 상태', async () => {
    const { container } = renderAt(`${base}/new`);
    await screen.findByText(/대상 챗봇/);
    await userEvent.clear(screen.getByLabelText(/목표 묶음 수/));
    await userEvent.click(screen.getByRole('button', { name: '분석 시작' }));
    await screen.findByText('발화 파일을 선택해 주세요.');
    expect(await axe(container)).toHaveNoViolations();
  });

  it('UA-3 처리 중', async () => {
    api.get.mockResolvedValue(makeDetail({ status: 'RUNNING', stage: 'PROBING', progress: 60, clusters: [], durationMs: null }));
    const { container } = renderAt(`${base}/${ANALYSIS_ID}`);
    await screen.findByRole('list', { name: '분석 단계' });
    expect(await axe(container)).toHaveNoViolations();
  });

  it('UA-3 오류 · 취소', async () => {
    api.get.mockResolvedValue(makeDetail({ status: 'FAILED', failureReason: 'CLUSTERING_FAILED', clusters: [] }));
    const { container } = renderAt(`${base}/${ANALYSIS_ID}`);
    await screen.findByText('분석이 끝나지 못했습니다');
    expect(await axe(container)).toHaveNoViolations();
  });

  it('UA-3 완료(묶음 표·AI 제안·알림·발화 표·선택 바)', async () => {
    api.get.mockResolvedValue(
      makeDetail({
        notices: ['FEWER_THAN_TARGET', 'HEURISTIC_ANALYZER'],
        nameSuggest: { status: 'DONE', failureReason: null },
        clusters: [makeCluster({ suggestedName: '제안 이름' }), makeUnassignedCluster()],
      }),
    );
    const { container } = renderAt(`${base}/${ANALYSIS_ID}`);
    await screen.findByRole('table', { name: /발화 목록/ });
    await userEvent.click(screen.getByRole('button', { name: '1번 묶음 대표 발화 보기' }));
    await userEvent.click(screen.getByRole('checkbox', { name: `${U1.text} 선택` }));
    expect(screen.getByText('AI 제안 — 확인 필요')).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('UA-3 완료 — 이름 바꾸기 편집 중', async () => {
    const { container } = renderAt(`${base}/${ANALYSIS_ID}`);
    await userEvent.click(await screen.findByRole('button', { name: '1번 묶음 이름 바꾸기' }));
    expect(screen.getByLabelText('1번 묶음 이름')).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('UA-3a 예문으로 넣기 대화상자 1·2·3단계', async () => {
    api.previewApply.mockResolvedValue({
      target: { resolution: 'EXISTING', intentId: 'intent-existing', intentName: '해지문의' },
      included: [{ utteranceId: U1.id, text: U1.text, warnings: ['MASK_TOKEN'] }],
      excluded: [{ utteranceId: U2.id, reason: 'BANNED_WORD' }],
      resultingExampleCount: 4,
      linkedNodeCount: 0,
      draftOnly: true,
    });
    api.apply.mockResolvedValue({
      succeeded: 1,
      intentId: 'intent-existing',
      intentName: '해지문의',
      created: false,
      excluded: [{ utteranceId: U2.id, reason: 'BANNED_WORD' }],
      failed: [{ utteranceId: 'x', code: 'INTERNAL_ERROR', message: 'x' }],
      appliedImmediately: true,
      linkedNodeCount: 0,
      draftOnly: false,
      autoSnapshot: { status: 'CREATED', versionNo: 3 },
    });
    renderAt(`${base}/${ANALYSIS_ID}`);
    await screen.findByRole('table', { name: /발화 목록/ });
    await userEvent.click(screen.getByRole('checkbox', { name: `${U1.text} 선택` }));
    await userEvent.click(screen.getByRole('button', { name: '선택한 발화를 의도 예문으로 넣기' }));
    const dialog = await screen.findByRole('dialog', { name: '예문으로 넣기' });

    // 1단계
    expect(await axe(document.body, BODY_SCAN)).toHaveNoViolations();
    await userEvent.click(within(dialog).getByRole('radio', { name: '이미 있는 의도에 넣기' }));
    await userEvent.type(within(dialog).getByLabelText('의도 검색'), 'a');
    await userEvent.click(within(dialog).getByRole('button', { name: '미리보기' }));
    // 2단계
    await within(dialog).findByRole('heading', { name: '2/3 확인' });
    expect(await axe(document.body, BODY_SCAN)).toHaveNoViolations();
    await userEvent.click(within(dialog).getByRole('button', { name: '예문 1개 넣기' }));
    // 3단계
    await within(dialog).findByRole('heading', { name: '3/3 결과' });
    await waitFor(() => expect(within(dialog).getByRole('table', { name: '넣지 못한 문장' })).toBeInTheDocument());
    expect(await axe(document.body, BODY_SCAN)).toHaveNoViolations();
  });

  it('UA-3b 삭제 확인 대화상자', async () => {
    renderAt(`${base}/${ANALYSIS_ID}`);
    await userEvent.click(await screen.findByRole('button', { name: '삭제' }));
    await screen.findByRole('dialog', { name: '분석 결과를 삭제할까요?' });
    expect(await axe(document.body, BODY_SCAN)).toHaveNoViolations();
  });

  it('UA-4 데이터 지도 절', async () => {
    const { container } = render(
      <UtteranceAnalysisDataMapSection
        map={{ analyses: 4, utterances: 9120, retentionDays: 90, storesMaskedOnly: true, originalFileStored: false, exits: ['EMBEDDING', 'AUGMENT_LOCAL'], nameSuggestEnabled: true, retentionJobEnabled: false }}
      />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
