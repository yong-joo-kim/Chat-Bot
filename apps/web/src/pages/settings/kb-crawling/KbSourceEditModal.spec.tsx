import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { KbSourceResponse } from '@chat-bot/shared-types';
import { KbSourceEditModal } from './KbSourceEditModal';
import { ApiError } from '../../../api/client';

const mockCreate = vi.fn();
const mockUpdate = vi.fn();

vi.mock('../../../api/kbSources', () => ({
  kbSourcesApi: {
    create: (...args: unknown[]) => mockCreate(...args),
    update: (...args: unknown[]) => mockUpdate(...args),
  },
}));

function makeEditingSource(overrides: Partial<KbSourceResponse> = {}): KbSourceResponse {
  return {
    id: 's1',
    name: '인사규정 게시판',
    seedUrls: ['https://intra.example.local/hr/'],
    sitemapUrls: [],
    allowedHosts: ['intra.example.local'],
    pathPrefixes: [],
    excludePatterns: [],
    noisePatterns: [],
    allowQueryUrls: false,
    maxDepth: 3,
    maxPages: 500,
    fileTypes: ['PDF'],
    maxFileBytes: 20971520,
    minIntervalMs: 1000,
    scope: { company: '예시공사', category: '인사', subcategory: '크롤_인사규정' },
    schedule: { kind: 'DAILY', time: '03:00' },
    authKind: 'NONE',
    authHeaderName: null,
    authSecretRef: null,
    piiMask: true,
    allowRawFileIngest: false,
    enabled: true,
    configVersion: 1,
    ingestApproved: true,
    needsPreview: false,
    reviewRequiredReason: null,
    activeRun: null,
    lastRun: null,
    nextRunAt: null,
    needsCleanupCount: 0,
    repeatedFailureCount: 0,
    activeDocumentCount: 0,
    previewStale: false,
    rightsConfirmedAt: new Date('2026-09-01T00:00:00.000Z'),
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
    updatedAt: new Date('2026-09-20T00:00:00.000Z'),
    ...overrides,
  };
}

async function fillMinimum(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.type(screen.getByLabelText(/^이름/), '인사규정 게시판');
  const seedInputs = screen.getAllByLabelText(/번째 시작 주소/);
  await user.type(seedInputs[0], 'https://intra.example.local/hr/');
  await user.type(screen.getByLabelText(/회사명/), '예시공사');
  await user.type(screen.getByLabelText(/^카테고리/), '인사');
  await user.type(screen.getByLabelText(/세부 카테고리/), '크롤_인사규정');
  await user.click(screen.getByLabelText(/이 사이트의 내용을 수집·이용할 권한이 있음을 확인합니다/));
}

/** KB6 — 소스 등록·수정 모달(kb-crawling-ui-spec.md §3.2). 오류 코드별 인라인 문구 매핑이 핵심. */
describe('KbSourceEditModal', () => {
  beforeEach(() => {
    mockCreate.mockReset();
    mockUpdate.mockReset();
  });

  /** [No.43 R1 Low] "저장하면 다시 미리보기가 필요합니다" 안내는 범위 필드가 실제로 바뀌었을 때만 뜬다. */
  it('수정 모달을 열기만 하고 범위 필드를 바꾸지 않으면 "다시 미리보기가 필요합니다" 안내가 보이지 않는다', () => {
    render(<KbSourceEditModal isOpen source={makeEditingSource()} onClose={vi.fn()} onSaved={vi.fn()} />);
    expect(screen.queryByText('저장하면 다시 미리보기가 필요합니다.')).not.toBeInTheDocument();
  });

  it('이름만 바꾸면(범위 필드 아님) 여전히 안내가 보이지 않는다', async () => {
    const user = userEvent.setup();
    render(<KbSourceEditModal isOpen source={makeEditingSource()} onClose={vi.fn()} onSaved={vi.fn()} />);

    const nameInput = screen.getByLabelText(/^이름/);
    await user.clear(nameInput);
    await user.type(nameInput, '새 이름');

    expect(screen.queryByText('저장하면 다시 미리보기가 필요합니다.')).not.toBeInTheDocument();
  });

  it('깊이(범위 필드)를 바꾸면 "다시 미리보기가 필요합니다" 안내가 뜬다', async () => {
    const user = userEvent.setup();
    render(<KbSourceEditModal isOpen source={makeEditingSource()} onClose={vi.fn()} onSaved={vi.fn()} />);

    const depthInput = screen.getByLabelText('깊이');
    await user.clear(depthInput);
    await user.type(depthInput, '4');

    expect(await screen.findByText('저장하면 다시 미리보기가 필요합니다.')).toBeInTheDocument();
  });

  /** [No.43 pass 4] 콘솔에 컨트롤이 없는 `allowQueryUrls`는 저장 시 소스의 실제 값을 그대로 다시 보낸다(false로 덮지 않는다). */
  it('allowQueryUrls=true인 소스를 이름만 바꿔 저장하면 true가 그대로 전송되고 안내는 뜨지 않는다', async () => {
    const user = userEvent.setup();
    mockUpdate.mockResolvedValue({});
    const onSaved = vi.fn();
    render(<KbSourceEditModal isOpen source={makeEditingSource({ allowQueryUrls: true })} onClose={vi.fn()} onSaved={onSaved} />);

    const nameInput = screen.getByLabelText(/^이름/);
    await user.clear(nameInput);
    await user.type(nameInput, '새 이름');
    expect(screen.queryByText('저장하면 다시 미리보기가 필요합니다.')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '저장' }));

    await vi.waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1));
    expect(mockUpdate.mock.calls[0][0]).toBe('s1');
    expect(mockUpdate.mock.calls[0][1]).toMatchObject({ name: '새 이름', allowQueryUrls: true });
  });

  it('필수값을 채우고 저장하면 KbSourceCreateDto로 생성 요청이 간다', async () => {
    const user = userEvent.setup();
    mockCreate.mockResolvedValue({});
    const onSaved = vi.fn();
    render(<KbSourceEditModal isOpen source={null} onClose={vi.fn()} onSaved={onSaved} />);

    await fillMinimum(user);
    await user.click(screen.getByRole('button', { name: '저장' }));

    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockCreate.mock.calls[0][0]).toMatchObject({
      name: '인사규정 게시판',
      seedUrls: ['https://intra.example.local/hr/'],
      scope: { company: '예시공사', category: '인사', subcategory: '크롤_인사규정' },
      rightsConfirmed: true,
    });
    expect(onSaved).toHaveBeenCalled();
  });

  it('권리 확인 체크 없이 저장하면 인라인 오류를 보여주고 저장 요청을 보내지 않는다', async () => {
    const user = userEvent.setup();
    render(<KbSourceEditModal isOpen source={null} onClose={vi.fn()} onSaved={vi.fn()} />);

    await user.type(screen.getByLabelText(/^이름/), '인사규정 게시판');
    const seedInputs = screen.getAllByLabelText(/번째 시작 주소/);
    await user.type(seedInputs[0], 'https://intra.example.local/hr/');
    await user.type(screen.getByLabelText(/회사명/), '예시공사');
    await user.type(screen.getByLabelText(/^카테고리/), '인사');
    await user.type(screen.getByLabelText(/세부 카테고리/), '크롤_인사규정');
    await user.click(screen.getByRole('button', { name: '저장' }));

    expect(await screen.findByText('확인란에 체크해야 저장할 수 있습니다.')).toBeInTheDocument();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('DUPLICATE_NAME 오류는 이름 필드 아래 인라인 오류로 표시된다', async () => {
    const user = userEvent.setup();
    mockCreate.mockRejectedValue(new ApiError(409, '이미 같은 이름의 소스가 있습니다.', 'DUPLICATE_NAME'));
    render(<KbSourceEditModal isOpen source={null} onClose={vi.fn()} onSaved={vi.fn()} />);

    await fillMinimum(user);
    await user.click(screen.getByRole('button', { name: '저장' }));

    expect(await screen.findByText('이미 사용 중인 이름입니다.')).toBeInTheDocument();
  });

  it.each([
    ['DNS_FAILED', '주소를 확인할 수 없습니다.'],
    ['ABSOLUTE_BLOCKED', '이 주소는 보안상 허용되지 않습니다.'],
    ['PRIVATE_NOT_ALLOWLISTED', '사설 주소입니다. 서버 운영자에게 사설망 허용을 요청하세요.'],
    // [No.43 R1 M2] 네 번째 사유(개발명세서 §11) — 형식이 유효하지 않은 URL.
    ['INVALID_URL', 'http:// 또는 https://로 시작하는 주소를 입력하세요.'],
  ])('KB_HOST_NOT_ALLOWED(%s) 오류는 시작 주소 필드 아래에 해당 문구를 표시한다', async (detailMessage, expectedText) => {
    const user = userEvent.setup();
    mockCreate.mockRejectedValue(
      new ApiError(400, '주소를 확인할 수 없습니다.', 'KB_HOST_NOT_ALLOWED', [{ field: 'seedUrls', message: detailMessage }]),
    );
    render(<KbSourceEditModal isOpen source={null} onClose={vi.fn()} onSaved={vi.fn()} />);

    await fillMinimum(user);
    await user.click(screen.getByRole('button', { name: '저장' }));

    expect(await screen.findByText(expectedText)).toBeInTheDocument();
  });

  /** [No.43 R1 M2] 서버 왕복 없이 클라이언트가 먼저 http(s) 스킴을 검증한다. */
  it('시작 주소가 http(s)로 시작하지 않으면 서버 호출 없이 인라인 오류를 보여준다', async () => {
    const user = userEvent.setup();
    render(<KbSourceEditModal isOpen source={null} onClose={vi.fn()} onSaved={vi.fn()} />);

    await user.type(screen.getByLabelText(/^이름/), '인사규정 게시판');
    const seedInputs = screen.getAllByLabelText(/번째 시작 주소/);
    await user.type(seedInputs[0], 'ftp://intra.example.local/hr/');
    await user.type(screen.getByLabelText(/회사명/), '예시공사');
    await user.type(screen.getByLabelText(/^카테고리/), '인사');
    await user.type(screen.getByLabelText(/세부 카테고리/), '크롤_인사규정');
    await user.click(screen.getByLabelText(/이 사이트의 내용을 수집·이용할 권한이 있음을 확인합니다/));
    await user.click(screen.getByRole('button', { name: '저장' }));

    expect(await screen.findByText('http:// 또는 https://로 시작하는 주소를 입력하세요.')).toBeInTheDocument();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('LIMIT_EXCEEDED 오류는 최대 개수를 포함한 배너로 안내한다', async () => {
    const user = userEvent.setup();
    mockCreate.mockRejectedValue(new ApiError(400, '소스는 최대 50개까지 등록할 수 있습니다.', 'LIMIT_EXCEEDED'));
    render(<KbSourceEditModal isOpen source={null} onClose={vi.fn()} onSaved={vi.fn()} />);

    await fillMinimum(user);
    await user.click(screen.getByRole('button', { name: '저장' }));

    expect(await screen.findByText('최대 50까지 입력할 수 있습니다.')).toBeInTheDocument();
  });

  it('금지된 헤더 이름(VALIDATION_FAILED, auth.headerName)은 헤더 이름 필드 아래 인라인 오류로 표시된다', async () => {
    const user = userEvent.setup();
    mockCreate.mockRejectedValue(
      new ApiError(400, '입력값을 확인해 주세요.', 'VALIDATION_FAILED', [{ field: 'auth.headerName', message: '사용할 수 없는 헤더 이름입니다.' }]),
    );
    render(<KbSourceEditModal isOpen source={null} onClose={vi.fn()} onSaved={vi.fn()} />);

    await fillMinimum(user);
    await user.click(screen.getByLabelText('고정 헤더'));
    await user.type(screen.getByLabelText('헤더 이름'), 'Host');
    await user.type(screen.getByLabelText('비밀 참조 이름'), 'HR');
    await user.click(screen.getByRole('button', { name: '저장' }));

    expect(await screen.findByText('이 헤더 이름은 사용할 수 없습니다.')).toBeInTheDocument();
  });

  /** [No.43 R2 M5] 메시지 문자열 매칭이 아니라 `details[].field`로 판별한다. */
  it('거버넌스 모드에서 마스킹을 끄려는 시도(details.field=piiMask)는 마스킹 체크박스 아래 인라인 오류로 표시된다', async () => {
    const user = userEvent.setup();
    mockCreate.mockRejectedValue(
      new ApiError(400, '거버넌스 모드에서는 개인정보 마스킹을 끌 수 없습니다.', 'VALIDATION_FAILED', [
        { field: 'piiMask', message: 'GOVERNANCE_MASK_REQUIRED' },
      ]),
    );
    render(<KbSourceEditModal isOpen source={null} onClose={vi.fn()} onSaved={vi.fn()} />);

    await fillMinimum(user);
    await user.click(screen.getByRole('button', { name: '저장' }));

    expect(await screen.findByText('데이터 거버넌스 모드에서는 마스킹을 끌 수 없습니다.')).toBeInTheDocument();
  });

  it('거버넌스 모드에서 원본 파일 전달을 켜려는 시도(details.field=allowRawFileIngest)는 그 체크박스 아래 인라인 오류로 표시된다', async () => {
    const user = userEvent.setup();
    mockCreate.mockRejectedValue(
      new ApiError(400, '거버넌스 모드에서 원본 파일 전달을 켜려면 서버 설정(KB_ALLOW_RAW_FILE_INGEST)이 필요합니다.', 'VALIDATION_FAILED', [
        { field: 'allowRawFileIngest', message: 'GOVERNANCE_RAW_FILE_NOT_ALLOWED' },
      ]),
    );
    render(<KbSourceEditModal isOpen source={null} onClose={vi.fn()} onSaved={vi.fn()} />);

    await fillMinimum(user);
    await user.click(screen.getByLabelText(/문서 파일은 마스킹 없이 원본 그대로 전달합니다/));
    await user.click(screen.getByRole('button', { name: '저장' }));

    expect(await screen.findByText('서버 설정에서 원본 파일 전달이 허용되어 있지 않습니다.')).toBeInTheDocument();
  });

  it('EGRESS_HOST_NOT_ALLOWED 오류는 거버넌스 허용 목록 안내로 표시된다', async () => {
    const user = userEvent.setup();
    mockCreate.mockRejectedValue(new ApiError(400, '출구 허용 목록에 없는 호스트입니다(서버 설정 필요).', 'EGRESS_HOST_NOT_ALLOWED'));
    render(<KbSourceEditModal isOpen source={null} onClose={vi.fn()} onSaved={vi.fn()} />);

    await fillMinimum(user);
    await user.click(screen.getByRole('button', { name: '저장' }));

    expect(await screen.findByText('데이터 거버넌스 설정에서 이 호스트가 허용되어 있지 않습니다.')).toBeInTheDocument();
  });

  it('실행 중 수정 시도(KB_SOURCE_BUSY)는 배너로 안내하고 입력값을 보존한다', async () => {
    const user = userEvent.setup();
    mockCreate.mockRejectedValue(new ApiError(409, '이미 실행 중인 작업이 있습니다.', 'KB_SOURCE_BUSY'));
    render(<KbSourceEditModal isOpen source={null} onClose={vi.fn()} onSaved={vi.fn()} />);

    await fillMinimum(user);
    await user.click(screen.getByRole('button', { name: '저장' }));

    expect(await screen.findByText('이 소스는 실행 중입니다. 먼저 중지한 뒤 수정하세요.')).toBeInTheDocument();
    expect(screen.getByLabelText(/^이름/)).toHaveValue('인사규정 게시판');
  });

  /**
   * [3차 보완] 저장 응답 `warnings[]`(`KbScopeWarningCode`) — 저장 자체는 성공했으므로 `onSaved`를
   * 즉시 부르지 않고, 경고 배너를 보여준 뒤 "확인"을 눌러야 모달이 닫히고 목록이 새로고침된다.
   */
  it('저장 응답에 SCOPE_SHARED_WITH_OTHER_SOURCE 경고가 있으면 배너로 보여주고, "확인"을 눌러야 onSaved가 호출된다', async () => {
    const user = userEvent.setup();
    mockCreate.mockResolvedValue({ id: 's1', name: '인사규정 게시판', warnings: [{ code: 'SCOPE_SHARED_WITH_OTHER_SOURCE' }] });
    const onSaved = vi.fn();
    render(<KbSourceEditModal isOpen source={null} onClose={vi.fn()} onSaved={onSaved} />);

    await fillMinimum(user);
    await user.click(screen.getByRole('button', { name: '저장' }));

    expect(await screen.findByText('같은 적재 위치를 다른 소스가 사용하고 있습니다.')).toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: '확인' }));
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it('저장 응답에 SCOPE_NOT_READ_BY_ANY_CHATBOT 경고가 있으면 해당 문구를 배너로 보여준다', async () => {
    const user = userEvent.setup();
    mockCreate.mockResolvedValue({ id: 's1', name: '인사규정 게시판', warnings: [{ code: 'SCOPE_NOT_READ_BY_ANY_CHATBOT' }] });
    render(<KbSourceEditModal isOpen source={null} onClose={vi.fn()} onSaved={vi.fn()} />);

    await fillMinimum(user);
    await user.click(screen.getByRole('button', { name: '저장' }));

    expect(await screen.findByText('이 적재 위치를 읽는 챗봇이 없습니다.')).toBeInTheDocument();
  });

  it('저장 응답에 warnings가 없으면(빈 배열) 즉시 onSaved가 호출된다', async () => {
    const user = userEvent.setup();
    mockCreate.mockResolvedValue({ id: 's1', name: '인사규정 게시판', warnings: [] });
    const onSaved = vi.fn();
    render(<KbSourceEditModal isOpen source={null} onClose={vi.fn()} onSaved={onSaved} />);

    await fillMinimum(user);
    await user.click(screen.getByRole('button', { name: '저장' }));

    await vi.waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(screen.queryByText('저장되었습니다 — 확인이 필요한 사항이 있습니다.')).not.toBeInTheDocument();
  });
});
