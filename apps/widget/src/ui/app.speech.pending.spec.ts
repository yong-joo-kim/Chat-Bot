// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountWidgetRoot } from './shadow-root';
import { createWidgetApp } from './app';

/**
 * 외부 RAG 보류 답(PENDING → 폴링) 음성 시나리오(voice-ai-ui-spec §4.3 · AC-VO3-5) — 대기 문구 말풍선에는 듣기 버튼이
 * 없고, 최종 답(READY)이 표시되는 순간 그 답에 버튼이 생기며 자동 읽기가 켜져 있으면 그때 읽는다.
 */
const SLUG = 'voice-bot';
const PENDING_ID = '99999999-9999-4999-8999-999999999999';

afterEach(() => {
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
  delete (window as unknown as Record<string, unknown>).speechSynthesis;
  window.sessionStorage.clear();
});

describe('보류 답변 + 음성', () => {
  it('대기 문구·PENDING 폴링에는 듣기 버튼이 없고, READY 최종 답에 버튼이 생겨 자동 읽기가 그때 시작된다', async () => {
    const spoken: Array<{ text: string }> = [];
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: {
        getVoices: () => [{ lang: 'ko-KR', localService: true, default: true }],
        speak: (u: { text: string }) => void spoken.push(u),
        cancel: vi.fn(),
        addEventListener: vi.fn(),
      },
    });
    vi.stubGlobal(
      'SpeechSynthesisUtterance',
      class {
        voice: unknown;
        lang = '';
        rate = 1;
        pitch = 1;
        volume = 1;
        onend = null;
        onerror = null;
        constructor(public text: string) {}
      },
    );
    let polls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as Response;
        if (url.endsWith('/config')) {
          return ok({
            slug: SLUG,
            name: '음성봇',
            skin: { primaryColor: '#4F46E5', headerTitle: '상담' },
            greetingMessage: '안녕하세요',
            quickReplies: [],
            launcherPosition: 'RIGHT',
            showLauncher: true,
            voice: { input: false, tts: true, autoReadToggle: true, rate: 1 },
          });
        }
        if (url.endsWith('/messages') && init?.method === 'POST') {
          return ok({
            messageId: PENDING_ID,
            outputs: [{ type: 'TEXT', payload: { text: '문서에서 찾아보고 있어요' } }],
            state: { version: 1, contextSession: null },
            stateReset: false,
            pendingAnswer: { id: PENDING_ID, pollAfterMs: 5, expiresAt: new Date(Date.now() + 60_000).toISOString() },
          });
        }
        if (url.includes(`/messages/${PENDING_ID}`)) {
          polls += 1;
          return polls === 1
            ? ok({ status: 'PENDING' })
            : ok({
                status: 'READY',
                outputs: [{ type: 'TEXT', payload: { text: '재해경위서가 필요합니다.' } }],
                speech: { text: '재해경위서가 필요합니다.', tone: 'CALM' },
              });
        }
        throw new Error(`예상치 못한 fetch: ${url}`);
      }),
    );
    const mount = mountWidgetRoot();
    createWidgetApp(mount, { slug: SLUG, apiBase: 'https://api.example.test/api/v1', mode: 'desktop', autoOpen: false });
    const shadow = mount.container as ShadowRoot;
    shadow.querySelector<HTMLButtonElement>('#cb-launcher')!.click();
    await vi.waitFor(() => expect(shadow.querySelector('.cb-msg-bot')).not.toBeNull());
    shadow.querySelector<HTMLButtonElement>('.cb-ar-switch')!.click(); // 자동 읽기 켜기(사용자 조작)
    spoken.length = 0; // 무음 unlock 발화 제외
    shadow.querySelector<HTMLTextAreaElement>('#cb-input')!.value = '요양급여 서류가 뭔가요?';
    shadow.querySelector<HTMLFormElement>('#cb-composer')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    await vi.waitFor(() => expect(shadow.querySelector('.cb-pending-indicator')).not.toBeNull());
    expect(shadow.querySelector('#cb-messages')?.textContent).toContain('문서에서 찾아보고 있어요');
    expect(shadow.querySelectorAll('.cb-listen')).toHaveLength(0); // 대기 중 비활성 버튼을 미리 보여 주지 않는다
    expect(spoken).toHaveLength(0); // 대기 중 침묵

    await vi.waitFor(() => expect(shadow.querySelector('.cb-pending-indicator')).toBeNull(), { timeout: 5000 });
    await vi.waitFor(() => expect(shadow.querySelectorAll('.cb-listen')).toHaveLength(1));
    await vi.waitFor(() => expect(spoken.map((u) => u.text)).toEqual(['재해경위서가 필요합니다.']));
  }, 10000);
});
