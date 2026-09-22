import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { AuthProvider } from './AuthContext';
import { apiClient } from '../api/client';
import { makeCurrentUser } from '../test/fixtures';

const mockMe = vi.fn();
const mockLogin = vi.fn();

vi.mock('../api/auth', () => ({
  authApi: {
    me: (...args: unknown[]) => mockMe(...args),
    login: (...args: unknown[]) => mockLogin(...args),
    logout: vi.fn(),
    changePassword: vi.fn(),
  },
}));

/** 저장을 누르면 401을 겪는 "편집 중인 노드 폼"의 축소 모형(S-6, AC-U-4). */
function DirtyNodeForm(): JSX.Element {
  const [text, setText] = useState('');
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  async function handleSave(): Promise<void> {
    setSaveStatus('saving');
    try {
      await apiClient.patch('/dialogue-nodes/node-1', { outputText: text });
      setSaveStatus('saved');
    } catch {
      setSaveStatus('error');
    }
  }

  return (
    <div>
      <label htmlFor="node-text">노드 응답 텍스트</label>
      <input id="node-text" value={text} onChange={(e) => setText(e.target.value)} />
      <button type="button" onClick={() => void handleSave()}>
        저장
      </button>
      <p data-testid="save-status">{saveStatus}</p>
    </div>
  );
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/**
 * AC-U-4 자동시험: "노드 편집 폼에 미저장 내용이 있는 상태에서 세션이 만료되면, 저장을 눌렀을 때
 * 입력 내용이 유지된 채 재로그인 모달이 뜨고, 재인증 후 저장이 성공한다." `client.ts`(L3 훅)와
 * `AuthContext`(모달 오케스트레이션)를 실제로 함께 동작시켜(mock 없이) 검증한다 — 이 그룹에서
 * 신규 화면·컨텍스트 전용 자동화 테스트가 0건이었던 공백 중 하나다.
 */
describe('세션 만료 시 폼 데이터 보존 후 재시도 성공 — AC-U-4', () => {
  beforeEach(() => {
    mockMe.mockReset();
    mockLogin.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('저장 중 401을 받아도 입력값이 화면 전환 없이 유지되고, 재인증 후 저장이 자동 재시도되어 성공한다', async () => {
    mockMe.mockResolvedValue(makeCurrentUser());
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(401, { statusCode: 401, code: 'SESSION_EXPIRED', message: '로그인이 만료되었습니다.' }))
      .mockResolvedValueOnce(jsonResponse(200, { id: 'node-1' }));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    render(
      <AuthProvider>
        <DirtyNodeForm />
      </AuthProvider>,
    );

    // 부팅 시 GET /auth/me도 같은 fetch mock을 타므로, 순서를 어긋나지 않게 me() 완료를 먼저 기다린다.
    await waitFor(() => expect(screen.getByLabelText('노드 응답 텍스트')).toBeInTheDocument());

    await user.type(screen.getByLabelText('노드 응답 텍스트'), '회의 가기 전 절반쯰 쓴 안내문');
    await user.click(screen.getByRole('button', { name: '저장' }));

    // 저장이 401을 만나 재로그인 모달이 뜬다 — 화면은 전환되지 않고 입력값이 그대로 남아 있어야 한다.
    const modalTitle = await screen.findByText('로그인이 만료되었습니다');
    expect(modalTitle).toBeInTheDocument();
    expect(screen.getByLabelText('노드 응답 텍스트')).toHaveValue('회의 가기 전 절반쯰 쓴 안내문');

    // 재로그인 모달에서 비밀번호를 입력하고 제출한다.
    mockLogin.mockResolvedValue({ status: 'OK', user: makeCurrentUser() });
    await user.type(screen.getByLabelText('비밀번호 *'), 'Re-Auth-Password#1');
    await user.click(screen.getByRole('button', { name: '다시 로그인' }));

    // 모달이 닫히고, 원래의 저장 요청이 자동으로 재시도되어 성공한다(사용자가 다시 "저장"을 누르지 않아도 됨).
    await waitFor(() => expect(screen.queryByText('로그인이 만료되었습니다')).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByTestId('save-status').textContent).toBe('saved'));
    // 재인증 후에도 입력값은 그대로 보존된다.
    expect(screen.getByLabelText('노드 응답 텍스트')).toHaveValue('회의 가기 전 절반쯰 쓴 안내문');
    expect(fetchMock).toHaveBeenCalledTimes(2); // 1차 저장(401) + 재시도 저장(200). auth.me/login은 authApi 목이라 전역 fetch를 타지 않는다.
  });

  it('재로그인 모달에서 취소하면 화면은 그대로 유지되고 입력값도 지워지지 않는다', async () => {
    mockMe.mockResolvedValue(makeCurrentUser());
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(401, { statusCode: 401, code: 'SESSION_EXPIRED', message: '로그인이 만료되었습니다.' }));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    render(
      <AuthProvider>
        <DirtyNodeForm />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByLabelText('노드 응답 텍스트')).toBeInTheDocument());

    await user.type(screen.getByLabelText('노드 응답 텍스트'), '취소해도 안 지워져야 함');
    await user.click(screen.getByRole('button', { name: '저장' }));

    await screen.findByText('로그인이 만료되었습니다');
    await user.click(screen.getByRole('button', { name: '취소' }));

    await waitFor(() => expect(screen.queryByText('로그인이 만료되었습니다')).not.toBeInTheDocument());
    expect(screen.getByLabelText('노드 응답 텍스트')).toHaveValue('취소해도 안 지워져야 함');
    expect(screen.getByTestId('save-status').textContent).toBe('error');
  });
});
