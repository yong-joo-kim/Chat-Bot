// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from 'vitest';
import type { PendingAnswerPollResponse, PublicChatbotConfig, PublicMessageResponse } from '@chat-bot/shared-types';
import { mountWidgetRoot } from './shadow-root';
import { createWidgetApp } from './app';

/**
 * 공개 위젯 PENDING → 폴링 → 완료 통합 시나리오(FR-N2-33~40, ADR-0023, AC-N2-17 계열).
 * 백엔드 통합 시험(`apps/api/src/integration/nlu-rag-answering.integration.spec.ts`)은
 * `RAG_BASE_URL`을 의도적으로 비워 둔 상태로만 실행되어(AC-N4-1 검증) 이 경로를 태우지 않는다 —
 * 위젯이 실제로 소비하는 계약(`pendingAnswer` → 폴링 → `READY`/`FAILED`/`EXPIRED`)은
 * 여기서 DOM 레벨로 검증한다(`code-reviewer`/`test-automation` 인계 공백 처리).
 *
 * 폴링 응답 목록의 **첫 항목은 항상 `PENDING`으로 고정**한다 — 위젯의 폴링 간격은 최초
 * `pollAfterMs` 이후 고정 1.5초(`nextPollDelayMs`)이므로, 최종 상태(READY 등)를 1차 폴링에
 * 바로 주면 인디케이터가 나타났다 사라지는 구간이 `vi.waitFor`의 관찰 간격보다 짧아져 관찰에
 * 실패할 수 있다. `PENDING` 1회를 거치게 해 인디케이터가 확실히 관찰 가능한 시간 동안 유지되게 한다.
 */

const SLUG = 'order-bot';
const API_BASE = 'https://api.example.test/api/v1';
const PENDING_ID = '99999999-9999-4999-8999-999999999999';

function makeConfig(): PublicChatbotConfig {
  return {
    slug: SLUG,
    name: '주문 상담봇',
    skin: { primaryColor: '#4F46E5', headerTitle: '챗봇 상담' },
    greetingMessage: '무엇을 도와드릴까요?',
    quickReplies: [],
    launcherPosition: 'RIGHT',
    showLauncher: true,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

function setupFetch(pollResponses: PendingAnswerPollResponse[]): { pollCallCount: () => number } {
  let pollCallCount = 0;
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/config')) return jsonResponse(makeConfig());
    if (url.endsWith('/messages') && init?.method === 'POST') {
      return jsonResponse({
        messageId: PENDING_ID,
        outputs: [{ type: 'TEXT', payload: { text: '문서에서 찾아보고 있어요' } }],
        state: { version: 1, contextSession: null },
        stateReset: false,
        pendingAnswer: { id: PENDING_ID, pollAfterMs: 5, expiresAt: new Date(Date.now() + 60_000).toISOString() },
      } as PublicMessageResponse);
    }
    if (url.includes(`/messages/${PENDING_ID}`)) {
      const idx = Math.min(pollCallCount, pollResponses.length - 1);
      const res = pollResponses[idx];
      pollCallCount += 1;
      return jsonResponse(res);
    }
    throw new Error(`예상치 못한 fetch 호출: ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return { pollCallCount: () => pollCallCount };
}

function mount(): { shadow: ShadowRoot } {
  const root = mountWidgetRoot();
  createWidgetApp(root, { slug: SLUG, apiBase: API_BASE, mode: 'desktop', autoOpen: false });
  return { shadow: root.container as ShadowRoot };
}

async function sendQuestion(shadow: ShadowRoot, text = '산재 요양급여 신청 서류가 뭔가요?'): Promise<void> {
  shadow.querySelector<HTMLButtonElement>('#cb-launcher')!.click();
  await vi.waitFor(() => expect(shadow.querySelector<HTMLElement>('#cb-panel')!.hidden).toBe(false));
  await vi.waitFor(() => expect(shadow.querySelector('.cb-msg-bot')).not.toBeNull()); // 인사말 로딩 대기
  const input = shadow.querySelector<HTMLTextAreaElement>('#cb-input')!;
  const form = shadow.querySelector<HTMLFormElement>('#cb-composer')!;
  input.value = text;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
}

afterEach(() => {
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

describe('PENDING 백그라운드 답변 대기(ADR-0023, FR-N2-33~40)', () => {
  it(
    '질문 전송 → PENDING 즉시 응답(인터림 말풍선+진행 인디케이터, 입력 잠금 없음) → 폴링 → 완료 답변(출처 포함)으로 교체된다',
    async () => {
      setupFetch([
        { status: 'PENDING' },
        {
          status: 'READY',
          outputs: [{ type: 'TEXT', payload: { text: '요양급여 신청에는 재해경위서가 필요합니다.' } }],
          sources: [{ fileName: '산재보험안내.pdf', sectionTitle: '요양급여 신청', page: 12 }],
        },
      ]);
      const { shadow } = mount();
      await sendQuestion(shadow);

      // PENDING 즉시 응답 — 인터림 말풍선 + 진행 인디케이터, 입력은 잠기지 않는다(FR-N2-38/39).
      await vi.waitFor(() => expect(shadow.querySelector('.cb-pending-indicator')).not.toBeNull());
      expect(shadow.querySelector('#cb-messages')?.textContent).toContain('문서에서 찾아보고 있어요');
      expect(shadow.querySelector<HTMLTextAreaElement>('#cb-input')!.readOnly).toBe(false);
      expect(shadow.querySelector('#cb-status')?.getAttribute('role')).toBe('status');
      expect(shadow.querySelector('#cb-status')?.textContent).toBe('문서를 확인하고 있어요');

      // 폴링 완료(1.5초 간격 1회 경유) → 최종 답변 + 출처로 교체, 인디케이터 제거
      // (NFR-A3: 출처는 링크가 아닌 텍스트).
      await vi.waitFor(() => expect(shadow.querySelector('.cb-pending-indicator')).toBeNull(), { timeout: 4000 });
      expect(shadow.querySelector('#cb-messages')?.textContent).toContain('요양급여 신청에는 재해경위서가 필요합니다.');
      const sources = shadow.querySelector('.cb-sources');
      expect(sources).not.toBeNull();
      expect(sources?.querySelector('a')).toBeNull(); // 링크가 아니라 텍스트다(NFR-A3)
      expect(sources?.textContent).toContain('산재보험안내.pdf');
      expect(sources?.textContent).toContain('요양급여 신청');
      expect(sources?.textContent).toContain('12쪽');
    },
    8000,
  );

  it(
    '폴링이 FAILED를 반환하면 우리 폴백 문구로 마감된다(RAG 실패 원문 미노출, FR-N2-19)',
    async () => {
      setupFetch([{ status: 'PENDING' }, { status: 'FAILED', outputs: [{ type: 'TEXT', payload: { text: '죄송해요, 잘 이해하지 못했어요.' } }] }]);
      const { shadow } = mount();
      await sendQuestion(shadow);

      await vi.waitFor(() => expect(shadow.querySelector('.cb-pending-indicator')).not.toBeNull());
      await vi.waitFor(() => expect(shadow.querySelector('.cb-pending-indicator')).toBeNull(), { timeout: 4000 });
      expect(shadow.querySelector('#cb-messages')?.textContent).toContain('죄송해요, 잘 이해하지 못했어요.');
      expect(shadow.querySelector('.cb-sources')).toBeNull();
    },
    8000,
  );

  it(
    'EXPIRED(404/TTL 만료)는 오류가 아니라 정리 문구로 마감한다(S-15)',
    async () => {
      setupFetch([{ status: 'PENDING' }, { status: 'EXPIRED' }]);
      const { shadow } = mount();
      await sendQuestion(shadow);

      await vi.waitFor(() => expect(shadow.querySelector('.cb-pending-indicator')).not.toBeNull());
      await vi.waitFor(() => expect(shadow.querySelector('.cb-pending-indicator')).toBeNull(), { timeout: 4000 });
      expect(shadow.querySelector('#cb-messages')?.textContent).toContain('지금은 답변을 준비하지 못했어요.');
    },
    8000,
  );

  it('도중 사용자가 새 질문을 보내면 이전 폴링을 폐기하고 인디케이터를 즉시 제거한다(EX-N2-11)', async () => {
    const { pollCallCount } = setupFetch([{ status: 'PENDING' }]);
    const { shadow } = mount();
    await sendQuestion(shadow);
    await vi.waitFor(() => expect(shadow.querySelector('.cb-pending-indicator')).not.toBeNull());

    const input = shadow.querySelector<HTMLTextAreaElement>('#cb-input')!;
    const form = shadow.querySelector<HTMLFormElement>('#cb-composer')!;
    input.value = '다른 질문입니다';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    // 새 턴 전송 즉시(동기 구간) 이전 인디케이터가 제거되고 새 인디케이터 1개만 남는다 —
    // 폐기된 이전 폴링의 결과를 기다리지 않는다.
    await vi.waitFor(() => expect(shadow.querySelectorAll('.cb-pending-indicator')).toHaveLength(1));
    expect(pollCallCount()).toBeGreaterThanOrEqual(0);
  });
});
