import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import { MemoryRouter } from 'react-router-dom';
import { ChatBubble } from './ChatBubble';
import { RagUsageToggle } from './RagUsageToggle';
import type { SimMessage } from './types';

expect.extend(toHaveNoViolations);

let mockCan: (p: string) => boolean = () => true;
vi.mock('../../../context/AuthContext', () => ({ useAuth: () => ({ can: (p: string) => mockCan(p), user: null }) }));

const base: SimMessage = { id: 'm1', role: 'bot', text: '안녕하세요' };

function renderBubble(message: SimMessage): ReturnType<typeof render> {
  return render(
    <MemoryRouter>
      <ChatBubble message={message} chatbotId="bot-1" onButtonClick={vi.fn()} />
    </MemoryRouter>,
  );
}

describe('시뮬레이터 — 입구 판정 안내(SM-1)', () => {
  it('키가 없으면 기존과 같다(안내·미리보기를 렌더하지 않는다)', () => {
    renderBubble(base);
    expect(screen.queryByText(/운영에서는 이 질문에/)).toBeNull();
    expect(screen.queryByText(/AI 답변 미리보기/)).toBeNull();
  });

  it('REPLACE: 규칙 이름·대체 문구와 "엔진의 원래 결과를 그대로 보여 줍니다" 안내를 접힘 밖에 보인다', () => {
    renderBubble({ ...base, guardrailInbound: { action: 'REPLACE', ruleNames: ['위기 표현', '투자 권유'], replacementText: '전문 기관에 연락해 주세요' } });
    const notice = screen.getByRole('status');
    expect(notice).toHaveTextContent('운영에서는 이 질문에 ‘위기 표현, 투자 권유’ 규칙이 걸려, 대화 엔진과 AI 답변을 거치지 않고 아래 안전 문구가 나갑니다.');
    expect(notice).toHaveTextContent('전문 기관에 연락해 주세요');
    expect(notice).toHaveTextContent('이 시뮬레이터는 엔진의 원래 결과를 그대로 보여 줍니다.');
    expect(within(notice).getByText('안전 문구로 대체')).toBeInTheDocument();
    expect(within(notice).getByRole('link', { name: '규칙 보기' })).toHaveAttribute('href', '/chatbots/bot-1/guardrails/rules');
  });

  it('NO_RAG: AI 답변 사용을 선택했다면 그 사실도 알리고, MONITOR는 기록만이라 답은 그대로 나간다고 안내한다', () => {
    const { unmount } = renderBubble({ ...base, guardrailInbound: { action: 'NO_RAG', ruleNames: ['지시 무시'] }, ragRequested: true });
    expect(screen.getByRole('status')).toHaveTextContent('AI 답변으로 넘어가지 않습니다. 대화 엔진이 답하지 못하면 기본 안내 문구로 끝납니다.');
    expect(screen.getByRole('status')).toHaveTextContent('AI 답변 사용을 선택했지만 이 질문은 AI로 보내지 않았습니다.');
    unmount();
    renderBubble({ ...base, guardrailInbound: { action: 'MONITOR', ruleNames: ['투자 권유'] } });
    expect(screen.getByRole('status')).toHaveTextContent('‘기록만’이라 답은 그대로 나갑니다');
  });

  it('security:read가 없으면 규칙 보기 링크를 렌더하지 않는다', () => {
    mockCan = (p) => p !== 'security:read';
    renderBubble({ ...base, guardrailInbound: { action: 'MONITOR', ruleNames: ['투자 권유'] } });
    expect(screen.queryByRole('link', { name: '규칙 보기' })).toBeNull();
    mockCan = () => true;
  });
});

describe('시뮬레이터 — AI 답변 미리보기(RagPreviewPanel)', () => {
  const withPreview = (ragPreview: NonNullable<SimMessage['matchTrace']>['ragPreview']): SimMessage =>
    ({ ...base, matchTrace: { ragUsed: true, ragPreview } as never }) as SimMessage;

  it('REPLACED: 나가는 문구와 원래 답(가림 처리본)을 접힌 details로 두고 기록이 남지 않는다고 안내한다', () => {
    renderBubble(withPreview({ outcome: 'REPLACED', finalText: '투자 판단은 고객님께서 직접', originalMasked: '수익 보장합니다 [주민등록번호]', ruleNames: ['투자 권유'], piiCounts: { RRN: 1 } }));
    expect(screen.getByText('AI 답변 미리보기 (운영에서 실제로 나가는 모습)')).toBeInTheDocument();
    expect(screen.getByText('결과: 안전 문구로 바뀌어 나갑니다 — ‘투자 권유’ 규칙')).toBeInTheDocument();
    expect(screen.getByText('투자 판단은 고객님께서 직접')).toBeInTheDocument();
    const details = screen.getByText('원래 AI 답변 보기(개인정보는 저장할 때처럼 가려서 표시)').closest('details') as HTMLElement;
    expect(details).not.toHaveAttribute('open');
    expect(within(details).getByText('수익 보장합니다 [주민등록번호]')).toBeInTheDocument();
    expect(within(details).getByText('관리자 화면에서도 개인정보 원문은 보여 주지 않습니다.')).toBeInTheDocument();
    expect(screen.getByText('가린 개인정보: 주민등록번호 1건')).toBeInTheDocument();
    expect(screen.getByText('시뮬레이터에서는 걸린 기록이 남지 않습니다.')).toBeInTheDocument();
  });

  it('결과별 글자(그대로/가림/기본 안내/기록만)와 결과 문구는 글자로만 렌더한다', () => {
    const { unmount, container } = renderBubble(withPreview({ outcome: 'PASS', finalText: '<b>그대로</b>', ruleNames: [], piiCounts: {} }));
    expect(screen.getByText('결과: 그대로 나갑니다')).toBeInTheDocument();
    expect(screen.getByText('<b>그대로</b>')).toBeInTheDocument();
    expect(container.querySelector('.rag-preview-panel b')).toBeNull();
    unmount();
    const masked = renderBubble(withPreview({ outcome: 'MASKED', finalText: '번호는 [주민등록번호]', ruleNames: [], piiCounts: { RRN: 1 } }));
    expect(screen.getByText('결과: 개인정보를 가려서 나갑니다')).toBeInTheDocument();
    masked.unmount();
    const fb = renderBubble(withPreview({ outcome: 'FALLBACK', finalText: '기본 안내', originalMasked: '원답', ruleNames: [], piiCounts: {} }));
    expect(screen.getByText('결과: AI 답변 대신 기본 안내 문구가 나갑니다')).toBeInTheDocument();
    fb.unmount();
    renderBubble(withPreview({ outcome: 'MONITOR', finalText: '그대로', ruleNames: ['투자 권유'], piiCounts: {} }));
    expect(screen.getByText('결과: 그대로 나갑니다 — ‘투자 권유’ 규칙이 걸렸지만 기록만입니다')).toBeInTheDocument();
  });

  it('axe: 안내·미리보기가 있는 말풍선에 구조적 접근성 위반이 없다', async () => {
    const { container } = renderBubble({
      ...base,
      guardrailInbound: { action: 'REPLACE', ruleNames: ['위기 표현'], replacementText: '안내' },
      matchTrace: { ragUsed: true, ragPreview: { outcome: 'REPLACED', finalText: '안내', originalMasked: '원답', ruleNames: ['위기 표현'], piiCounts: {} } } as never,
    });
    expect(await axe(container, { rules: { region: { enabled: false } } })).toHaveNoViolations();
  });
});

describe('RagUsageToggle 캡션', () => {
  it('기존 캡션 뒤에 "운영과 같은 위험 응답 규칙·개인정보 가림 결과도 함께 보여 줍니다."가 붙는다', () => {
    render(<RagUsageToggle checked={false} onChange={vi.fn()} />);
    expect(screen.getByText(/운영과 같은 위험 응답 규칙·개인정보 가림 결과도 함께 보여 줍니다\./)).toBeInTheDocument();
  });
});
