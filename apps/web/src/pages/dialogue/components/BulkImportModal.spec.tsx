import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '../../../components/Toast';
import { ApiError } from '../../../api/client';
import { BulkImportModal } from './BulkImportModal';

const mockImportValidate = vi.fn();
const mockImportCommit = vi.fn();

vi.mock('../../../api/dialogue', () => ({
  intentsApi: {
    importValidate: (...args: unknown[]) => mockImportValidate(...args),
    importCommit: (...args: unknown[]) => mockImportCommit(...args),
    templateUrl: (chatbotId: string, format: string) => `/api/v1/chatbots/${chatbotId}/intents/import/template?format=${format}`,
  },
  keywordsApi: { importValidate: vi.fn(), importCommit: vi.fn(), templateUrl: vi.fn() },
  faqsApi: { importValidate: vi.fn(), importCommit: vi.fn(), templateUrl: vi.fn() },
}));

function renderModal(onCommitted = vi.fn()): ReturnType<typeof render> {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <BulkImportModal resourceType="INTENT" chatbotId="bot-1" isOpen onClose={vi.fn()} onCommitted={onCommitted} />
      </ToastProvider>
    </MemoryRouter>,
  );
}

function makeFile(name = 'intents.csv'): File {
  return new File(['의도명,예문\n주문_배송조회,배송 조회'], name, { type: 'text/csv' });
}

/**
 * 대량 업로드 3단계(파일선택 → 검증 리포트 → 확정) 회귀 시험(FR-6-21, ui-spec §4.4).
 * M2 리뷰 수정(그룹 전체 스킵 예고)은 `apps/api` 통합 테스트에서 서버 계약으로 검증하고,
 * 여기서는 화면이 서버 응답(errors/conflicts/skippedRows)을 그대로 반영해 보여주는지 확인한다.
 */
describe('BulkImportModal — 대량 업로드 3단계 플로우', () => {
  beforeEach(() => {
    mockImportValidate.mockReset();
    mockImportCommit.mockReset();
  });

  it('1단계: 파일을 선택하고 "검증하기"를 누르면 importValidate가 호출되고 2단계 리포트로 전환된다', async () => {
    const user = userEvent.setup();
    mockImportValidate.mockResolvedValue({
      importToken: 'token-1',
      expiresAt: new Date(),
      resourceType: 'INTENT',
      totalRows: 3,
      newItems: 1,
      updatedItems: 0,
      newValues: 2,
      duplicatedRows: 1,
      errors: [{ row: 3, column: 'name', value: '', code: 'EMPTY_NAME', message: '이름이 비어 있습니다.' }],
      conflicts: [],
    });
    renderModal();

    expect(screen.getByText('1/3 파일 선택')).toBeInTheDocument();
    const fileInput = screen.getByLabelText('파일 선택');
    await user.upload(fileInput, makeFile());
    expect(await screen.findByText(/intents\.csv/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '검증하기' }));

    await waitFor(() => expect(mockImportValidate).toHaveBeenCalledTimes(1));
    expect(mockImportValidate.mock.calls[0][0]).toBe('bot-1');
    expect(mockImportValidate.mock.calls[0][1]).toBeInstanceOf(FormData);

    expect(await screen.findByText('2/3 검증 결과')).toBeInTheDocument();
    expect(screen.getByText('신규 1건')).toBeInTheDocument();
    expect(screen.getByText('중복 무시 1건')).toBeInTheDocument();
    expect(screen.getByText('오류 1건')).toBeInTheDocument();
  });

  it('2단계: 병합/오류 정책을 선택하고 "반영하기"를 누르면 importCommit이 선택한 정책으로 호출되고 3단계로 전환된다', async () => {
    const user = userEvent.setup();
    const onCommitted = vi.fn();
    mockImportValidate.mockResolvedValue({
      importToken: 'token-2',
      expiresAt: new Date(),
      resourceType: 'INTENT',
      totalRows: 2,
      newItems: 2,
      updatedItems: 0,
      newValues: 2,
      duplicatedRows: 0,
      errors: [],
      conflicts: [],
    });
    mockImportCommit.mockResolvedValue({ createdItems: 2, updatedItems: 0, createdValues: 2, skippedRows: 0, errors: [] });
    renderModal(onCommitted);

    await user.upload(screen.getByLabelText('파일 선택'), makeFile());
    await user.click(screen.getByRole('button', { name: '검증하기' }));
    await screen.findByText('2/3 검증 결과');

    await user.click(screen.getByRole('radio', { name: /전체교체/ }));
    await user.click(screen.getByRole('radio', { name: /오류가 있으면 전체 취소/ }));
    await user.click(screen.getByRole('button', { name: '반영하기' }));

    await waitFor(() =>
      expect(mockImportCommit).toHaveBeenCalledWith('bot-1', {
        importToken: 'token-2',
        mergePolicy: 'REPLACE',
        errorPolicy: 'ABORT_ON_ERROR',
      }),
    );

    expect(await screen.findByText('3/3 완료')).toBeInTheDocument();
    expect(screen.getByText(/신규 2건/)).toBeInTheDocument();
    expect(onCommitted).toHaveBeenCalledTimes(1);
  });

  it('AC-6B-6: 만료된 importToken으로 커밋하면 재검증 안내 배너가 표시되고 1단계로 되돌릴 수 있다', async () => {
    const user = userEvent.setup();
    mockImportValidate.mockResolvedValue({
      importToken: 'expired-token',
      expiresAt: new Date(),
      resourceType: 'INTENT',
      totalRows: 1,
      newItems: 1,
      updatedItems: 0,
      newValues: 1,
      duplicatedRows: 0,
      errors: [],
      conflicts: [],
    });
    mockImportCommit.mockRejectedValue(new ApiError(400, '검증 결과가 만료되었습니다(10분). 파일을 다시 검증해 주세요.', 'IMPORT_TOKEN_EXPIRED'));
    renderModal();

    await user.upload(screen.getByLabelText('파일 선택'), makeFile());
    await user.click(screen.getByRole('button', { name: '검증하기' }));
    await screen.findByText('2/3 검증 결과');
    await user.click(screen.getByRole('button', { name: '반영하기' }));

    expect(await screen.findByText('검증 결과가 만료되었습니다. 파일을 다시 검증해 주세요.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '다시 검증하기' }));
    expect(await screen.findByText('1/3 파일 선택')).toBeInTheDocument();
  });

  it('AC-6B-4: ABORT_ON_ERROR 커밋이 400으로 거부되면 전체 취소 배너가 표시된다', async () => {
    const user = userEvent.setup();
    mockImportValidate.mockResolvedValue({
      importToken: 'token-3',
      expiresAt: new Date(),
      resourceType: 'INTENT',
      totalRows: 2,
      newItems: 1,
      updatedItems: 0,
      newValues: 1,
      duplicatedRows: 0,
      errors: [{ row: 2, column: 'name', value: '', code: 'EMPTY_NAME', message: '이름이 비어 있습니다.' }],
      conflicts: [],
    });
    mockImportCommit.mockRejectedValue(
      new ApiError(400, '오류 1건이 있어 전체를 취소했습니다. 한 건도 반영되지 않았습니다.', 'IMPORT_ABORTED'),
    );
    renderModal();

    await user.upload(screen.getByLabelText('파일 선택'), makeFile());
    await user.click(screen.getByRole('button', { name: '검증하기' }));
    await screen.findByText('2/3 검증 결과');
    await user.click(screen.getByRole('radio', { name: /오류가 있으면 전체 취소/ }));
    await user.click(screen.getByRole('button', { name: '반영하기' }));

    expect(await screen.findByText(/오류 1건이 있어 전체를 취소했습니다\. 한 건도 반영되지 않았습니다\./)).toBeInTheDocument();
    // 취소되었으므로 여전히 2단계에 머무른다(3단계로 넘어가지 않음).
    expect(screen.getByText('2/3 검증 결과')).toBeInTheDocument();
  });

  it('검증 중에는 "검증하기" 버튼이 비활성화되어 중복 제출을 막는다(UIUX §4)', async () => {
    const user = userEvent.setup();
    let resolveValidate: (v: unknown) => void = () => undefined;
    mockImportValidate.mockReturnValue(new Promise((resolve) => (resolveValidate = resolve)));
    renderModal();

    await user.upload(screen.getByLabelText('파일 선택'), makeFile());
    const validateButton = screen.getByRole('button', { name: '검증하기' });
    await user.click(validateButton);

    expect(await screen.findByRole('button', { name: '검증 중…' })).toBeDisabled();
    expect(mockImportValidate).toHaveBeenCalledTimes(1);

    resolveValidate({
      importToken: 't',
      expiresAt: new Date(),
      resourceType: 'INTENT',
      totalRows: 0,
      newItems: 0,
      updatedItems: 0,
      newValues: 0,
      duplicatedRows: 0,
      errors: [],
      conflicts: [],
    });
    await screen.findByText('2/3 검증 결과');
  });

  /** [신규 2026-09-23 No.25] E1 — 자동 스냅샷 안내(§4.5.1). `autoSnapshot` 필드 유무에 따라 표시가 갈린다. */
  describe('자동 스냅샷 안내(§4.5.1)', () => {
    async function toStep3(autoSnapshot?: { status: string; versionNo?: number; versionId?: string }): Promise<void> {
      const user = userEvent.setup();
      mockImportValidate.mockResolvedValue({
        importToken: 'token-snap',
        expiresAt: new Date(),
        resourceType: 'INTENT',
        totalRows: 1,
        newItems: 1,
        updatedItems: 0,
        newValues: 1,
        duplicatedRows: 0,
        errors: [],
        conflicts: [],
      });
      mockImportCommit.mockResolvedValue({ createdItems: 1, updatedItems: 0, createdValues: 1, skippedRows: 0, errors: [], autoSnapshot });
      renderModal();

      expect(screen.getByText('커밋 직전 상태가 자동으로 저장됩니다(버전 이력에서 되돌릴 수 있음).')).toBeInTheDocument();

      await user.upload(screen.getByLabelText('파일 선택'), makeFile());
      await user.click(screen.getByRole('button', { name: '검증하기' }));
      await screen.findByText('2/3 검증 결과');
      await user.click(screen.getByRole('button', { name: '반영하기' }));
      await screen.findByText('3/3 완료');
    }

    it('autoSnapshot.status===CREATED면 버전 번호와 "버전 이력에서 보기" 링크가 표시된다', async () => {
      await toStep3({ status: 'CREATED', versionNo: 15, versionId: 'v-15' });
      expect(await screen.findByText(/이 작업 직전 상태가 v15로 자동 저장되었습니다\./)).toBeInTheDocument();
      expect(screen.getByRole('link', { name: '버전 이력에서 보기 →' })).toHaveAttribute('href', '/chatbots/bot-1/versions');
    });

    it('autoSnapshot.status===FAILED면 경고 문구가 표시된다', async () => {
      await toStep3({ status: 'FAILED' });
      expect(await screen.findByText(/직전 상태가 자동 저장되지 않았습니다/)).toBeInTheDocument();
    });

    it('autoSnapshot 필드가 없으면(구버전 서버) 아무 안내도 표시하지 않는다', async () => {
      await toStep3(undefined);
      expect(screen.queryByText(/자동 저장되었습니다/)).not.toBeInTheDocument();
      expect(screen.queryByText(/자동 저장되지 않았습니다/)).not.toBeInTheDocument();
    });

    it('autoSnapshot.status===UNCHANGED면 아무 안내도 표시하지 않는다', async () => {
      await toStep3({ status: 'UNCHANGED', versionNo: 14 });
      expect(screen.queryByText(/자동 저장되었습니다/)).not.toBeInTheDocument();
      expect(screen.queryByText(/자동 저장되지 않았습니다/)).not.toBeInTheDocument();
    });
  });
});
