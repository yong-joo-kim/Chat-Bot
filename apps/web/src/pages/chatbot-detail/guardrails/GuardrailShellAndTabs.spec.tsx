import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ToastProvider } from '../../../components/Toast';
import { GUARDRAIL_MESSAGES } from '../../../constants/guardrails.messages';
import { MESSAGES } from '../../../constants/messages';
import { makeChatbot } from '../../../test/fixtures';
import { TabNav } from '../TabNav';
import { GuardrailDataMapSection } from './GuardrailDataMapSection';
import { GuardrailShell } from './GuardrailShell';
import { CHATBOT_ID, makeMeta, RULES } from './testFixtures';

let mockStatus: 'ACTIVE' | 'ARCHIVED' = 'ACTIVE';
vi.mock('../../ChatbotDetailLayout', () => ({
  useChatbotDetailContext: () => ({ chatbot: makeChatbot({ id: CHATBOT_ID, status: mockStatus }), reload: vi.fn(), setUnsavedGuard: vi.fn(), learningSummary: null, refreshLearningSummary: vi.fn() }),
}));
vi.mock('../../../context/AuthContext', () => ({
  useAuth: () => ({ can: () => true, user: { id: 'u1', email: 'a@b.c', governanceModeOn: false } }),
}));
const api = vi.hoisted(() => ({ listRules: vi.fn() }));
vi.mock('../../../api/guardrails', () => ({ guardrailsApi: api }));
vi.mock('../../../api/deploySchedules', () => ({ deploySchedulesApi: { summary: vi.fn().mockResolvedValue({ needsAttention: { byChatbot: [] } }) } }));

function renderShell(): ReturnType<typeof render> {
  return render(
    <MemoryRouter initialEntries={[`/chatbots/${CHATBOT_ID}/guardrails/rules`]}>
      <ToastProvider>
        <Routes>
          <Route path="/chatbots/:chatbotId/guardrails" element={<GuardrailShell />}>
            <Route path="rules" element={<p>규칙 자리</p>} />
            <Route path="pii" element={<p>가림 자리</p>} />
          </Route>
        </Routes>
      </ToastProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mockStatus = 'ACTIVE';
  api.listRules.mockReset();
  api.listRules.mockResolvedValue({ items: RULES, meta: makeMeta() });
});

describe('GR-0 셸', () => {
  it('제목(탭 이름 1곳)·서브내비 4개(현재 항목 표시)·저장 즉시 적용 상시 안내를 그린다', async () => {
    renderShell();
    expect(screen.getByRole('heading', { level: 1, name: '안전 가드레일' })).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: GUARDRAIL_MESSAGES.shell.subNavLabel });
    ['위험 응답 규칙', '개인정보 가림', '현황', '걸린 기록'].forEach((n) => expect(nav).toHaveTextContent(n));
    expect(screen.getByRole('link', { name: '위험 응답 규칙' })).toHaveClass('stats-subnav-link--active');
    expect(screen.getByRole('link', { name: '개인정보 가림' })).not.toHaveClass('stats-subnav-link--active');
    expect(screen.getByText(/저장하면 바로 운영 중인 대화에 적용됩니다\. 초안·운영 구분이 없고 버전 기록·복원·예약 배포에 포함되지 않습니다\./)).toBeInTheDocument();
    expect(await screen.findByText('규칙 자리')).toBeInTheDocument();
    expect(api.listRules).toHaveBeenCalledTimes(1);
  });

  it('서버 설정으로 꺼져 있으면 경고 배너(글자 + ⚠)를 보인다', async () => {
    api.listRules.mockResolvedValue({ items: RULES, meta: makeMeta({ serverEnabled: false }) });
    renderShell();
    expect(await screen.findByText(/서버 설정으로 위험 응답 규칙과 개인정보 가림이 꺼져 있어 지금은 적용되지 않습니다/)).toBeInTheDocument();
  });

  it('보관 챗봇이면 보관 배너를 보인다', async () => {
    mockStatus = 'ARCHIVED';
    renderShell();
    expect(screen.getByText(/보관된 챗봇입니다/)).toBeInTheDocument();
  });

  it('규칙 목록 조회가 실패해도 서브내비와 본문(Outlet)은 그대로 그린다', async () => {
    api.listRules.mockRejectedValue(new Error('x'));
    renderShell();
    expect(await screen.findByText('규칙 자리')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('navigation', { name: GUARDRAIL_MESSAGES.shell.subNavLabel })).toBeInTheDocument());
  });
});

describe('TabNav — "안전 가드레일" 탭', () => {
  it('"검증" 그룹 4번째 탭으로 권한과 무관하게 링크가 보인다', () => {
    render(
      <MemoryRouter>
        <TabNav chatbotId={CHATBOT_ID} learningSummary={null} environmentStatus={null} />
      </MemoryRouter>,
    );
    const group = screen.getByRole('group', { name: MESSAGES.detail.tabGroupVerify });
    const links = Array.from(group.querySelectorAll('a')).map((a) => a.textContent?.trim());
    expect(links).toEqual(['AI 답변 설정', '응답 테스트', '대화검증', '안전 가드레일']);
    expect(screen.getByRole('link', { name: '안전 가드레일' })).toHaveAttribute('href', `/chatbots/${CHATBOT_ID}/guardrails`);
  });
});

describe('데이터 지도 절(DM-1)', () => {
  it('제목·규칙·걸린 기록(문장 미저장)·외부 전송 없음·가림 기본·승인·서버 스위치를 글자로 보인다', () => {
    render(
      <GuardrailDataMapSection
        map={{
          chatbotsWithRules: 2,
          rules: 5,
          enabledRules: 4,
          events: 120,
          eventsStoreText: false,
          exits: [],
          piiExitDefaultKinds: ['RRN', 'CARD'],
          piiExitCustomizedChatbots: 1,
          approvalPolicyChatbots: 3,
          serverEnabled: false,
        }}
      />,
    );
    expect(screen.getByRole('heading', { name: '위험 응답 규칙·개인정보 가림·운영 전환 2인 승인' })).toBeInTheDocument();
    expect(screen.getByText('규칙이 있는 챗봇 2개 · 규칙 5개(사용 중 4개)')).toBeInTheDocument();
    expect(screen.getByText(/걸린 기록 120건 —/)).toBeInTheDocument();
    expect(screen.getByText('문장은 저장하지 않고 규칙·횟수·시각만 남깁니다.')).toBeInTheDocument();
    expect(screen.getByText('이 기능이 새로 만드는 외부 전송 통로는 없습니다.')).toBeInTheDocument();
    expect(screen.getByText('AI 답변 개인정보 가림 기본 종류: 주민등록번호·카드번호 · 종류를 바꾼 챗봇 1개')).toBeInTheDocument();
    expect(screen.getByText('운영 전환 2인 승인을 켠 챗봇 3개')).toBeInTheDocument();
    expect(screen.getByText('서버 스위치: 꺼짐')).toBeInTheDocument();
  });
});
