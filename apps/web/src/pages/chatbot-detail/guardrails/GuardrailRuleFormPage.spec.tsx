import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route } from 'react-router-dom';
import { ApiError } from '../../../api/client';
import { GuardrailRuleFormPage } from './GuardrailRuleFormPage';
import { CHATBOT_ID, makeRule, renderGuardrailPage, RULE_ID_1 } from './testFixtures';

vi.mock('../../../context/AuthContext', () => ({
  useAuth: () => ({ can: () => true, user: { id: 'u1', email: 'admin@example.com', governanceModeOn: false } }),
}));

const api = vi.hoisted(() => ({
  createRule: vi.fn(),
  updateRule: vi.fn(),
  getRule: vi.fn(),
  deleteRule: vi.fn(),
  test: vi.fn(),
}));
vi.mock('../../../api/guardrails', () => ({ guardrailsApi: api }));

const NEW_PATH = '/chatbots/:chatbotId/guardrails/rules/new';
const NEW_URL = `/chatbots/${CHATBOT_ID}/guardrails/rules/new`;
const EDIT_PATH = '/chatbots/:chatbotId/guardrails/rules/:ruleId';

function renderNew(opts: Parameters<typeof renderGuardrailPage>[1] = {}): ReturnType<typeof renderGuardrailPage> {
  return renderGuardrailPage(<GuardrailRuleFormPage />, {
    routePath: NEW_PATH,
    url: NEW_URL,
    extraRoutes: <Route path="/chatbots/:chatbotId/guardrails/rules" element={<p>규칙 목록 화면</p>} />,
    ...opts,
  });
}

async function fillValid(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.type(screen.getByLabelText(/^이름/), '투자 권유');
  await user.selectOptions(screen.getByLabelText(/^분류/), 'FINANCIAL_ADVICE');
  await user.click(screen.getByRole('radio', { name: /AI 답변 \(나가는 말\)/ }));
  const expressionInput = screen.getByLabelText('찾을 표현 입력');
  await user.type(expressionInput, '수익 보장{Enter}');
}

beforeEach(() => {
  Object.values(api).forEach((fn) => fn.mockReset());
});

describe('GR-2 규칙 만들기', () => {
  it('분류·적용 위치는 사전 선택이 없고 동작은 "기록만", 찾는 방식은 "포함"이 기본이다', () => {
    renderNew();
    expect(screen.getByLabelText(/^분류/)).toHaveValue('');
    expect(screen.getByRole('option', { name: '분류를 선택하세요' })).toBeInTheDocument();
    const appliesTo = within(screen.getByRole('group', { name: /적용 위치/ }));
    ['사용자 질문', 'AI 답변', '둘 다'].forEach((n) => expect(appliesTo.getByRole('radio', { name: new RegExp(n) })).not.toBeChecked());
    expect(screen.getByRole('radio', { name: '기록만' })).toBeChecked();
    expect(screen.getByRole('radio', { name: /표현이 들어 있으면 걸림/ })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: '저장하면 바로 사용' })).toBeChecked();
    expect(screen.getByText(/처음에는 ‘기록만’으로 두고/)).toBeInTheDocument();
  });

  it('필수 항목마다 레이블이 있고 이름은 남은 글자 수를 실시간 보인다', async () => {
    const user = userEvent.setup();
    renderNew();
    expect(screen.getByText('0/50')).toBeInTheDocument();
    await user.type(screen.getByLabelText(/^이름/), '가나다');
    expect(screen.getByText('3/50')).toBeInTheDocument();
  });

  it('"AI로 보내지 않음"은 사용자 질문이 아니면 aria-disabled + 이유 글자로 막힌다', async () => {
    const user = userEvent.setup();
    renderNew();
    const noRag = screen.getByRole('radio', { name: 'AI로 보내지 않음' });
    expect(noRag).toHaveAttribute('aria-disabled', 'true');
    expect(noRag).toHaveAccessibleDescription(/‘사용자 질문’에만 쓸 수 있습니다/);
    await user.click(noRag);
    expect(noRag).not.toBeChecked();
    await user.click(screen.getByRole('radio', { name: /사용자 질문 \(들어오는 말\)/ }));
    expect(noRag).not.toHaveAttribute('aria-disabled');
    await user.click(noRag);
    expect(noRag).toBeChecked();
  });

  it('"AI로 보내지 않음"을 고른 뒤 적용 위치를 바꾸면 "기록만"으로 되돌리고 알린다', async () => {
    const user = userEvent.setup();
    renderNew();
    await user.click(screen.getByRole('radio', { name: /사용자 질문 \(들어오는 말\)/ }));
    await user.click(screen.getByRole('radio', { name: 'AI로 보내지 않음' }));
    await user.click(screen.getByRole('radio', { name: /AI 답변 \(나가는 말\)/ }));
    expect(screen.getByRole('radio', { name: '기록만' })).toBeChecked();
    expect(screen.getByText('적용 위치가 바뀌어 동작을 ‘기록만’으로 되돌렸습니다.')).toBeInTheDocument();
  });

  it('대체 문구는 동작이 대체일 때만 켜지고 안내(위젯 표시·입구 반복)를 조건부로 보인다', async () => {
    const user = userEvent.setup();
    renderNew();
    const replacement = screen.getByLabelText(/^대체 문구/);
    expect(replacement).toBeDisabled();
    expect(screen.getByText('동작이 ‘안전 문구로 대체’일 때만 적습니다.')).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: /둘 다/ }));
    await user.click(screen.getByRole('radio', { name: '안전 문구로 대체' }));
    expect(replacement).toBeEnabled();
    expect(screen.getByText(/지금은 답변을 준비하지 못했어요/)).toBeInTheDocument();
    expect(screen.getByText(/‘미응답’으로 세어집니다/)).toBeInTheDocument();
    await user.type(replacement, '안내');
    expect(screen.getByText('2/300')).toBeInTheDocument();
  });

  it('제출 시 사전 검사: 서버를 부르지 않고 필드 아래 인라인 오류를 보이며 첫 오류로 포커스한다', async () => {
    const user = userEvent.setup();
    renderNew();
    await user.click(screen.getByRole('button', { name: '저장' }));
    expect(api.createRule).not.toHaveBeenCalled();
    expect(screen.getByText('이름을 1~50자로 적어 주세요.')).toBeInTheDocument();
    expect(screen.getByText('분류를 선택해 주세요.')).toBeInTheDocument();
    expect(screen.getByText('적용 위치를 선택해 주세요.')).toBeInTheDocument();
    expect(screen.getByText('찾을 표현을 1개 이상 추가해 주세요.')).toBeInTheDocument();
    expect(screen.getByLabelText(/^이름/)).toHaveFocus();
    expect(screen.getByLabelText(/^이름/)).toHaveAttribute('aria-invalid', 'true');
  });

  it('표현 입력: 2글자 미만은 입력 필드 안에서 즉시 막고, 여러 줄 붙여넣기는 줄마다 하나씩 추가한다', async () => {
    const user = userEvent.setup();
    renderNew();
    const input = screen.getByLabelText('찾을 표현 입력');
    await user.type(input, '가{Enter}');
    expect(screen.getByText(/‘가’은 너무 짧습니다/)).toBeInTheDocument();
    await user.clear(input);
    input.focus();
    await user.paste('수익 보장\n원금 보장\n\n손실 없음');
    expect(screen.getByText('수익 보장')).toBeInTheDocument();
    expect(screen.getByText('원금 보장')).toBeInTheDocument();
    expect(screen.getByText('손실 없음')).toBeInTheDocument();
    expect(screen.getByText('3/100개')).toBeInTheDocument();
  });

  it('"단어 일치"에서 띄어쓰기 있는 표현은 제출 시 오류로 표시하고 해당 칩을 강조한다', async () => {
    const user = userEvent.setup();
    renderNew();
    await fillValid(user);
    await user.click(screen.getByRole('radio', { name: /표현이 한 단어로 정확히 있을 때만/ }));
    await user.click(screen.getByRole('button', { name: '저장' }));
    expect(api.createRule).not.toHaveBeenCalled();
    expect(screen.getByText(/‘단어 일치’는 띄어쓰기 없는 한 단어 표현만 쓸 수 있습니다: ‘수익 보장’/)).toBeInTheDocument();
    expect(screen.getByText('수익 보장').closest('.chip')).toHaveClass('chip--invalid');
  });

  it('저장 성공: 본문을 전송하고 토스트(중복 합침 포함) 뒤 목록으로 이동한다', async () => {
    const user = userEvent.setup();
    api.createRule.mockResolvedValue(makeRule({ expressionCount: 1, removedDuplicateExpressions: 1 } as never));
    renderNew();
    await fillValid(user);
    await user.click(screen.getByRole('button', { name: '저장' }));
    await waitFor(() => expect(api.createRule).toHaveBeenCalledTimes(1));
    expect(api.createRule.mock.calls[0][1]).toMatchObject({
      name: '투자 권유',
      category: 'FINANCIAL_ADVICE',
      appliesTo: 'OUTBOUND',
      action: 'MONITOR',
      matchType: 'CONTAINS',
      enabled: true,
      expressions: ['수익 보장'],
    });
    expect(await screen.findByText('규칙 목록 화면')).toBeInTheDocument();
    expect(screen.getByText(/규칙을 저장했습니다\. 지금 바로 적용됩니다\. 겹치는 표현 1개는 하나로 합쳤습니다\./)).toBeInTheDocument();
  });

  it('저장 중에는 버튼이 비활성화되고 "저장하는 중…"으로 바뀐다(더블클릭 방지)', async () => {
    const user = userEvent.setup();
    let resolve: (v: unknown) => void = () => undefined;
    api.createRule.mockReturnValue(new Promise((r) => { resolve = r; }));
    renderNew();
    await fillValid(user);
    await user.click(screen.getByRole('button', { name: '저장' }));
    const busy = await screen.findByRole('button', { name: '저장하는 중…' });
    expect(busy).toBeDisabled();
    resolve(makeRule());
  });

  it('서버 오류 매핑: 중복 이름은 이름 필드, 금지어는 대체 문구 필드, 한도 초과는 폼 상단 배너', async () => {
    const user = userEvent.setup();
    api.createRule.mockRejectedValueOnce(new ApiError(409, 'x', 'DUPLICATE_NAME' as never));
    renderNew();
    await fillValid(user);
    await user.click(screen.getByRole('button', { name: '저장' }));
    expect(await screen.findByText('같은 이름의 규칙이 이미 있습니다. 다른 이름을 적어 주세요.')).toBeInTheDocument();

    api.createRule.mockRejectedValueOnce(new ApiError(400, 'x', 'BANNED_WORD_BLOCKED' as never, [{ field: 'replacementText', message: '욕설' }]));
    await user.click(screen.getByRole('radio', { name: '안전 문구로 대체' }));
    await user.type(screen.getByLabelText(/^대체 문구/), '안내 문구');
    await user.click(screen.getByRole('button', { name: '저장' }));
    expect(await screen.findByText('대체 문구에 금지어(욕설)가 들어 있어 저장할 수 없습니다. 문구를 고쳐 주세요.')).toBeInTheDocument();

    api.createRule.mockRejectedValueOnce(new ApiError(409, 'x', 'LIMIT_EXCEEDED' as never));
    await user.click(screen.getByRole('button', { name: '저장' }));
    expect(await screen.findByText(/규칙 수 또는 표현 수가 한도를 넘었습니다/)).toBeInTheDocument();
  });

  it('시험하기 패널: 저장 전 내용(draftRule)으로 시험하고 결과 배지는 라이브 영역에 한 줄만 둔다', async () => {
    const user = userEvent.setup();
    api.test.mockResolvedValue({
      stage: 'OUTBOUND',
      result: 'MONITOR',
      hits: [{ ruleId: null, ruleName: '투자 권유', category: 'FINANCIAL_ADVICE', action: 'MONITOR', decisive: true, matchedExpressions: ['수익 보장'] }],
      resultText: '수익 보장합니다',
      piiCounts: {},
    });
    renderNew();
    await fillValid(user);
    const panel = screen.getByText('문장으로 시험하기').closest('details') as HTMLElement;
    fireEvent.change(within(panel).getByLabelText('시험할 문장'), { target: { value: '수익 보장합니다' } });
    await user.click(within(panel).getByRole('button', { name: '시험하기' }));
    await waitFor(() => expect(api.test).toHaveBeenCalledTimes(1));
    const req = api.test.mock.calls[0][1];
    expect(req).toMatchObject({ text: '수익 보장합니다', stage: 'INBOUND' });
    expect(req.draftRule).toMatchObject({ name: '투자 권유', appliesTo: 'OUTBOUND' });
    const live = panel.querySelector('[role="status"][aria-live="polite"]') as HTMLElement;
    expect(live).toHaveAttribute('aria-atomic', 'true');
    expect(await within(live).findByText('기록만 — 규칙 1개가 걸렸고 답은 그대로 나갑니다')).toBeInTheDocument();
    expect(within(within(panel).getByRole('table')).getByText(/(저장 전)/)).toBeInTheDocument();
    expect(within(panel).getAllByText('시험은 저장·기록을 남기지 않습니다.').length).toBeGreaterThan(0);
  });

  it('시험하기: 필수 항목이 비어 있으면 서버를 부르지 않고 안내 문구를 보인다', async () => {
    const user = userEvent.setup();
    renderNew();
    const panel = screen.getByText('문장으로 시험하기').closest('details') as HTMLElement;
    fireEvent.change(within(panel).getByLabelText('시험할 문장'), { target: { value: '아무 문장' } });
    await user.click(within(panel).getByRole('button', { name: '시험하기' }));
    expect(api.test).not.toHaveBeenCalled();
    expect(within(panel).getByText(/규칙의 필수 항목을 채워야 저장 전 내용으로 시험할 수 있습니다/)).toBeInTheDocument();
    // 문장이 비어 있으면 인라인 오류
    fireEvent.change(within(panel).getByLabelText('시험할 문장'), { target: { value: '' } });
    await user.click(within(panel).getByRole('button', { name: '시험하기' }));
    expect(within(panel).getByText('시험할 문장을 입력해 주세요.')).toBeInTheDocument();
  });
});

describe('GR-2 규칙 고치기', () => {
  it('기존 값을 채우고 수정 저장은 PUT(전체 교체)이다', async () => {
    const user = userEvent.setup();
    api.getRule.mockResolvedValue(makeRule({ expressions: ['수익 보장', '원금 보장'] }));
    api.updateRule.mockResolvedValue(makeRule());
    renderGuardrailPage(<GuardrailRuleFormPage />, { routePath: EDIT_PATH, extraRoutes: <Route path="/chatbots/:chatbotId/guardrails/rules" element={<p>규칙 목록 화면</p>} /> });
    expect(await screen.findByDisplayValue('투자 권유')).toBeInTheDocument();
    expect(screen.getByText('원금 보장')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '규칙 고치기 — 투자 권유' })).toBeInTheDocument();
    await user.type(screen.getByLabelText(/^이름/), ' 2');
    await user.click(screen.getByRole('button', { name: '저장' }));
    await waitFor(() => expect(api.updateRule).toHaveBeenCalledWith(CHATBOT_ID, RULE_ID_1, expect.objectContaining({ name: '투자 권유 2' })));
  });

  it('다른 관리자가 삭제한 규칙(404)은 안내와 "목록으로"를 보인다', async () => {
    api.getRule.mockRejectedValue(new ApiError(404, 'x', 'NOT_FOUND' as never));
    renderGuardrailPage(<GuardrailRuleFormPage />, { routePath: EDIT_PATH });
    expect(await screen.findByText('이 규칙을 찾을 수 없습니다. 다른 관리자가 삭제했을 수 있습니다.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '목록으로' })).toBeInTheDocument();
  });

  it('삭제 확인 대화상자의 기본 포커스는 취소이다', async () => {
    const user = userEvent.setup();
    api.getRule.mockResolvedValue(makeRule());
    renderGuardrailPage(<GuardrailRuleFormPage />, { routePath: EDIT_PATH });
    await screen.findByDisplayValue('투자 권유');
    await user.click(screen.getByRole('button', { name: '삭제' }));
    const dialog = await screen.findByRole('dialog', { name: '규칙 삭제' });
    expect(within(dialog).getByRole('button', { name: '취소' })).toHaveFocus();
  });

  it('읽기 전용(쓰기 권한 없음·보관): 폼 컨트롤 대신 읽기 전용 목록과 시험하기만 보인다', async () => {
    api.getRule.mockResolvedValue(makeRule());
    renderGuardrailPage(<GuardrailRuleFormPage />, { routePath: EDIT_PATH, guardrail: { canWrite: false } });
    expect(await screen.findByText('읽기 전용입니다. 규칙을 바꾸려면 보안 쓰기 권한이 필요합니다.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '저장' })).toBeNull();
    expect(screen.getByText('수익 보장, 원금 보장')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '시험하기' })).toBeInTheDocument();
  });
});
