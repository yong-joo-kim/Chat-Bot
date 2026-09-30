import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GuardrailRuleListPage } from './GuardrailRuleListPage';
import { CHATBOT_ID, makeMeta, makeRule, renderGuardrailPage, RULE_ID_1, RULE_ID_2, RULES } from './testFixtures';

vi.mock('../../../context/AuthContext', () => ({
  useAuth: () => ({ can: () => true, user: { id: 'u1', email: 'admin@example.com', governanceModeOn: false } }),
}));

const api = vi.hoisted(() => ({
  enableRule: vi.fn(),
  disableRule: vi.fn(),
  moveRule: vi.fn(),
  deleteRule: vi.fn(),
  test: vi.fn(),
}));
vi.mock('../../../api/guardrails', () => ({ guardrailsApi: api }));

beforeEach(() => {
  Object.values(api).forEach((fn) => fn.mockReset());
});

describe('GR-1 위험 응답 규칙 목록', () => {
  it('표(캡션·열 머리)와 규칙 행을 그리고 동작은 글자 배지로 보인다', () => {
    renderGuardrailPage(<GuardrailRuleListPage />);
    const table = screen.getAllByRole('table')[0];
    expect(within(table).getByText('위험 응답 규칙 목록')).toBeInTheDocument();
    ['순서', '이름', '분류', '적용 위치', '동작', '표현', '사용', '최근 7일 걸림', '확인할 점'].forEach((h) => expect(within(table).getByRole('columnheader', { name: h })).toBeInTheDocument());
    expect(within(table).getByText('투자 권유')).toBeInTheDocument();
    expect(within(table).getByText('기록만')).toBeInTheDocument();
    expect(within(table).getByText('안전 문구로 대체')).toBeInTheDocument();
    expect(within(table).getByText('AI로 보내지 않음')).toBeInTheDocument();
    expect(within(table).getAllByText('AI 답변').length).toBeGreaterThan(0);
    // 정렬 버튼은 두지 않는다(순서가 의미다).
    expect(within(table).queryByRole('button', { name: /정렬/ })).toBeNull();
  });

  it('규칙 수·표현 수 요약과 상시 한계 안내를 보인다("환각" 같은 말 없이)', () => {
    renderGuardrailPage(<GuardrailRuleListPage />);
    expect(screen.getByText('규칙 3/50 · 표현 18/2,000')).toBeInTheDocument();
    expect(screen.getByText(/AI 답변 내용이 문서와 맞는지는 검사하지 않습니다/)).toBeInTheDocument();
    expect(screen.getByText(/가장 강한 동작/)).toBeInTheDocument();
  });

  it('확인할 점: 대체 문구 금지어 경고, AI 답변 미사용 안내를 글자로 보인다', () => {
    renderGuardrailPage(<GuardrailRuleListPage />, { guardrail: { meta: makeMeta({ ragActive: false }) } });
    expect(screen.getAllByText(/대체 문구에 지금 금지어 사전의 단어가 들어 있습니다/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/이 챗봇은 AI 답변을 쓰지 않아 이 규칙은 동작하지 않습니다/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/‘AI로 보내지 않음’은 효과가 없습니다/).length).toBeGreaterThan(0);
    expect(screen.getByText(/‘AI 답변’에 적용하는 규칙과 개인정보 가림은 동작하지 않습니다/)).toBeInTheDocument();
  });

  it('첫 행 위/마지막 행 아래 이동 버튼은 disabled가 아니라 aria-disabled(포커스 유지)이고 눌러도 호출하지 않는다', async () => {
    const user = userEvent.setup();
    renderGuardrailPage(<GuardrailRuleListPage />);
    const table = screen.getAllByRole('table')[0];
    const up = within(table).getByRole('button', { name: '‘투자 권유’ 규칙을 위로 이동' });
    expect(up).toHaveAttribute('aria-disabled', 'true');
    expect(up).not.toBeDisabled();
    await user.click(up);
    expect(api.moveRule).not.toHaveBeenCalled();
    const down = within(table).getByRole('button', { name: '‘지시 무시’ 규칙을 아래로 이동' });
    expect(down).toHaveAttribute('aria-disabled', 'true');
  });

  it('위로 이동: 응답의 새 순서를 반영하고 "n번째로 옮겼습니다"를 알린다', async () => {
    const user = userEvent.setup();
    const reordered = [RULES[1], RULES[0], RULES[2]];
    api.moveRule.mockResolvedValue(reordered);
    const setRules = vi.fn();
    renderGuardrailPage(<GuardrailRuleListPage />, { guardrail: { setRules } });
    const table = screen.getAllByRole('table')[0];
    await user.click(within(table).getByRole('button', { name: '‘위기 표현’ 규칙을 위로 이동' }));
    expect(api.moveRule).toHaveBeenCalledWith(CHATBOT_ID, RULE_ID_2, 'UP');
    await waitFor(() => expect(setRules).toHaveBeenCalledWith(reordered));
    expect(await screen.findByText('‘위기 표현’ 규칙을 1번째로 옮겼습니다.')).toBeInTheDocument();
  });

  it('사용 스위치: 응답으로만 바꾸고(낙관 갱신 없음) 결과를 알린다', async () => {
    const user = userEvent.setup();
    api.disableRule.mockResolvedValue(makeRule({ enabled: false }));
    const setRules = vi.fn();
    renderGuardrailPage(<GuardrailRuleListPage />, { guardrail: { setRules } });
    const table = screen.getAllByRole('table')[0];
    const toggles = within(table).getAllByRole('switch');
    expect(toggles[0]).toHaveAttribute('aria-checked', 'true');
    await user.click(toggles[0]);
    expect(api.disableRule).toHaveBeenCalledWith(CHATBOT_ID, RULE_ID_1);
    expect(await screen.findByText('‘투자 권유’ 규칙을 사용 안 함으로 바꿨습니다.')).toBeInTheDocument();
    expect(setRules).toHaveBeenCalled();
  });

  it('삭제: 확인 대화상자의 기본 포커스는 "취소"이고 확정하면 삭제한다', async () => {
    const user = userEvent.setup();
    api.deleteRule.mockResolvedValue(undefined);
    const reload = vi.fn().mockResolvedValue(undefined);
    renderGuardrailPage(<GuardrailRuleListPage />, { guardrail: { reload } });
    const table = screen.getAllByRole('table')[0];
    await user.click(within(table).getByRole('button', { name: '‘투자 권유’ 규칙 삭제' }));
    const dialog = await screen.findByRole('dialog', { name: '규칙 삭제' });
    expect(within(dialog).getByText(/바로 적용이 멈추고, 지금까지 걸린 기록은 남습니다/)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: '취소' })).toHaveFocus();
    await user.click(within(dialog).getByRole('button', { name: '삭제' }));
    await waitFor(() => expect(api.deleteRule).toHaveBeenCalledWith(CHATBOT_ID, RULE_ID_1));
    await waitFor(() => expect(reload).toHaveBeenCalled());
  });

  it('한도 도달: 규칙 추가는 aria-disabled + 이유 글자(aria-describedby)로 막는다', () => {
    renderGuardrailPage(<GuardrailRuleListPage />, { guardrail: { meta: makeMeta({ limits: { maxRules: 3, maxExpressions: 2000, usedRules: 3, usedExpressions: 18 } }) } });
    const add = screen.getByRole('button', { name: '규칙 추가' });
    expect(add).toHaveAttribute('aria-disabled', 'true');
    expect(add).toHaveAccessibleDescription(/규칙은 챗봇당 최대 3개입니다\(3\/3\)/);
  });

  it('한도 전에는 규칙 추가가 링크(href)이고 새 규칙 화면으로 간다', () => {
    renderGuardrailPage(<GuardrailRuleListPage />);
    expect(screen.getByRole('link', { name: '규칙 추가' })).toHaveAttribute('href', `/chatbots/${CHATBOT_ID}/guardrails/rules/new`);
  });

  it('빈 상태(쓰기 권한): 제품이 규칙을 미리 넣지 않는다는 안내와 3단계 시작법', () => {
    renderGuardrailPage(<GuardrailRuleListPage />, { guardrail: { rules: [], meta: makeMeta({ limits: { maxRules: 50, maxExpressions: 2000, usedRules: 0, usedExpressions: 0 } }) } });
    expect(screen.getByText('아직 만든 규칙이 없습니다')).toBeInTheDocument();
    expect(screen.getByText(/의료·법률 같은 문구를 미리 넣어 두지 않습니다/)).toBeInTheDocument();
    expect(screen.getByText(/동작은 ‘기록만’으로 시작합니다/)).toBeInTheDocument();
  });

  it('읽기 전용: 이동·삭제·수정·스위치 컨트롤을 렌더하지 않고 사용 여부는 글자로 남는다', () => {
    renderGuardrailPage(<GuardrailRuleListPage />, { guardrail: { canWrite: false } });
    const table = screen.getAllByRole('table')[0];
    expect(within(table).queryByRole('switch')).toBeNull();
    expect(within(table).queryByRole('button', { name: /이동/ })).toBeNull();
    expect(screen.queryByRole('link', { name: '규칙 추가' })).toBeNull();
    expect(within(table).getAllByText('사용 중').length).toBeGreaterThan(0);
  });

  it('조회 실패: ErrorState와 다시 시도', async () => {
    const user = userEvent.setup();
    const reload = vi.fn().mockResolvedValue(undefined);
    renderGuardrailPage(<GuardrailRuleListPage />, { guardrail: { rules: [], error: true, reload } });
    expect(screen.getByRole('alert')).toHaveTextContent('규칙 목록을 불러오지 못했습니다');
    await user.click(screen.getByRole('button', { name: '다시 시도' }));
    expect(reload).toHaveBeenCalled();
  });
});
