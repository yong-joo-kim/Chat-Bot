// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PublicChatbotConfig, PublicMessageResponse } from '@chat-bot/shared-types';
import { mountWidgetRoot } from './shadow-root';
import { createWidgetApp } from './app';
import { getOrCreateSessionId, loadConversationState, saveConversationState } from '../core/session';
import { loadIdentityToken } from '../core/identity-storage';
import { saveHandoffToken, loadHandoffToken } from '../core/handoff-storage';
import { IDENTITY_TOKEN_HEADER } from '../constants/identity';
import { MESSAGES } from '../constants/messages';

/**
 * 옴니채널 통합 인박스(No.42) 위젯 식별 토큰 통합 시험(`omnichannel-inbox-설계.md` §6.8).
 */

const SLUG = 'order-bot';
const API_BASE = 'https://api.example.test/api/v1';

function b64url(obj: unknown): string {
  const json = JSON.stringify(obj);
  return btoa(json).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function makeToken(sub: string): string {
  const header = b64url({ alg: 'HS256', typ: 'JWT' });
  const payload = b64url({ sub, iat: 1, exp: 9999999999 });
  const sig = b64url({ s: 'x' });
  return `${header}.${payload}.${sig}`;
}

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

function baseMessageResponse(overrides: Partial<PublicMessageResponse> = {}): PublicMessageResponse {
  return {
    messageId: '11111111-1111-4111-8111-111111111111',
    outputs: [],
    state: { version: 1, contextSession: null } as never,
    stateReset: false,
    ...overrides,
  } as PublicMessageResponse;
}

function setupFetch(): { fetchMock: ReturnType<typeof vi.fn>; lastMessageHeaders: () => Record<string, string> | undefined } {
  let lastHeaders: Record<string, string> | undefined;
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/config')) return jsonResponse(makeConfig());
    if (url.includes('/messages') && init?.method === 'POST') {
      lastHeaders = init?.headers as Record<string, string> | undefined;
      return jsonResponse(baseMessageResponse());
    }
    throw new Error(`예상치 못한 fetch 호출: ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return { fetchMock, lastMessageHeaders: () => lastHeaders };
}

async function openAndWaitReady(shadow: ShadowRoot): Promise<void> {
  shadow.querySelector<HTMLButtonElement>('#cb-launcher')!.click();
  await vi.waitFor(() => expect(shadow.querySelector<HTMLElement>('#cb-panel')!.hidden).toBe(false));
}

async function sendQuestion(shadow: ShadowRoot, text = '안녕하세요'): Promise<void> {
  const input = shadow.querySelector<HTMLTextAreaElement>('#cb-input')!;
  input.value = text;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  const form = shadow.querySelector<HTMLFormElement>('#cb-composer')!;
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await vi.waitFor(() => expect(shadow.querySelector<HTMLTextAreaElement>('#cb-input')!.disabled).toBe(false));
}

afterEach(() => {
  vi.unstubAllGlobals();
  window.sessionStorage.clear();
  document.body.innerHTML = '';
});

describe('위젯 식별 토큰(No.42) — 헤더 부착/미부착', () => {
  it('식별 토큰이 없으면 메시지 요청에 x-cb-identity 헤더가 없다', async () => {
    const { lastMessageHeaders } = setupFetch();
    const root = mountWidgetRoot();
    createWidgetApp(root, { slug: SLUG, apiBase: API_BASE, mode: 'desktop', autoOpen: false });
    const shadow = root.container as ShadowRoot;
    await openAndWaitReady(shadow);
    await sendQuestion(shadow);
    expect(lastMessageHeaders()?.[IDENTITY_TOKEN_HEADER]).toBeUndefined();
  });

  it('data-identity-token(부팅 속성)이 있으면 메시지 요청에 헤더가 붙는다', async () => {
    const { lastMessageHeaders } = setupFetch();
    const token = makeToken('member-1');
    const root = mountWidgetRoot();
    createWidgetApp(root, { slug: SLUG, apiBase: API_BASE, mode: 'desktop', autoOpen: false, identityToken: token });
    const shadow = root.container as ShadowRoot;
    await openAndWaitReady(shadow);
    await sendQuestion(shadow);
    expect(lastMessageHeaders()?.[IDENTITY_TOKEN_HEADER]).toBe(token);
    expect(loadIdentityToken(SLUG)).toBe(token);
  });

  it('identify(token)을 호출하면 이후 요청에 헤더가 붙는다', async () => {
    const { lastMessageHeaders } = setupFetch();
    const root = mountWidgetRoot();
    const app = createWidgetApp(root, { slug: SLUG, apiBase: API_BASE, mode: 'desktop', autoOpen: false });
    const shadow = root.container as ShadowRoot;
    await openAndWaitReady(shadow);

    const token = makeToken('member-2');
    app.identify(token);
    await sendQuestion(shadow);
    expect(lastMessageHeaders()?.[IDENTITY_TOKEN_HEADER]).toBe(token);
  });
});

describe('위젯 식별 토큰(No.42) — sub 변경 시 새 세션', () => {
  it('로그인 후(첫 identify, 이전 sub 없음) 세션은 유지된다', async () => {
    setupFetch();
    const root = mountWidgetRoot();
    const app = createWidgetApp(root, { slug: SLUG, apiBase: API_BASE, mode: 'desktop', autoOpen: false });
    const sidBefore = getOrCreateSessionId(SLUG);
    saveConversationState(SLUG, { version: 1, contextSession: null } as never);

    app.identify(makeToken('member-1'));

    expect(getOrCreateSessionId(SLUG)).toBe(sidBefore);
    expect(loadConversationState(SLUG)).toBeDefined();
  });

  it('로그인한 회원이 바뀌면(sub 변경) 새 세션이 발급되고 봉투가 비워진다', async () => {
    setupFetch();
    const root = mountWidgetRoot();
    const app = createWidgetApp(root, { slug: SLUG, apiBase: API_BASE, mode: 'desktop', autoOpen: false });

    app.identify(makeToken('member-1'));
    const sidAfterFirstLogin = getOrCreateSessionId(SLUG);
    saveConversationState(SLUG, { version: 1, contextSession: null } as never);
    saveHandoffToken(SLUG, { token: 'h-1', cursor: 3 });

    app.identify(makeToken('member-2'));

    const sidAfterSecondLogin = getOrCreateSessionId(SLUG);
    expect(sidAfterSecondLogin).not.toBe(sidAfterFirstLogin);
    expect(loadConversationState(SLUG)).toBeUndefined();
    expect(loadHandoffToken(SLUG)).toBeUndefined();
  });

  it('로그아웃(identify(null))하면 새 세션이 발급된다', async () => {
    setupFetch();
    const root = mountWidgetRoot();
    const app = createWidgetApp(root, { slug: SLUG, apiBase: API_BASE, mode: 'desktop', autoOpen: false });

    app.identify(makeToken('member-1'));
    const sidLoggedIn = getOrCreateSessionId(SLUG);

    app.identify(null);
    const sidAfterLogout = getOrCreateSessionId(SLUG);
    expect(sidAfterLogout).not.toBe(sidLoggedIn);
    expect(loadIdentityToken(SLUG)).toBeUndefined();
  });

  it('같은 회원으로 다시 identify()해도 세션은 그대로다', async () => {
    setupFetch();
    const root = mountWidgetRoot();
    const app = createWidgetApp(root, { slug: SLUG, apiBase: API_BASE, mode: 'desktop', autoOpen: false });

    app.identify(makeToken('member-1'));
    const sid1 = getOrCreateSessionId(SLUG);
    app.identify(makeToken('member-1'));
    const sid2 = getOrCreateSessionId(SLUG);
    expect(sid2).toBe(sid1);
  });

  it('sub 변경 시 "새 대화를 시작했어요" 안내가 시스템 메시지로 1회 표시된다', async () => {
    setupFetch();
    const root = mountWidgetRoot();
    const app = createWidgetApp(root, { slug: SLUG, apiBase: API_BASE, mode: 'desktop', autoOpen: false });
    const shadow = root.container as ShadowRoot;
    await openAndWaitReady(shadow);

    app.identify(makeToken('member-1'));
    app.identify(makeToken('member-2'));

    await vi.waitFor(() => {
      expect(shadow.textContent).toContain(MESSAGES.identityChangedNotice);
    });
  });
});

/**
 * 코드 리뷰 R1 H-1 — 부팅 시(`data-identity-token` 속성, 멀티페이지 호스트)에도 `sessionStorage`에
 * 남아 있는 이전 토큰의 `sub`와 새 속성 토큰의 `sub`를 비교해야 한다(공용 PC 시나리오). 여기서는
 * "다음 페이지 로드"를 `document.body.innerHTML = ''` 후 `createWidgetApp`을 다시 호출하는 것으로
 * 흉내 낸다(같은 탭 `sessionStorage`는 그대로 유지된다).
 */
describe('위젯 식별 토큰(No.42) — 부팅 시(data-identity-token, 멀티페이지) sub 변경 감지(코드 리뷰 R1 H-1)', () => {
  function rebootWith(identityToken?: string): ShadowRoot {
    document.body.innerHTML = '';
    const root = mountWidgetRoot();
    createWidgetApp(root, { slug: SLUG, apiBase: API_BASE, mode: 'desktop', autoOpen: false, identityToken });
    return root.container as ShadowRoot;
  }

  it('공용 PC: 이전 회원의 토큰이 남아 있는데 다른 회원 토큰으로 부팅하면 새 세션이 된다(1페이지 로그인 A → 2페이지 로그인 B)', async () => {
    setupFetch();
    rebootWith(makeToken('member-A'));
    const sidA = getOrCreateSessionId(SLUG);
    saveConversationState(SLUG, { version: 1, contextSession: null } as never);
    saveHandoffToken(SLUG, { token: 'h-1', cursor: 3 });

    const shadow = rebootWith(makeToken('member-B'));

    expect(getOrCreateSessionId(SLUG)).not.toBe(sidA);
    expect(loadConversationState(SLUG)).toBeUndefined();
    expect(loadHandoffToken(SLUG)).toBeUndefined();
    expect(shadow.textContent).toContain(MESSAGES.identityChangedNotice);
  });

  it('같은 회원의 토큰으로 다시 부팅하면(예: 같은 로그인 상태에서 다른 페이지로 이동) 세션이 유지된다', async () => {
    setupFetch();
    const token = makeToken('member-A');
    rebootWith(token);
    const sidBefore = getOrCreateSessionId(SLUG);
    saveConversationState(SLUG, { version: 1, contextSession: null } as never);

    rebootWith(token);

    expect(getOrCreateSessionId(SLUG)).toBe(sidBefore);
    expect(loadConversationState(SLUG)).toBeDefined();
  });

  it('로그인 상태에서 토큰 없이 부팅하면(로그아웃 후 페이지 이동) 새 세션이 된다', async () => {
    setupFetch();
    rebootWith(makeToken('member-A'));
    const sidLoggedIn = getOrCreateSessionId(SLUG);

    rebootWith(undefined);

    expect(getOrCreateSessionId(SLUG)).not.toBe(sidLoggedIn);
    expect(loadIdentityToken(SLUG)).toBeUndefined();
  });

  it('완전히 새 방문(이전에도 이번에도 토큰 없음)은 세션을 리셋하지 않는다', async () => {
    setupFetch();
    const root = mountWidgetRoot();
    const sidBefore = getOrCreateSessionId(SLUG);
    createWidgetApp(root, { slug: SLUG, apiBase: API_BASE, mode: 'desktop', autoOpen: false });

    expect(getOrCreateSessionId(SLUG)).toBe(sidBefore);
  });
});
