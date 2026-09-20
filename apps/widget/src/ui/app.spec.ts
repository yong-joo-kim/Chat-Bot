// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { PublicChatbotConfig, PublicMessageResponse } from '@chat-bot/shared-types';
import { mountWidgetRoot } from './shadow-root';
import { createWidgetApp } from './app';

/**
 * `apps/widget` DOM 렌더링 통합 시험(FR-W-1~24) — jsdom이 Shadow DOM(`attachShadow`)을 지원하므로
 * 브라우저 없이도 런처→패널 열림, 메시지 렌더링, 버튼 클릭 이벤트, Shadow DOM 격리를 검증할 수 있다.
 * `core/`(store, session, button-action, pause-schedule) 단위 시험과 달리 이 파일은 `ui/` 전체를
 * DOM에 실제로 마운트해 조립 결과(`createWidgetApp`)를 검증한다.
 */

const SLUG = 'order-bot';
const API_BASE = 'https://api.example.test/api/v1';

function makeConfig(overrides: Partial<PublicChatbotConfig> = {}): PublicChatbotConfig {
  return {
    slug: SLUG,
    name: '주문 상담봇',
    skin: { primaryColor: '#4F46E5', headerTitle: '챗봇 상담' },
    greetingMessage: '무엇을 도와드릴까요?',
    quickReplies: [],
    launcherPosition: 'RIGHT',
    showLauncher: true,
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

function setupFetchMock(opts: {
  config?: PublicChatbotConfig;
  messageResponse?: (body: Record<string, unknown>) => PublicMessageResponse;
}): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/config')) {
      return jsonResponse(opts.config ?? makeConfig());
    }
    if (url.endsWith('/messages')) {
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
      const response = opts.messageResponse
        ? opts.messageResponse(body)
        : ({
            messageId: '11111111-1111-4111-8111-111111111111',
            outputs: [{ type: 'TEXT', payload: { text: '기본 응답입니다.' } }],
            state: { version: 1, contextSession: null },
            stateReset: false,
          } as PublicMessageResponse);
      return jsonResponse(response);
    }
    throw new Error(`예상치 못한 fetch 호출: ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function mountApp(opts: Parameters<typeof setupFetchMock>[0] = {}): { fetchMock: ReturnType<typeof vi.fn>; host: HTMLElement; shadow: ShadowRoot } {
  const fetchMock = setupFetchMock(opts);
  const mount = mountWidgetRoot();
  createWidgetApp(mount, { slug: SLUG, apiBase: API_BASE, mode: 'desktop', autoOpen: false });
  const shadow = mount.container as ShadowRoot;
  return { fetchMock, host: mount.hostElement, shadow };
}

afterEach(() => {
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

describe('위젯 Shadow DOM 격리(FR-W-12, ADR-0012 §3)', () => {
  it('#cb-widget-root 하나만 라이트 DOM에 노출되고, 내부 구조는 shadow root 안에만 존재한다', () => {
    const { host, shadow } = mountApp();

    expect(document.querySelectorAll('#cb-widget-root')).toHaveLength(1);
    // 라이트 DOM에서는 런처/패널 등 내부 마크업을 직접 조회할 수 없다(경계가 실제로 차단됨을 증명).
    expect(document.querySelector('#cb-launcher')).toBeNull();
    expect(document.querySelector('.cb-panel')).toBeNull();

    // shadow root 내부에는 정상적으로 존재한다.
    expect(host.shadowRoot).not.toBeNull();
    expect(shadow.querySelector('#cb-launcher')).not.toBeNull();
    expect(shadow.querySelector('#cb-panel')).not.toBeNull();
    // 스타일도 shadow 내부에만 주입된다(호스트 페이지 CSS와 충돌하지 않음, FR-W-12).
    expect(shadow.querySelector('style')).not.toBeNull();
    expect(document.head.querySelector('style')).toBeNull();
  });
});

describe('런처 클릭 → 패널 열림(FR-W-4, FR-W-15, AC-W-2)', () => {
  it('런처를 클릭하면 설정을 불러와 패널이 열리고 인사말이 1회 표시된다', async () => {
    const { shadow, fetchMock } = mountApp({ config: makeConfig({ greetingMessage: '안녕하세요! 무엇을 도와드릴까요?' }) });
    const launcher = shadow.querySelector<HTMLButtonElement>('#cb-launcher')!;
    const panel = shadow.querySelector<HTMLElement>('#cb-panel')!;

    expect(panel.hidden).toBe(true);
    launcher.click();

    await vi.waitFor(() => expect(panel.hidden).toBe(false));
    await vi.waitFor(() => expect(shadow.querySelector('.cb-msg-bot')).not.toBeNull());

    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/config'), expect.anything());
    expect(shadow.querySelector('#cb-messages')?.textContent).toContain('안녕하세요! 무엇을 도와드릴까요?');
    expect(launcher.getAttribute('aria-expanded')).toBe('true');
  });

  it('퀵리플라이가 있으면 인사말 아래 버튼으로 표시된다(FR-W-15)', async () => {
    const { shadow } = mountApp({ config: makeConfig({ quickReplies: ['배송 조회', '환불'] }) });
    shadow.querySelector<HTMLButtonElement>('#cb-launcher')!.click();

    await vi.waitFor(() => expect(shadow.querySelectorAll('.cb-btn')).toHaveLength(2));
    const labels = Array.from(shadow.querySelectorAll('.cb-btn')).map((b) => b.textContent);
    expect(labels).toEqual(['배송 조회', '환불']);
  });
});

describe('메시지 렌더링(FR-W-5, FR-W-9, AC-W-4)', () => {
  it('입력창에 문장을 입력해 전송하면 사용자/봇 말풍선이 순서대로 렌더된다', async () => {
    const { shadow } = mountApp({
      messageResponse: () => ({
        messageId: '22222222-2222-4222-8222-222222222222',
        outputs: [{ type: 'TEXT', payload: { text: '배송은 2~3일 소요됩니다.' } }],
        state: { version: 1, contextSession: null },
        stateReset: false,
      }),
    });
    shadow.querySelector<HTMLButtonElement>('#cb-launcher')!.click();
    await vi.waitFor(() => expect(shadow.querySelector<HTMLElement>('#cb-panel')!.hidden).toBe(false));

    const input = shadow.querySelector<HTMLTextAreaElement>('#cb-input')!;
    const form = shadow.querySelector<HTMLFormElement>('#cb-composer')!;
    input.value = '배송 조회해주세요';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    await vi.waitFor(() => expect(shadow.querySelectorAll('.cb-msg-user')).toHaveLength(1));
    expect(shadow.querySelector('.cb-msg-user')?.textContent).toContain('배송 조회해주세요');

    await vi.waitFor(() => expect(shadow.querySelectorAll('.cb-msg-bot')).toHaveLength(2)); // 인사말 1 + 응답 1
    expect(shadow.querySelector('#cb-messages')?.textContent).toContain('배송은 2~3일 소요됩니다.');
  });
});

describe('버튼 클릭 이벤트(FR-W-6, AC-W-9)', () => {
  it('퀵리플라이 버튼을 클릭하면 해당 텍스트가 사용자 메시지로 전송된다', async () => {
    const { shadow, fetchMock } = mountApp({
      config: makeConfig({ quickReplies: ['배송 조회'] }),
      messageResponse: () => ({
        messageId: '33333333-3333-4333-8333-333333333333',
        outputs: [{ type: 'TEXT', payload: { text: '운송장을 확인해 드릴게요.' } }],
        state: { version: 1, contextSession: null },
        stateReset: false,
      }),
    });
    shadow.querySelector<HTMLButtonElement>('#cb-launcher')!.click();
    await vi.waitFor(() => expect(shadow.querySelectorAll('.cb-btn')).toHaveLength(1));

    shadow.querySelector<HTMLButtonElement>('.cb-btn')!.click();

    await vi.waitFor(() => expect(shadow.querySelectorAll('.cb-msg-user')).toHaveLength(1));
    expect(shadow.querySelector('.cb-msg-user')?.textContent).toContain('배송 조회');

    const messagesCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/messages'));
    expect(messagesCall).toBeDefined();
    const sentBody = JSON.parse(String(messagesCall![1]?.body)) as { message?: string };
    expect(sentBody.message).toBe('배송 조회');

    await vi.waitFor(() => expect(shadow.querySelector('#cb-messages')?.textContent).toContain('운송장을 확인해 드릴게요.'));
  });

  it('LINK 액션 버튼 클릭은 서버로 메시지를 전송하지 않는다(FR-11-25, AC-W-10)', async () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    const { shadow, fetchMock } = mountApp({
      messageResponse: () => ({
        messageId: '44444444-4444-4444-8444-444444444444',
        outputs: [{ type: 'BUTTON', payload: { buttons: [{ label: '공식 사이트', action: 'LINK', value: 'https://example.com' }] } }],
        state: { version: 1, contextSession: null },
        stateReset: false,
      }),
    });
    shadow.querySelector<HTMLButtonElement>('#cb-launcher')!.click();
    await vi.waitFor(() => expect(shadow.querySelector<HTMLElement>('#cb-panel')!.hidden).toBe(false));

    const input = shadow.querySelector<HTMLTextAreaElement>('#cb-input')!;
    const form = shadow.querySelector<HTMLFormElement>('#cb-composer')!;
    input.value = '링크 주세요';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    await vi.waitFor(() => expect(shadow.querySelectorAll('.cb-btn')).toHaveLength(1));
    const callsBeforeClick = fetchMock.mock.calls.length;
    shadow.querySelector<HTMLButtonElement>('.cb-btn')!.click();

    expect(openSpy).toHaveBeenCalledWith('https://example.com', '_blank', 'noopener,noreferrer');
    expect(fetchMock.mock.calls.length).toBe(callsBeforeClick);
    openSpy.mockRestore();
  });
});

describe('Esc로 패널 닫기 → 런처 포커스 복귀(FR-W-19, AC-W-3)', () => {
  it('Esc를 누르면 패널이 닫히고 포커스가 런처로 돌아온다', async () => {
    const { shadow } = mountApp();
    const launcher = shadow.querySelector<HTMLButtonElement>('#cb-launcher')!;
    const panel = shadow.querySelector<HTMLElement>('#cb-panel')!;
    launcher.click();
    await vi.waitFor(() => expect(panel.hidden).toBe(false));

    panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(panel.hidden).toBe(true);
    expect(shadow.activeElement).toBe(launcher);
  });
});
