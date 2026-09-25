// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PendingAnswerPollResponse, PublicChatbotConfig, PublicMessageResponse } from '@chat-bot/shared-types';
import { mountWidgetRoot } from './shadow-root';
import { createWidgetApp } from './app';
import { MESSAGES } from '../constants/messages';

/**
 * 피드백 기반 개선 루프(No.44) 위젯 통합 시험 — 서버가 `feedback.rateable === true`를 준 봇
 * 말풍선에만 평가 막대가 붙고(FR-FB9-3), 클릭이 실제 `PUT …/messages/:id/feedback`을 호출하며,
 * `#cb-status`에 안내가 1회 온다(§3.2.4)는 것을 DOM 레벨로 검증한다.
 */

const SLUG = 'order-bot';
const API_BASE = 'https://api.example.test/api/v1';
const PENDING_ID = '99999999-9999-4999-8999-999999999999';

function makeConfig(): PublicChatbotConfig {
  return {
    slug: SLUG,
    name: '주문 상담봇',
    skin: { primaryColor: '#4F46E5', headerTitle: '챗봇 상담' },
    greetingMessage: undefined,
    quickReplies: [],
    launcherPosition: 'RIGHT',
    showLauncher: true,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

function mount(): { shadow: ShadowRoot } {
  const root = mountWidgetRoot();
  createWidgetApp(root, { slug: SLUG, apiBase: API_BASE, mode: 'desktop', autoOpen: false });
  return { shadow: root.container as ShadowRoot };
}

async function openAndSend(shadow: ShadowRoot, text = '배송 얼마나 걸려요'): Promise<void> {
  shadow.querySelector<HTMLButtonElement>('#cb-launcher')!.click();
  await vi.waitFor(() => expect(shadow.querySelector<HTMLElement>('#cb-panel')!.hidden).toBe(false));
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

describe('위젯 답변 평가(No.44) — 일반 턴', () => {
  it('sendMessage 요청 본문 features에 feedback-v1이 실린다', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/config')) return jsonResponse(makeConfig());
      if (url.endsWith('/messages')) {
        return jsonResponse({
          messageId: '11111111-1111-4111-8111-111111111111',
          outputs: [{ type: 'TEXT', payload: { text: '3~5영업일 소요됩니다.' } }],
          state: { version: 1, contextSession: null },
          stateReset: false,
        } as PublicMessageResponse);
      }
      throw new Error(`예상치 못한 fetch 호출: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const { shadow } = mount();
    await openAndSend(shadow);
    await vi.waitFor(() => expect(shadow.querySelector('.cb-msg-bot')).not.toBeNull());

    const call = fetchMock.mock.calls.find(([u]) => String(u).endsWith('/messages'));
    const body = JSON.parse(String(call?.[1]?.body)) as { features?: string[] };
    expect(body.features).toEqual(['handoff-v1', 'feedback-v1']);
  });

  it('feedback.rateable이 없는 응답에는 평가 막대가 없다', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/config')) return jsonResponse(makeConfig());
      if (url.endsWith('/messages')) {
        return jsonResponse({
          messageId: '11111111-1111-4111-8111-111111111111',
          outputs: [{ type: 'TEXT', payload: { text: '안녕하세요' } }],
          state: { version: 1, contextSession: null },
          stateReset: false,
        } as PublicMessageResponse);
      }
      throw new Error(`예상치 못한 fetch 호출: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const { shadow } = mount();
    await openAndSend(shadow);
    await vi.waitFor(() => expect(shadow.querySelector('.cb-msg-bot')).not.toBeNull());
    expect(shadow.querySelector('.cb-feedback-bar')).toBeNull();
  });

  it('feedback.rateable=true인 봇 말풍선에 평가 막대가 붙고, 클릭하면 PUT을 호출하고 #cb-status에 1회 안내한다', async () => {
    const messageId = '22222222-2222-4222-8222-222222222222';
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/config')) return jsonResponse(makeConfig());
      if (url.endsWith('/messages')) {
        return jsonResponse({
          messageId,
          outputs: [{ type: 'TEXT', payload: { text: '3~5영업일 소요됩니다.' } }],
          state: { version: 1, contextSession: null },
          stateReset: false,
          feedback: { rateable: true },
        } as PublicMessageResponse);
      }
      if (url.includes(`/messages/${messageId}/feedback`) && init?.method === 'PUT') {
        return jsonResponse({ rating: 'DOWN' });
      }
      throw new Error(`예상치 못한 fetch 호출: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const { shadow } = mount();
    await openAndSend(shadow);

    await vi.waitFor(() => expect(shadow.querySelector('.cb-feedback-bar')).not.toBeNull());
    const downBtn = shadow.querySelector<HTMLButtonElement>('.cb-feedback-down')!;
    downBtn.click();

    await vi.waitFor(() => expect(downBtn.getAttribute('aria-pressed')).toBe('true'));
    const putCall = fetchMock.mock.calls.find(([u, i]) => String(u).includes('/feedback') && (i as RequestInit | undefined)?.method === 'PUT');
    expect(putCall).toBeDefined();
    const putBody = JSON.parse(String(putCall?.[1]?.body)) as { sessionId?: string; rating?: string };
    expect(putBody.rating).toBe('DOWN');
    expect(typeof putBody.sessionId).toBe('string');
    expect(putBody.sessionId).toHaveLength(36);

    await vi.waitFor(() => expect(shadow.querySelector('#cb-status')?.textContent).toBe('의견을 보내 주셔서 고마워요'));
  });
});

describe('위젯 답변 평가(No.44) — 보류 RAG 최종 답변에만', () => {
  it('인터림 말풍선에는 평가 막대가 없고, READY 최종 답변에만 붙는다', async () => {
    let pollCallCount = 0;
    const pollResponses: PendingAnswerPollResponse[] = [
      { status: 'PENDING' },
      { status: 'READY', outputs: [{ type: 'TEXT', payload: { text: '재해경위서가 필요합니다.' } }] },
    ];
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/config')) return jsonResponse(makeConfig());
      if (url.endsWith('/messages')) {
        return jsonResponse({
          messageId: PENDING_ID,
          outputs: [{ type: 'TEXT', payload: { text: '문서를 찾아보고 있어요' } }],
          state: { version: 1, contextSession: null },
          stateReset: false,
          pendingAnswer: { id: PENDING_ID, pollAfterMs: 5, expiresAt: new Date(Date.now() + 60_000).toISOString() },
          feedback: { rateable: true },
        } as PublicMessageResponse);
      }
      if (url.includes(`/messages/${PENDING_ID}`)) {
        const idx = Math.min(pollCallCount, pollResponses.length - 1);
        pollCallCount += 1;
        return jsonResponse(pollResponses[idx]);
      }
      throw new Error(`예상치 못한 fetch 호출: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const { shadow } = mount();
    await openAndSend(shadow);

    // 인터림 말풍선 단계 — 평가 막대 없음(§3.2.1).
    await vi.waitFor(() => expect(shadow.querySelector('.cb-pending-indicator')).not.toBeNull());
    expect(shadow.querySelector('.cb-feedback-bar')).toBeNull();

    // 최종 답변(READY) 단계 — 평가 막대 있음.
    await vi.waitFor(() => expect(shadow.querySelector('.cb-pending-indicator')).toBeNull(), { timeout: 4000 });
    expect(shadow.querySelector('.cb-feedback-bar')).not.toBeNull();
  }, 8000);
});

describe('위젯 답변 평가(No.44) — 404 재시도·409 잠김', () => {
  it('404는 1초 뒤 1회 재시도하고, 그래도 실패하면 잠긴다', async () => {
    const messageId = '33333333-3333-4333-8333-333333333333';
    let feedbackCallCount = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/config')) return jsonResponse(makeConfig());
      if (url.endsWith('/messages')) {
        return jsonResponse({
          messageId,
          outputs: [{ type: 'TEXT', payload: { text: '답변입니다.' } }],
          state: { version: 1, contextSession: null },
          stateReset: false,
          feedback: { rateable: true },
        } as PublicMessageResponse);
      }
      if (url.includes('/feedback') && init?.method === 'PUT') {
        feedbackCallCount += 1;
        return jsonResponse({}, 404);
      }
      throw new Error(`예상치 못한 fetch 호출: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const { shadow } = mount();
    await openAndSend(shadow);
    await vi.waitFor(() => expect(shadow.querySelector('.cb-feedback-bar')).not.toBeNull());

    const upBtn = shadow.querySelector<HTMLButtonElement>('.cb-feedback-up')!;
    upBtn.click();

    await vi.waitFor(() => expect(feedbackCallCount).toBe(2), { timeout: 3000 });
    expect(upBtn.disabled).toBe(true);
    expect(upBtn.getAttribute('aria-pressed')).toBe('false');
  }, 5000);

  it('요청이 진행 중인 동안에는 버튼이 비활성화되어 중복 요청이 나가지 않는다', async () => {
    const messageId = '44444444-4444-4444-8444-444444444444';
    let feedbackCallCount = 0;
    let resolvePut!: () => void;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/config')) return jsonResponse(makeConfig());
      if (url.endsWith('/messages')) {
        return jsonResponse({
          messageId,
          outputs: [{ type: 'TEXT', payload: { text: '답변입니다.' } }],
          state: { version: 1, contextSession: null },
          stateReset: false,
          feedback: { rateable: true },
        } as PublicMessageResponse);
      }
      if (url.includes('/feedback') && init?.method === 'PUT') {
        feedbackCallCount += 1;
        await new Promise<void>((resolve) => {
          resolvePut = resolve;
        });
        return jsonResponse({ rating: 'UP' });
      }
      throw new Error(`예상치 못한 fetch 호출: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const { shadow } = mount();
    await openAndSend(shadow);
    await vi.waitFor(() => expect(shadow.querySelector('.cb-feedback-bar')).not.toBeNull());

    const upBtn = shadow.querySelector<HTMLButtonElement>('.cb-feedback-up')!;
    const downBtn = shadow.querySelector<HTMLButtonElement>('.cb-feedback-down')!;
    upBtn.click();
    downBtn.click(); // 진행 중 — 무시되어야 한다

    await vi.waitFor(() => expect(feedbackCallCount).toBe(1));
    resolvePut();
    await vi.waitFor(() => expect(upBtn.disabled).toBe(false));
    expect(feedbackCallCount).toBe(1);
  });
});

describe('위젯 답변 평가(No.44) — 보류 RAG 최종 답변 직후 2초 타이머 경합(R1 Medium)', () => {
  it('READY 최종 답변 직후(0.3초 뒤) 평가를 클릭하면, pollPendingAnswer가 예약한 2초 타이머가 평가 안내를 지우지 않는다', async () => {
    vi.useFakeTimers();
    const messageId = '55555555-5555-4555-8555-555555555555';
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/config')) return jsonResponse(makeConfig());
      if (url.endsWith('/messages') && init?.method === 'POST') {
        return jsonResponse({
          messageId,
          outputs: [{ type: 'TEXT', payload: { text: '문서를 찾아보고 있어요' } }],
          state: { version: 1, contextSession: null },
          stateReset: false,
          pendingAnswer: { id: messageId, pollAfterMs: 1000, expiresAt: new Date(Date.now() + 60_000).toISOString() },
          feedback: { rateable: true },
        } as PublicMessageResponse);
      }
      if (url.includes(`/messages/${messageId}/feedback`) && init?.method === 'PUT') {
        return jsonResponse({ rating: 'DOWN' });
      }
      if (url.includes(`/messages/${messageId}`)) {
        return jsonResponse({ status: 'READY', outputs: [{ type: 'TEXT', payload: { text: '재해경위서가 필요합니다.' } }] } as PendingAnswerPollResponse);
      }
      throw new Error(`예상치 못한 fetch 호출: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    try {
      const { shadow } = mount();

      shadow.querySelector<HTMLButtonElement>('#cb-launcher')!.click();
      await vi.advanceTimersByTimeAsync(0);
      expect(shadow.querySelector<HTMLElement>('#cb-panel')!.hidden).toBe(false);

      const input = shadow.querySelector<HTMLTextAreaElement>('#cb-input')!;
      const form = shadow.querySelector<HTMLFormElement>('#cb-composer')!;
      input.value = '재해경위서 필요한가요';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await vi.advanceTimersByTimeAsync(0);

      // 보류 답변 폴링(pollAfterMs=1000) 완료 — READY 최종 답변 + 평가 막대.
      await vi.advanceTimersByTimeAsync(1000);
      expect(shadow.querySelector('#cb-status')?.textContent).toBe(MESSAGES.pending.readyAnnounce);
      const downBtn = shadow.querySelector<HTMLButtonElement>('.cb-feedback-down')!;
      expect(downBtn).not.toBeNull();

      // 0.3초 뒤 사용자가 평가를 클릭한다 — announceFeedback이 "고마워요" 안내로 덮어쓴다.
      await vi.advanceTimersByTimeAsync(300);
      downBtn.click();
      await vi.advanceTimersByTimeAsync(0);
      expect(shadow.querySelector('#cb-status')?.textContent).toBe(MESSAGES.feedback.thanks);

      // pollPendingAnswer가 READY 시점에 예약한 2초 타이머가 T=3000(=1000+300+1700)에 발화한다 —
      // 이제는 자기 문구(readyAnnounce)가 아니라 평가 안내이므로 지우면 안 된다(R1 Medium 재현 포인트).
      await vi.advanceTimersByTimeAsync(1700);
      expect(shadow.querySelector('#cb-status')?.textContent).toBe(MESSAGES.feedback.thanks);

      // announceFeedback 자신의 2초 타이머(T=3300)는 자기 문구이므로 정상적으로 지운다.
      await vi.advanceTimersByTimeAsync(300);
      expect(shadow.querySelector('#cb-status')?.textContent).toBe('');
    } finally {
      vi.useRealTimers();
    }
  });
});
