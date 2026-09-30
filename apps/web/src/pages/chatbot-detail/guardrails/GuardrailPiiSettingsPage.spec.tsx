import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '../../../api/client';
import { GuardrailPiiSettingsPage } from './GuardrailPiiSettingsPage';
import { CHATBOT_ID, makeMeta, makeSettings, renderGuardrailPage } from './testFixtures';

vi.mock('../../../context/AuthContext', () => ({
  useAuth: () => ({ can: () => true, user: { id: 'u1', email: 'admin@example.com', governanceModeOn: false } }),
}));

const api = vi.hoisted(() => ({ getSettings: vi.fn(), updateSettings: vi.fn(), test: vi.fn() }));
vi.mock('../../../api/guardrails', () => ({ guardrailsApi: api }));

const PATH = '/chatbots/:chatbotId/guardrails/pii';

function renderPage(opts: Parameters<typeof renderGuardrailPage>[1] = {}): ReturnType<typeof renderGuardrailPage> {
  return renderGuardrailPage(<GuardrailPiiSettingsPage />, { routePath: PATH, ...opts });
}

beforeEach(() => {
  Object.values(api).forEach((fn) => fn.mockReset());
  api.getSettings.mockResolvedValue(makeSettings());
});

describe('GR-3 AI 답변 개인정보 가림 설정', () => {
  it('체크박스는 가나다순으로 나열하고 기본 종류에는 "기본" 글자 표식을 붙인다', async () => {
    renderPage();
    const group = await screen.findByRole('group', { name: '가릴 번호 종류' });
    const names = Array.from(group.querySelectorAll('.guardrail-pii-label')).map((l) => (l.textContent ?? '').trim());
    expect(names).toHaveLength(5);
    expect(names[0]).toContain('계좌번호');
    expect(names[1]).toContain('이메일');
    expect(names[2]).toContain('전화번호');
    expect(names[3]).toContain('주민등록번호');
    expect(names[4]).toContain('카드번호');
    // 주민등록번호·카드번호에만 "기본" 표식
    expect(within(group).getAllByText('기본')).toHaveLength(2);
    expect(screen.getByRole('checkbox', { name: /주민등록번호/ })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /카드번호/ })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /계좌번호/ })).not.toBeChecked();
  });

  it('현재 상태 문구(기본 설정)와 강도·한계 안내를 상시 보인다', async () => {
    renderPage();
    expect(await screen.findByText(/현재: 기본 설정을 쓰고 있습니다/)).toBeInTheDocument();
    expect(screen.getByText(/가리는 강도\(일부만 가릴지 전부 가릴지\)는 서버의 개인정보 가림 설정을 따르며/)).toBeInTheDocument();
    expect(screen.getByText(/이름·주소·병력 같은 정보는 가리지 못합니다/)).toBeInTheDocument();
    expect(screen.getByText(/날짜\(예: 2026-09-30\)나 버전 번호도 계좌번호로 오인되어/)).toBeInTheDocument();
  });

  it('계좌번호를 켜면 알리고, 꺼져 있으면 날짜 보호 체크는 aria-disabled + 이유(값은 유지)', async () => {
    const user = userEvent.setup();
    renderPage();
    const preserve = await screen.findByRole('checkbox', { name: '날짜(연-월-일 형식)는 가리지 않기' });
    expect(preserve).toHaveAttribute('aria-disabled', 'true');
    expect(preserve).toBeChecked();
    expect(preserve).toHaveAccessibleDescription('계좌번호를 가릴 때만 필요합니다.');
    await user.click(preserve);
    expect(preserve).toBeChecked();
    await user.click(screen.getByRole('checkbox', { name: /계좌번호/ }));
    expect(screen.getByText('계좌번호 가림을 켰습니다. 날짜·번호가 가려질 수 있습니다.')).toBeInTheDocument();
    expect(preserve).not.toHaveAttribute('aria-disabled');
    await user.click(preserve);
    expect(preserve).not.toBeChecked();
  });

  it('거버넌스 하한: 주민등록번호·카드번호는 체크됨 + aria-disabled + 이유 글자이고 끌 수 없다', async () => {
    const user = userEvent.setup();
    api.getSettings.mockResolvedValue(makeSettings({ governanceFloor: ['RRN', 'CARD'] }));
    renderPage();
    const rrn = await screen.findByRole('checkbox', { name: /주민등록번호/ });
    expect(rrn).toBeChecked();
    expect(rrn).toHaveAttribute('aria-disabled', 'true');
    expect(rrn).toHaveAccessibleDescription(/거버넌스 모드에서는 끌 수 없습니다\. 서버 설정으로만 바꿀 수 있습니다\./);
    await user.click(rrn);
    expect(rrn).toBeChecked();
  });

  it('종류를 늘리기만 하는 저장은 확인 없이 PUT한다', async () => {
    const user = userEvent.setup();
    api.updateSettings.mockResolvedValue(makeSettings({ piiExit: { kinds: ['RRN', 'CARD', 'PHONE'], preserveDates: true }, isDefault: false }));
    renderPage();
    await user.click(await screen.findByRole('checkbox', { name: /전화번호/ }));
    await user.click(screen.getByRole('button', { name: '저장' }));
    await waitFor(() => expect(api.updateSettings).toHaveBeenCalledTimes(1));
    expect(api.updateSettings.mock.calls[0][1]).toEqual({ piiExit: { kinds: ['RRN', 'CARD', 'PHONE'], preserveDates: true } });
    expect(await screen.findByText(/현재: 이 챗봇 전용 설정을 쓰고 있습니다/)).toBeInTheDocument();
  });

  it('주민등록번호를 빼는 약화 저장은 확인 대화상자(기본 포커스 취소)를 거친다', async () => {
    const user = userEvent.setup();
    api.updateSettings.mockResolvedValue(makeSettings({ piiExit: { kinds: ['CARD'], preserveDates: true }, isDefault: false }));
    renderPage();
    await user.click(await screen.findByRole('checkbox', { name: /주민등록번호/ }));
    await user.click(screen.getByRole('button', { name: '저장' }));
    const dialog = await screen.findByRole('dialog', { name: '개인정보 가림 줄이기' });
    expect(within(dialog).getByText(/‘주민등록번호’ 가림을 끄면 AI 답변에 그 번호가 있어도 그대로 사용자에게 나갑니다/)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: '취소' })).toHaveFocus();
    expect(api.updateSettings).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: '가림 줄이기 저장' }));
    await waitFor(() => expect(api.updateSettings).toHaveBeenCalledTimes(1));
  });

  it('모든 가림을 끄는 저장은 "모든 가림을 끄면" 문구로 확인한다', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('checkbox', { name: /주민등록번호/ }));
    await user.click(screen.getByRole('checkbox', { name: /카드번호/ }));
    await user.click(screen.getByRole('button', { name: '저장' }));
    expect(await screen.findByText(/모든 가림을 끄면/)).toBeInTheDocument();
  });

  it('변경이 없으면 저장은 aria-disabled이고 눌러도 호출하지 않는다', async () => {
    const user = userEvent.setup();
    renderPage();
    const save = await screen.findByRole('button', { name: '저장' });
    expect(save).toHaveAttribute('aria-disabled', 'true');
    await user.click(save);
    expect(api.updateSettings).not.toHaveBeenCalled();
  });

  it('"기본값으로 되돌리기"는 폼 값만 채우고 저장하지 않는다', async () => {
    const user = userEvent.setup();
    api.getSettings.mockResolvedValue(makeSettings({ piiExit: { kinds: ['ACCOUNT', 'PHONE'], preserveDates: false }, isDefault: false }));
    renderPage();
    await user.click(await screen.findByRole('button', { name: '기본값으로 되돌리기' }));
    expect(screen.getByRole('checkbox', { name: /주민등록번호/ })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /계좌번호/ })).not.toBeChecked();
    expect(screen.getByText('기본값으로 채웠습니다. 저장을 눌러야 적용됩니다.')).toBeInTheDocument();
    expect(api.updateSettings).not.toHaveBeenCalled();
  });

  it('거버넌스 하한 오류(400)는 배너로 알리고 설정을 다시 불러온다', async () => {
    const user = userEvent.setup();
    api.updateSettings.mockRejectedValue(new ApiError(400, 'x', 'VALIDATION_FAILED' as never, [{ field: 'piiExit.kinds', message: 'GOVERNANCE_FLOOR: 하한' }]));
    renderPage();
    await user.click(await screen.findByRole('checkbox', { name: /전화번호/ }));
    await user.click(screen.getByRole('button', { name: '저장' }));
    expect(await screen.findByText('거버넌스 모드에서는 주민등록번호·카드번호 가림을 끌 수 없습니다.')).toBeInTheDocument();
    await waitFor(() => expect(api.getSettings).toHaveBeenCalledTimes(2));
  });

  it('시험하기: "예시 넣기"로 합성 예시를 채우고 저장 전 설정(draftPiiExit)으로 시험하며 AI 답변 위치로 고정한다', async () => {
    const user = userEvent.setup();
    api.test.mockResolvedValue({ stage: 'OUTBOUND', result: 'MASKED', hits: [], resultText: '주민등록번호는 [주민등록번호]', piiCounts: { RRN: 1, CARD: 1 } });
    renderPage();
    await user.click(await screen.findByRole('checkbox', { name: /계좌번호/ }));
    const panel = screen.getByText(/문장으로 시험하기/).closest('details') as HTMLElement;
    expect(within(panel).queryByRole('radio', { name: /사용자 질문으로 시험/ })).toBeNull();
    await user.click(within(panel).getByRole('button', { name: '예시 넣기' }));
    expect((within(panel).getByLabelText('시험할 문장') as HTMLTextAreaElement).value).toContain('900101-1234567');
    await user.click(within(panel).getByRole('button', { name: '시험하기' }));
    await waitFor(() => expect(api.test).toHaveBeenCalledTimes(1));
    expect(api.test.mock.calls[0][1]).toMatchObject({ stage: 'OUTBOUND', draftPiiExit: { kinds: ['RRN', 'CARD', 'ACCOUNT'], preserveDates: true } });
    expect(await within(panel).findByText('개인정보 2건을 가려서 나갑니다')).toBeInTheDocument();
    expect(within(panel).getByText('가린 개인정보: 주민등록번호 1건 · 카드번호 1건')).toBeInTheDocument();
  });

  it('읽기 전용: 체크박스 대신 "가림/가리지 않음" 글자만 보이고 저장·되돌리기는 없다', async () => {
    renderPage({ guardrail: { canWrite: false } });
    expect(await screen.findByText('주민등록번호: 가림')).toBeInTheDocument();
    expect(screen.getByText('계좌번호: 가리지 않음')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '저장' })).toBeNull();
    expect(screen.queryByRole('button', { name: '기본값으로 되돌리기' })).toBeNull();
  });

  it('AI 답변 미사용 배너를 보이고 조회 실패는 ErrorState로 다시 시도한다', async () => {
    const user = userEvent.setup();
    api.getSettings.mockRejectedValueOnce(new Error('x')).mockResolvedValue(makeSettings());
    renderPage({ guardrail: { meta: makeMeta({ ragActive: false }) } });
    expect(await screen.findByRole('alert')).toHaveTextContent('가림 설정을 불러오지 못했습니다');
    expect(screen.getByText(/AI 답변\(문서 기반 답변\)을 쓰지 않아/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '다시 시도' }));
    expect(await screen.findByRole('group', { name: '가릴 번호 종류' })).toBeInTheDocument();
    expect(api.getSettings).toHaveBeenCalledWith(CHATBOT_ID);
    void fireEvent;
  });
});
