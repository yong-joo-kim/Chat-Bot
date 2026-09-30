import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '../../../api/client';
import { GuardrailEventsPage } from './GuardrailEventsPage';
import { GuardrailOverviewPage } from './GuardrailOverviewPage';
import { CHATBOT_ID, makeEvent, makeMeta, makeOverview, RULE_ID_1, RULES, renderGuardrailPage } from './testFixtures';

let mockCan: (p: string) => boolean = () => true;
let mockGovernance = false;
vi.mock('../../../context/AuthContext', () => ({
  useAuth: () => ({ can: (p: string) => mockCan(p), user: { id: 'u1', email: 'admin@example.com', governanceModeOn: mockGovernance } }),
}));

const api = vi.hoisted(() => ({ getOverview: vi.fn(), listEvents: vi.fn() }));
vi.mock('../../../api/guardrails', () => ({ guardrailsApi: api }));

const OVERVIEW_PATH = '/chatbots/:chatbotId/guardrails/overview';
const EVENTS_PATH = '/chatbots/:chatbotId/guardrails/events';

beforeEach(() => {
  Object.values(api).forEach((fn) => fn.mockReset());
  mockCan = () => true;
  mockGovernance = false;
});

describe('GR-4 현황', () => {
  it('요약 카드 7개를 값과 글자 레이블로 보이고 규칙별·가림 종류별 표를 서버 집계 그대로 보인다', async () => {
    api.getOverview.mockResolvedValue(makeOverview());
    renderGuardrailPage(<GuardrailOverviewPage />, { routePath: OVERVIEW_PATH });
    const cards = await screen.findByRole('group', { name: '요약' });
    ['사용자 질문에서 걸림', 'AI 답변에서 걸림', '안전 문구로 바뀜', 'AI로 보내지 않음', '개인정보를 가린 AI 답변', '오류로 기본 안내', 'AI 답변 중 바뀐 비율'].forEach((l) => expect(within(cards).getByText(l)).toBeInTheDocument());
    expect(within(cards).getByText('11.5%')).toBeInTheDocument();
    expect(screen.getByText(/한 문장에 여러 규칙이 걸리면 규칙마다 셉니다/)).toBeInTheDocument();
    expect(screen.getByText('AI 답변 100 + 5 + 0 = 105건 중 5건이 바뀌었습니다.')).toBeInTheDocument();
    const ruleTable = screen.getAllByRole('table')[0];
    expect(within(ruleTable).getByText(/투자 권유\(투자·재무 조언\)/)).toBeInTheDocument();
    // 삭제된 규칙은 이름 스냅샷 + "(삭제된 규칙)"이고 걸린 기록 링크가 없다.
    expect(within(ruleTable).getAllByText(/삭제된 규칙/).length).toBeGreaterThan(0);
    expect(within(ruleTable).getAllByRole('link', { name: /걸린 기록 보기/ })).toHaveLength(1);
    expect(within(ruleTable).getByRole('link', { name: '‘투자 권유’ 규칙의 걸린 기록 보기' })).toHaveAttribute('href', expect.stringContaining(`ruleId=${RULE_ID_1}`));
    expect(screen.getAllByText('주민등록번호').length).toBeGreaterThan(0);
  });

  it('분모 0의 비율은 "—"이고 스크린리더에는 "해당 기간에 AI 답변이 없습니다"를 읽힌다', async () => {
    api.getOverview.mockResolvedValue(makeOverview({ rag: { delivered: 0, replaced: 0, masked: 0, fallbackOnError: 0, replacedRatio: null } }));
    renderGuardrailPage(<GuardrailOverviewPage />, { routePath: OVERVIEW_PATH });
    expect(await screen.findByText('해당 기간에 AI 답변이 없습니다')).toBeInTheDocument();
  });

  it('승인 없이 되돌린 기록은 정적 섹션(role=alert 아님)이고 "v현재 ← v되돌린 버전"과 전환 이력 링크를 보인다', async () => {
    api.getOverview.mockResolvedValue(makeOverview());
    renderGuardrailPage(<GuardrailOverviewPage />, { routePath: OVERVIEW_PATH });
    const section = (await screen.findByRole('heading', { name: '승인 없이 되돌린 기록' })).closest('section') as HTMLElement;
    expect(within(section).getByText('v12 ← v13')).toBeInTheDocument();
    expect(within(section).getByRole('link', { name: '전환 이력 보기' })).toHaveAttribute('href', `/chatbots/${CHATBOT_ID}/environment`);
    expect(within(section).queryByRole('alert')).toBeNull();
  });

  it('사람이 확인하는 절차 표: 권한 없는 바로가기는 링크를 렌더하지 않고 글자만, 2인 승인 셀은 챗봇별 글자', async () => {
    mockCan = (p) => p === 'security:read';
    api.getOverview.mockResolvedValue(makeOverview({ hitl: { envModeOn: true, approvalRequired: true } }));
    renderGuardrailPage(<GuardrailOverviewPage />, { routePath: OVERVIEW_PATH });
    const section = (await screen.findByRole('heading', { name: '사람이 확인하는 절차' })).closest('section') as HTMLElement;
    const table = within(section).getAllByRole('table')[0];
    expect(within(table).getByText('이 챗봇은 켜짐')).toBeInTheDocument();
    expect(within(table).getByText('켜짐이면 승인된 예약만 실행')).toBeInTheDocument();
    // security:read만 있으므로 H10(규칙)·H8(업무 자동화)·H9 링크만 렌더된다.
    const links = within(table).getAllByRole('link');
    expect(links.length).toBe(3);
    expect(links.map((l) => l.getAttribute('href'))).toContain(`/chatbots/${CHATBOT_ID}/guardrails/rules`);
  });

  it('환경 분리가 꺼진 챗봇은 H4·H5의 2인 승인 셀이 "환경 분리가 꺼져 있어 해당 없음"이다', async () => {
    api.getOverview.mockResolvedValue(makeOverview({ hitl: { envModeOn: false, approvalRequired: false } }));
    renderGuardrailPage(<GuardrailOverviewPage />, { routePath: OVERVIEW_PATH });
    const table = (await screen.findByRole('heading', { name: '사람이 확인하는 절차' })).closest('section')!.querySelector('table') as HTMLElement;
    expect(within(table).getAllByText('환경 분리가 꺼져 있어 해당 없음')).toHaveLength(2);
  });

  it('기간이 90일을 넘으면 조회하지 않고 기간 필드 아래 인라인 오류를 보인다', async () => {
    const user = userEvent.setup();
    api.getOverview.mockResolvedValue(makeOverview());
    renderGuardrailPage(<GuardrailOverviewPage />, { routePath: OVERVIEW_PATH });
    await screen.findByRole('group', { name: '요약' });
    api.getOverview.mockClear();
    await user.click(screen.getByRole('radio', { name: '직접 지정' }));
    const from = screen.getByLabelText('조회 시작일');
    await user.clear(from);
    await user.type(from, '2026-01-01');
    const to = screen.getByLabelText('조회 종료일');
    await user.clear(to);
    await user.type(to, '2026-09-30');
    expect(await screen.findByText('조회 기간은 최대 90일입니다.')).toBeInTheDocument();
    // 90일을 넘는 범위로는 한 번도 조회하지 않는다(중간 입력 값의 유효한 짧은 범위 조회는 있을 수 있다).
    expect(api.getOverview).not.toHaveBeenCalledWith(CHATBOT_ID, { from: '2026-01-01', to: '2026-09-30' });
  });

  it('걸린 기록이 없으면 카드는 0으로 두고 표 자리에 빈 상태를 보이며 규칙이 0개면 안내한다', async () => {
    api.getOverview.mockResolvedValue(
      makeOverview({ totals: { inboundHits: 0, outboundHits: 0, replaced: 0, noRag: 0, monitored: 0, maskedAnswers: 0, errorFallbacks: 0 }, rules: [], pii: [], alerts: [] }),
    );
    renderGuardrailPage(<GuardrailOverviewPage />, { routePath: OVERVIEW_PATH, guardrail: { rules: [] } });
    expect(await screen.findByText('이 기간에 규칙이 걸린 기록이 없습니다.')).toBeInTheDocument();
    expect(screen.getByText('아직 규칙이 없습니다.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '규칙 만들기' })).toBeInTheDocument();
    expect(screen.getByText('이 기간에 가린 번호가 없습니다.')).toBeInTheDocument();
    expect(screen.getByText('이 기간에 승인 없이 되돌린 기록이 없습니다.')).toBeInTheDocument();
  });

  it('조회 실패여도 절차 표는 남고, 서버 꺼짐이면 "새로 걸린 기록이 쌓이지 않습니다" 한 줄을 더한다', async () => {
    api.getOverview.mockRejectedValueOnce(new ApiError(500, 'x', 'INTERNAL_ERROR' as never));
    const { unmount } = renderGuardrailPage(<GuardrailOverviewPage />, { routePath: OVERVIEW_PATH });
    expect(await screen.findByText('현황을 불러오지 못했습니다')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '사람이 확인하는 절차' })).toBeInTheDocument();
    unmount();
    api.getOverview.mockResolvedValue(makeOverview({ serverEnabled: false }));
    renderGuardrailPage(<GuardrailOverviewPage />, { routePath: OVERVIEW_PATH, guardrail: { meta: makeMeta({ serverEnabled: false }) } });
    expect(await screen.findByText('서버 설정이 꺼진 동안에는 새로 걸린 기록이 쌓이지 않습니다.')).toBeInTheDocument();
  });
});

describe('GR-5 걸린 기록', () => {
  const list = (items = [makeEvent()], total = items.length) => ({ items, total, page: 1, pageSize: 50 });

  it('행 종류별로 규칙·개인정보 가림·검사 오류를 글자로 표시하고 결과 개수를 알린다', async () => {
    api.listEvents.mockResolvedValue(
      list([
        makeEvent(),
        makeEvent({ id: 'e2', kind: 'PII', ruleId: null, ruleName: null, category: null, ruleAction: null, appliedAction: 'MASK', effect: 'CHANGED', piiKind: 'RRN', piiCount: 1 }),
        makeEvent({ id: 'e3', kind: 'ERROR', ruleId: null, ruleName: null, category: null, ruleAction: null, appliedAction: 'FALLBACK', effect: 'CHANGED', errorCode: 'TimeoutError' }),
      ]),
    );
    renderGuardrailPage(<GuardrailEventsPage />, { routePath: EVENTS_PATH });
    const table = (await screen.findAllByRole('table'))[0];
    expect(within(table).getByText('투자 권유(투자·재무 조언)')).toBeInTheDocument();
    expect(within(table).getByText('개인정보 가림 — 주민등록번호 1건')).toBeInTheDocument();
    expect(within(table).getByText('검사 오류 — 원인 코드: TimeoutError')).toBeInTheDocument();
    expect(within(table).getByText('기본 안내 문구로 대체')).toBeInTheDocument();
    expect(within(table).getByText('개인정보 가림', { selector: '.severity-badge' })).toBeInTheDocument();
    expect(within(table).getByText('걸린 기록 목록 — 총 3건')).toBeInTheDocument();
    expect(screen.getByText('걸린 기록 3건', { selector: '[role="status"]' })).toBeInTheDocument();
  });

  it('필터는 "조회" 버튼으로만 적용한다(셀렉트 값 변경만으로 조회하지 않는다)', async () => {
    const user = userEvent.setup();
    api.listEvents.mockResolvedValue(list());
    renderGuardrailPage(<GuardrailEventsPage />, { routePath: EVENTS_PATH, guardrail: { rules: RULES } });
    await screen.findAllByRole('table');
    expect(api.listEvents).toHaveBeenCalledTimes(1);
    await user.selectOptions(screen.getByLabelText('위치'), 'OUTBOUND');
    await user.selectOptions(screen.getByLabelText('규칙'), RULE_ID_1);
    expect(api.listEvents).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: '조회' }));
    await waitFor(() => expect(api.listEvents).toHaveBeenCalledTimes(2));
    const query = api.listEvents.mock.calls[1][1];
    expect(query).toMatchObject({ stage: 'OUTBOUND', ruleId: RULE_ID_1, page: 1, pageSize: 50 });
    expect(query.from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('기간이 90일을 넘으면 조회하지 않고 인라인 오류를 보인다', async () => {
    const user = userEvent.setup();
    api.listEvents.mockResolvedValue(list());
    renderGuardrailPage(<GuardrailEventsPage />, { routePath: EVENTS_PATH });
    await screen.findAllByRole('table');
    const from = screen.getByLabelText('시작일');
    await user.clear(from);
    await user.type(from, '2026-01-01');
    await user.click(screen.getByRole('button', { name: '조회' }));
    expect(screen.getByText('조회 기간은 최대 90일입니다.')).toBeInTheDocument();
    expect(api.listEvents).toHaveBeenCalledTimes(1);
  });

  it('대화 보기는 aria-expanded로 펼치고 추가 API 호출 없이 가림 처리본을 글자로만 보인다(HTML 주입 방지)', async () => {
    const user = userEvent.setup();
    api.listEvents.mockResolvedValue(
      list([makeEvent({ conversation: { userMessage: '<script>alert(1)</script> <b>굵게</b>', botResponse: '주민번호는 [주민등록번호]', textPurged: false } })]),
    );
    const { container } = renderGuardrailPage(<GuardrailEventsPage />, { routePath: EVENTS_PATH });
    const table = (await screen.findAllByRole('table'))[0];
    const toggle = within(table).getByRole('button', { name: /걸린 기록의 대화 보기/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(api.listEvents).toHaveBeenCalledTimes(1);
    expect(within(table).getByText('사용자 질문(개인정보 가림 처리본)')).toBeInTheDocument();
    expect(within(table).getByText('<script>alert(1)</script> <b>굵게</b>')).toBeInTheDocument();
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('.guardrail-conversation b')).toBeNull();
    expect(within(table).getByText(/저장할 때 개인정보가 가려진 문장입니다/)).toBeInTheDocument();
  });

  it('보존 기간이 지나 파기된 문장과 연결 기록 없음을 안내한다', async () => {
    const user = userEvent.setup();
    api.listEvents.mockResolvedValue(
      list([
        makeEvent({ id: 'p1', conversation: { userMessage: '', botResponse: '', textPurged: true } }),
        makeEvent({ id: 'n1', conversation: null }),
      ]),
    );
    renderGuardrailPage(<GuardrailEventsPage />, { routePath: EVENTS_PATH });
    const table = (await screen.findAllByRole('table'))[0];
    for (const b of within(table).getAllByRole('button', { name: /대화 보기/ })) await user.click(b);
    expect(within(table).getByText('보존 기간이 지나 문장이 삭제되었습니다. 걸린 기록 수치만 남아 있습니다.')).toBeInTheDocument();
    expect(within(table).getByText('연결된 대화 기록을 찾을 수 없습니다.')).toBeInTheDocument();
  });

  it('거버넌스 모드에서만 열람 감사 배너(정적 문단)를 보인다', async () => {
    api.listEvents.mockResolvedValue(list());
    mockGovernance = true;
    const { unmount } = renderGuardrailPage(<GuardrailEventsPage />, { routePath: EVENTS_PATH });
    const banner = await screen.findByText(/열람은 감사로그에 기록됩니다|열람이 기록됩니다|감사/, { selector: 'p.form-banner' });
    expect(banner).not.toHaveAttribute('aria-live');
    expect(banner).not.toHaveAttribute('role');
    unmount();
    mockGovernance = false;
    renderGuardrailPage(<GuardrailEventsPage />, { routePath: EVENTS_PATH });
    await screen.findAllByRole('table');
    expect(document.querySelector('p.form-banner')).toBeNull();
  });

  it('빈 상태(필터 없음/있음)와 조회 실패를 구분해 안내한다', async () => {
    api.listEvents.mockResolvedValue(list([], 0));
    const { unmount } = renderGuardrailPage(<GuardrailEventsPage />, { routePath: EVENTS_PATH });
    expect(await screen.findByText('이 기간에 걸린 기록이 없습니다.')).toBeInTheDocument();
    unmount();
    renderGuardrailPage(<GuardrailEventsPage />, { routePath: EVENTS_PATH, url: `/chatbots/${CHATBOT_ID}/guardrails/events?stage=INBOUND` });
    expect(await screen.findByText('조건에 맞는 기록이 없습니다')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: '필터 지우기' }).length).toBeGreaterThan(0);
    api.listEvents.mockRejectedValue(new ApiError(500, 'x', 'INTERNAL_ERROR' as never));
    const again = renderGuardrailPage(<GuardrailEventsPage />, { routePath: EVENTS_PATH });
    expect(await within(again.container).findByText('걸린 기록을 불러오지 못했습니다')).toBeInTheDocument();
  });

  it('셸이 규칙 목록을 못 받았으면 규칙 필터를 막고 안내한다', async () => {
    api.listEvents.mockResolvedValue(list());
    renderGuardrailPage(<GuardrailEventsPage />, { routePath: EVENTS_PATH, guardrail: { rules: [], error: true, meta: null } });
    await screen.findAllByRole('table');
    expect(screen.getByLabelText('규칙')).toBeDisabled();
    expect(screen.getByText('규칙 목록을 불러오지 못해 규칙 필터를 쓸 수 없습니다.')).toBeInTheDocument();
  });
});
