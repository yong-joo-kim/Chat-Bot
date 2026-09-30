import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ApiError } from '../../../api/client';
import { ToastProvider } from '../../../components/Toast';
import { makeChatbot } from '../../../test/fixtures';
import type { ChatbotDetailContext } from '../../ChatbotDetailLayout';
import { NewAnalysisPage } from './NewAnalysisPage';
import { ANALYSIS_ID, CHATBOT_ID, makeCapability, makePreview } from './testFixtures';

let mockContext: ChatbotDetailContext;
vi.mock('../../ChatbotDetailLayout', () => ({
  useChatbotDetailContext: () => mockContext,
}));

const api = vi.hoisted(() => ({
  capability: vi.fn(),
  preview: vi.fn(),
  create: vi.fn(),
  downloadTemplate: vi.fn(),
}));
vi.mock('../../../api/utteranceAnalyses', () => ({ utteranceAnalysesApi: api }));

const base = `/chatbots/${CHATBOT_ID}/stats/utterance-analyses`;

function setup(chatbot: Parameters<typeof makeChatbot>[0] = {}): { setUnsavedGuard: ReturnType<typeof vi.fn> } {
  const setUnsavedGuard = vi.fn();
  mockContext = {
    chatbot: makeChatbot({ id: CHATBOT_ID, name: '주문 상담봇', ...chatbot }),
    reload: vi.fn().mockResolvedValue(undefined),
    setUnsavedGuard,
    learningSummary: null,
    refreshLearningSummary: vi.fn(),
  } as ChatbotDetailContext;
  render(
    <MemoryRouter initialEntries={[`${base}/new`]}>
      <ToastProvider>
        <Routes>
          <Route path={`${base}/new`} element={<NewAnalysisPage />} />
          <Route path={`${base}/:analysisId`} element={<p>결과 상세 화면</p>} />
          <Route path={base} element={<p>분석 목록 화면</p>} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>,
  );
  return { setUnsavedGuard };
}

const xlsx = (): File => new File(['x'], '3월_VOC.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });

async function pickFile(file = xlsx()): Promise<void> {
  await screen.findByText('대상 챗봇: 주문 상담봇');
  await userEvent.upload(document.getElementById('ua-file') as HTMLInputElement, file);
}

beforeEach(() => {
  Object.values(api).forEach((fn) => fn.mockReset());
  api.capability.mockResolvedValue(makeCapability());
  api.preview.mockResolvedValue(makePreview());
  api.create.mockResolvedValue({ analysisId: ANALYSIS_ID, status: 'QUEUED' });
});

describe('NewAnalysisPage — 조건 입력(§4.2~4.3)', () => {
  it('조건 7종이 레이블·권장값·범위 글자와 함께 기본값으로 보인다', async () => {
    setup();

    expect(await screen.findByText('대상 챗봇: 주문 상담봇')).toBeInTheDocument();
    expect(screen.getByLabelText(/목표 묶음 수/)).toHaveValue(10);
    expect(screen.getByLabelText(/묶음 최소 발화 수/)).toHaveValue(5);
    expect(screen.getByLabelText(/대표 키워드 수/)).toHaveValue(10);
    expect(screen.getByRole('checkbox', { name: '키워드는 명사만 사용' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: '지금 챗봇이 답하는지 대조하기' })).toBeChecked();
    expect(screen.getByLabelText('학습 후보 기준 점수(0~100)')).toHaveValue(null);
    expect(screen.getByText(/2~50 \(권장 10\)/)).toBeInTheDocument();
    expect(screen.getByText(/2~100 \(권장 5\)/)).toBeInTheDocument();
    expect(screen.getByText('현재 챗봇 답변과 비교합니다.')).toBeInTheDocument();
    // 챗봇은 고르지 않는다(글자로 고정).
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('이름 제안(AI)은 서버가 켜져 있을 때만 그린다', async () => {
    api.capability.mockResolvedValue(makeCapability({ nameSuggestAvailable: false }));
    setup();
    await screen.findByText('대상 챗봇: 주문 상담봇');
    expect(screen.queryByRole('checkbox', { name: /묶음 이름 제안 받기/ })).not.toBeInTheDocument();
  });

  it('이름 제안이 켜져 있으면 체크박스가 있고 값이 요청에 실린다', async () => {
    api.capability.mockResolvedValue(makeCapability({ nameSuggestAvailable: true }));
    setup();
    await userEvent.click(await screen.findByRole('checkbox', { name: /묶음 이름 제안 받기/ }));
    await pickFile();
    await screen.findByRole('table', { name: /파일 검사 결과/ });
    await userEvent.click(screen.getByRole('button', { name: '분석 시작' }));

    await waitFor(() => expect(api.create).toHaveBeenCalled());
    expect(api.create.mock.calls[0][2]).toMatchObject({ nameSuggest: true });
  });

  it('대조 대상 라디오는 환경 분리 모드일 때만 보인다', async () => {
    api.capability.mockResolvedValue(makeCapability({ envModeEnabled: true }));
    setup();

    expect(await screen.findByRole('radio', { name: '운영 중인 답변으로 대조' })).toBeChecked();
    expect(screen.getByRole('radio', { name: '편집 중인 초안으로 대조' })).not.toBeChecked();
    expect(screen.queryByText('현재 챗봇 답변과 비교합니다.')).not.toBeInTheDocument();
  });

  it('대조를 끄면 하위 입력이 disabled가 된다', async () => {
    setup();
    await userEvent.click(await screen.findByRole('checkbox', { name: '지금 챗봇이 답하는지 대조하기' }));
    expect(screen.getByLabelText('학습 후보 기준 점수(0~100)')).toBeDisabled();
  });
});

describe('NewAnalysisPage — 파일 검사(미리보기, §4.4~4.5)', () => {
  it('파일을 고르면 자동으로 검사하고 결과 표를 보인다(분석할 발화·제외·가림 등)', async () => {
    setup();
    await pickFile();

    const table = await screen.findByRole('table', { name: '파일 검사 결과 — 분석할 발화 2870개' });
    expect(api.preview).toHaveBeenCalledTimes(1);
    expect(api.preview.mock.calls[0][2]).toBe(5); // 최초 호출에 현재 최소 발화 수를 전달한다.
    expect(within(table).getByRole('rowheader', { name: /제외한 줄 — 너무 긴 문장 — 300자를 넘는 문장/ })).toBeInTheDocument();
    expect(within(table).getByRole('rowheader', { name: /금지어가 들어 있는 줄/ })).toBeInTheDocument();
    expect(within(table).getByText('5,932')).toBeInTheDocument();
    expect(screen.getByText('파일 검사를 마쳤습니다. 분석할 발화는 2870개입니다')).toBeInTheDocument();
  });

  it('검사 중에는 진행 안내를 보인다', async () => {
    let resolve!: (v: unknown) => void;
    api.preview.mockReturnValue(new Promise((r) => (resolve = r)));
    setup();
    await pickFile();

    expect((await screen.findAllByText('파일을 확인하는 중입니다')).length).toBeGreaterThan(0);
    await act(async () => resolve(makePreview()));
  });

  it('검사 실패(IMPORT_FILE_INVALID + header)는 파일 필드 아래에 서버의 머리글 안내를 그대로 보인다', async () => {
    api.preview.mockRejectedValue(new ApiError(400, 'x', 'IMPORT_FILE_INVALID', [{ field: 'header', message: '1열 머리글은 "발화"여야 합니다 — 양식을 받아 사용하세요' }]));
    setup();
    await pickFile();

    expect(await screen.findByText(/1열 머리글은 "발화"여야 합니다/)).toBeInTheDocument();
    expect(screen.queryByRole('table', { name: /파일 검사 결과/ })).not.toBeInTheDocument();
    // 파일 선택은 유지되어 다른 파일을 고르거나 양식을 받을 수 있다.
    expect(screen.getByText(/3월_VOC\.xlsx/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '양식 받기(엑셀)' })).toBeInTheDocument();
  });

  it('CP949 CSV(details.field=encoding)는 UTF-8 저장 안내를 파일 필드 인라인 오류로 보인다(미리보기)', async () => {
    api.preview.mockRejectedValue(new ApiError(400, 'x', 'IMPORT_FILE_INVALID', [{ field: 'encoding', message: 'UTF-8로 저장한 뒤 다시 올려 주세요.' }]));
    setup();
    await pickFile();

    expect(await screen.findByText(/UTF-8로 저장한 뒤 다시 올려 주세요\. 엑셀에서 "다른 이름으로 저장"/)).toBeInTheDocument();
    expect(screen.queryByText(/엑셀\(\.xlsx\) 또는 CSV 파일이 아닙니다/)).not.toBeInTheDocument();
  });

  it('CP949 CSV가 분석 요청에서 거절돼도 같은 안내를 파일 필드에 보이고 값은 유지한다', async () => {
    api.create.mockRejectedValue(new ApiError(400, 'x', 'IMPORT_FILE_INVALID', [{ field: 'encoding', message: 'x' }]));
    setup();
    await pickFile();
    await screen.findByRole('table', { name: /파일 검사 결과/ });
    await userEvent.click(screen.getByRole('button', { name: '분석 시작' }));

    expect(await screen.findByText(/UTF-8로 저장한 뒤 다시 올려 주세요/)).toBeInTheDocument();
    expect(screen.getByText(/3월_VOC\.xlsx/)).toBeInTheDocument();
  });

  it('details 없는 IMPORT_FILE_INVALID는 기존 일반 문구를 유지한다', async () => {
    api.preview.mockRejectedValue(new ApiError(400, 'x', 'IMPORT_FILE_INVALID'));
    setup();
    await pickFile();

    expect(await screen.findByText(/엑셀\(\.xlsx\) 또는 CSV 파일이 아닙니다/)).toBeInTheDocument();
  });

  it('최소 발화 수를 바꿔도 파일을 다시 올리지(검사를 다시 부르지) 않고 화면이 부족 여부를 다시 계산한다', async () => {
    api.preview.mockResolvedValue(makePreview({ validCount: 9, canAnalyze: false, reasonIfNot: 'TOO_FEW' }));
    setup();
    await pickFile();
    await screen.findByRole('table', { name: /파일 검사 결과/ });

    // 기본 5 → 발화 9개는 부족(최소 10개 필요).
    expect(screen.getByText(/분석할 발화가 9개라 '묶음 최소 발화 수'를 4 이하로 줄여야 합니다/)).toBeInTheDocument();
    expect(screen.getByText(/분석할 발화가 너무 적어 묶을 수 없습니다/)).toBeInTheDocument();

    const min = screen.getByLabelText(/묶음 최소 발화 수/);
    await userEvent.clear(min);
    await userEvent.type(min, '4');
    expect(screen.queryByText(/분석할 발화가 너무 적어 묶을 수 없습니다/)).not.toBeInTheDocument();
    await userEvent.clear(min);
    await userEvent.type(min, '6');
    expect(screen.getByText(/'묶음 최소 발화 수'를 4 이하로 줄여야 합니다/)).toBeInTheDocument();

    expect(api.preview).toHaveBeenCalledTimes(1);
  });

  it('다른 파일로 바꾸면 이전 검사 결과·오류를 지운다', async () => {
    setup();
    await pickFile();
    await screen.findByRole('table', { name: /파일 검사 결과/ });
    await userEvent.click(screen.getByRole('button', { name: '파일 제거' }));

    expect(screen.queryByRole('table', { name: /파일 검사 결과/ })).not.toBeInTheDocument();
  });
});

describe('NewAnalysisPage — 제출 검증·요청(§4.4~4.5)', () => {
  it('파일 없이 제출하면 파일 필드 오류를 보이고 요청하지 않는다', async () => {
    setup();
    await userEvent.click(await screen.findByRole('button', { name: '분석 시작' }));

    expect(await screen.findByText('발화 파일을 선택해 주세요.')).toBeInTheDocument();
    expect(api.create).not.toHaveBeenCalled();
  });

  it('숫자 범위 오류는 제출 시점에 필드별 인라인으로 보이고 첫 오류 필드로 포커스가 간다', async () => {
    setup();
    await pickFile();
    await screen.findByRole('table', { name: /파일 검사 결과/ });
    const target = screen.getByLabelText(/목표 묶음 수/);
    const kw = screen.getByLabelText(/대표 키워드 수/);
    await userEvent.clear(target);
    await userEvent.type(target, '99');
    await userEvent.clear(kw);
    await userEvent.type(kw, '0');
    await userEvent.type(screen.getByLabelText('학습 후보 기준 점수(0~100)'), '150');

    await userEvent.click(screen.getByRole('button', { name: '분석 시작' }));

    expect(await screen.findByText('목표 묶음 수는 2 이상 50 이하의 숫자로 입력해 주세요.')).toBeInTheDocument();
    expect(screen.getByText('대표 키워드 수는 1 이상 20 이하의 숫자로 입력해 주세요.')).toBeInTheDocument();
    expect(screen.getByText('0 이상 100 이하의 숫자로 입력하거나 비워 주세요.')).toBeInTheDocument();
    expect(target).toHaveFocus();
    expect(target).toHaveAttribute('aria-invalid', 'true');
    expect(api.create).not.toHaveBeenCalled();
  });

  it('발화 부족이면 제출을 막고 최소 발화 수 필드에 인라인 오류를 보인다', async () => {
    api.preview.mockResolvedValue(makePreview({ validCount: 9 }));
    setup();
    await pickFile();
    await screen.findByRole('table', { name: /파일 검사 결과/ });
    await userEvent.click(screen.getByRole('button', { name: '분석 시작' }));

    expect(await screen.findByText('분석할 발화가 9개라 최소 발화 수는 4 이하여야 합니다.')).toBeInTheDocument();
    expect(screen.getByLabelText(/묶음 최소 발화 수/)).toHaveFocus();
    expect(api.create).not.toHaveBeenCalled();
  });

  it('성공(202): 파일+조건 JSON을 보내고(점수는 0~1로 변환) 결과 화면으로 이동하며 토스트를 띄운다', async () => {
    setup();
    await pickFile();
    await screen.findByRole('table', { name: /파일 검사 결과/ });
    await userEvent.type(screen.getByLabelText('학습 후보 기준 점수(0~100)'), '60');
    await userEvent.click(screen.getByRole('button', { name: '분석 시작' }));

    expect(await screen.findByText('결과 상세 화면')).toBeInTheDocument();
    expect(api.create).toHaveBeenCalledTimes(1);
    const [chatbotId, file, conditions] = api.create.mock.calls[0];
    expect(chatbotId).toBe(CHATBOT_ID);
    expect((file as File).name).toBe('3월_VOC.xlsx');
    expect(conditions).toEqual({
      targetClusterCount: 10,
      minClusterSize: 5,
      keywordCount: 10,
      nounsOnly: true,
      probe: { enabled: true, target: 'SERVING', scoreThreshold: 0.6 },
      nameSuggest: false,
    });
    expect(screen.getByText('분석을 시작했습니다. 이 화면을 닫아도 계속 진행됩니다.')).toBeInTheDocument();
  });

  it('요청 중에는 버튼이 disabled + "요청을 보내는 중…"이라 중복 제출되지 않는다', async () => {
    let resolve!: (v: unknown) => void;
    api.create.mockReturnValue(new Promise((r) => (resolve = r)));
    setup();
    await pickFile();
    await screen.findByRole('table', { name: /파일 검사 결과/ });
    await userEvent.click(screen.getByRole('button', { name: '분석 시작' }));

    const busy = await screen.findByRole('button', { name: '요청을 보내는 중…' });
    expect(busy).toBeDisabled();
    await userEvent.click(busy);
    expect(api.create).toHaveBeenCalledTimes(1);
    await act(async () => resolve({ analysisId: ANALYSIS_ID, status: 'QUEUED' }));
  });

  it('409 BUSY: 상단 배너(포커스 이동)+분석 목록 링크, 파일과 입력값은 그대로 유지된다', async () => {
    api.create.mockRejectedValue(new ApiError(409, 'x', 'UTTERANCE_ANALYSIS_BUSY'));
    setup();
    await pickFile();
    await screen.findByRole('table', { name: /파일 검사 결과/ });
    const target = screen.getByLabelText(/목표 묶음 수/);
    await userEvent.clear(target);
    await userEvent.type(target, '12');
    await userEvent.click(screen.getByRole('button', { name: '분석 시작' }));

    const banner = await screen.findByText(/다른 분석이 진행 중입니다\. 끝난 뒤 다시 요청해 주세요/);
    await waitFor(() => expect(banner.closest('[tabindex="-1"]')).toHaveFocus());
    expect(screen.getAllByRole('link', { name: '분석 목록 보기' }).length).toBeGreaterThan(0);
    expect(screen.getByText(/3월_VOC\.xlsx/)).toBeInTheDocument();
    expect(screen.getByLabelText(/목표 묶음 수/)).toHaveValue(12);
    expect(screen.getByRole('button', { name: '분석 시작' })).toBeEnabled();
  });

  it('EGRESS_HOST_NOT_ALLOWED(이름 제안 필드)는 이름 제안 체크박스 아래에 안내한다', async () => {
    api.capability.mockResolvedValue(makeCapability({ nameSuggestAvailable: true }));
    api.create.mockRejectedValue(new ApiError(409, 'x', 'EGRESS_HOST_NOT_ALLOWED', [{ field: 'nameSuggest', message: 'x' }]));
    setup();
    await userEvent.click(await screen.findByRole('checkbox', { name: /묶음 이름 제안 받기/ }));
    await pickFile();
    await screen.findByRole('table', { name: /파일 검사 결과/ });
    await userEvent.click(screen.getByRole('button', { name: '분석 시작' }));

    expect(await screen.findByText(/이름 제안 서비스 주소가 허용되지 않았습니다/)).toBeInTheDocument();
  });

  it('서버 상태로 막혀 있으면(연결 불가) 제출해도 요청하지 않고 이유가 글자로 연결된다', async () => {
    api.capability.mockResolvedValue(makeCapability({ embeddingAvailable: false }));
    setup();
    await pickFile();
    await screen.findByRole('table', { name: /파일 검사 결과/ });
    const submit = screen.getByRole('button', { name: '분석 시작' });
    await waitFor(() => expect(submit).toHaveAttribute('aria-disabled', 'true'));
    await userEvent.click(submit);

    expect(api.create).not.toHaveBeenCalled();
    expect(document.getElementById(submit.getAttribute('aria-describedby') ?? '')).toHaveTextContent('문장 분석 서비스에 연결할 수 없어');
  });
});

describe('NewAnalysisPage — 이탈 확인 · 보관 · 꺼짐', () => {
  it('입력이 있으면 이탈 가드를 등록하고, 입력이 없으면 해제한다', async () => {
    const { setUnsavedGuard } = setup();
    await screen.findByText('대상 챗봇: 주문 상담봇');
    expect(setUnsavedGuard).toHaveBeenLastCalledWith(null);
    await pickFile();
    await waitFor(() => expect(setUnsavedGuard).toHaveBeenLastCalledWith(expect.any(Function)));
  });

  it('보관 챗봇은 폼 대신 안내 배너와 목록 링크만 보인다', async () => {
    setup({ status: 'ARCHIVED' });
    expect(await screen.findByRole('link', { name: '분석 목록으로' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '분석 시작' })).not.toBeInTheDocument();
  });

  it('기능 꺼짐(capability 404)이면 꺼짐 화면을 보인다', async () => {
    api.capability.mockRejectedValue(new ApiError(404, 'x'));
    setup();
    expect(await screen.findByText('발화 묶음 분석 기능이 꺼져 있습니다')).toBeInTheDocument();
  });
});
