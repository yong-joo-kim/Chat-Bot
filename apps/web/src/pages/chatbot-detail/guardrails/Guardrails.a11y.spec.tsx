import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe, toHaveNoViolations } from 'jest-axe';
import { GuardrailEventsPage } from './GuardrailEventsPage';
import { GuardrailOverviewPage } from './GuardrailOverviewPage';
import { GuardrailPiiSettingsPage } from './GuardrailPiiSettingsPage';
import { GuardrailRuleFormPage } from './GuardrailRuleFormPage';
import { GuardrailRuleListPage } from './GuardrailRuleListPage';
import { makeEvent, makeOverview, makeRule, makeSettings, renderGuardrailPage } from './testFixtures';

expect.extend(toHaveNoViolations);

vi.mock('../../../context/AuthContext', () => ({
  useAuth: () => ({ can: () => true, user: { id: 'u1', email: 'admin@example.com', governanceModeOn: true } }),
}));
const api = vi.hoisted(() => ({
  getSettings: vi.fn(),
  getOverview: vi.fn(),
  listEvents: vi.fn(),
  getRule: vi.fn(),
  test: vi.fn(),
}));
vi.mock('../../../api/guardrails', () => ({ guardrailsApi: api }));

// 격리 렌더에는 페이지 수준 랜드마크가 없으므로 그 규칙(region)만 끈다. 대화상자는 body에 포털로 붙어 body 전체를 스캔한다.
const OPTS = { rules: { region: { enabled: false } } };

beforeEach(() => {
  Object.values(api).forEach((fn) => fn.mockReset());
  api.getSettings.mockResolvedValue(makeSettings({ governanceFloor: ['RRN', 'CARD'] }));
  api.getOverview.mockResolvedValue(makeOverview());
  api.listEvents.mockResolvedValue({ items: [makeEvent()], total: 1, page: 1, pageSize: 50 });
  api.getRule.mockResolvedValue(makeRule());
});

describe('안전 가드레일 화면 — axe 접근성 스캔', () => {
  it('GR-1 규칙 목록(표+카드+시험하기 패널)에 구조적 접근성 위반이 없다', async () => {
    const { container } = renderGuardrailPage(<GuardrailRuleListPage />);
    await screen.findAllByRole('table');
    expect(await axe(container, OPTS)).toHaveNoViolations();
  });

  it('GR-1 삭제 확인 대화상자에 위반이 없다', async () => {
    const user = userEvent.setup();
    renderGuardrailPage(<GuardrailRuleListPage />);
    await user.click(screen.getAllByRole('button', { name: '‘투자 권유’ 규칙 삭제' })[0]);
    await screen.findByRole('dialog', { name: '규칙 삭제' });
    expect(await axe(document.body, OPTS)).toHaveNoViolations();
  });

  it('GR-2 규칙 폼(오류가 표시된 상태)에 구조적 접근성 위반이 없다', async () => {
    const user = userEvent.setup();
    const { container } = renderGuardrailPage(<GuardrailRuleFormPage />, { routePath: '/chatbots/:chatbotId/guardrails/rules/new' });
    await user.click(screen.getByRole('button', { name: '저장' }));
    await screen.findByText('이름을 1~50자로 적어 주세요.');
    expect(await axe(container, OPTS)).toHaveNoViolations();
  });

  it('GR-2 규칙 고치기(읽기 전용 포함)에 위반이 없다', async () => {
    const { container } = renderGuardrailPage(<GuardrailRuleFormPage />, { routePath: '/chatbots/:chatbotId/guardrails/rules/:ruleId', guardrail: { canWrite: false } });
    await screen.findByText('읽기 전용입니다. 규칙을 바꾸려면 보안 쓰기 권한이 필요합니다.');
    expect(await axe(container, OPTS)).toHaveNoViolations();
  });

  it('GR-3 개인정보 가림 설정(거버넌스 하한 잠금 상태)에 위반이 없다', async () => {
    const { container } = renderGuardrailPage(<GuardrailPiiSettingsPage />, { routePath: '/chatbots/:chatbotId/guardrails/pii' });
    await screen.findByRole('group', { name: '가릴 번호 종류' });
    expect(await axe(container, OPTS)).toHaveNoViolations();
  });

  it('GR-3 약화 저장 확인 대화상자에 위반이 없다', async () => {
    const user = userEvent.setup();
    api.getSettings.mockResolvedValue(makeSettings());
    renderGuardrailPage(<GuardrailPiiSettingsPage />, { routePath: '/chatbots/:chatbotId/guardrails/pii' });
    await user.click(await screen.findByRole('checkbox', { name: /주민등록번호/ }));
    await user.click(screen.getByRole('button', { name: '저장' }));
    await screen.findByRole('dialog', { name: '개인정보 가림 줄이기' });
    expect(await axe(document.body, OPTS)).toHaveNoViolations();
  });

  it('GR-4 현황에 위반이 없다', async () => {
    const { container } = renderGuardrailPage(<GuardrailOverviewPage />, { routePath: '/chatbots/:chatbotId/guardrails/overview' });
    await screen.findByRole('group', { name: '요약' });
    expect(await axe(container, OPTS)).toHaveNoViolations();
  });

  it('GR-5 걸린 기록(대화 펼침·열람 감사 배너)에 위반이 없다', async () => {
    const user = userEvent.setup();
    const { container } = renderGuardrailPage(<GuardrailEventsPage />, { routePath: '/chatbots/:chatbotId/guardrails/events' });
    const table = (await screen.findAllByRole('table'))[0];
    await user.click(table.querySelector('button[aria-expanded]') as HTMLElement);
    expect(await axe(container, OPTS)).toHaveNoViolations();
  });
});
