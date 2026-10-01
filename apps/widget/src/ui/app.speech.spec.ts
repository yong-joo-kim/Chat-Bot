// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PublicChatbotConfig, PublicMessageResponse } from '@chat-bot/shared-types';
import { mountWidgetRoot } from './shadow-root';
import { createWidgetApp } from './app';
import { SPEECH_MESSAGES as M } from '../constants/speech';

/**
 * 음성 AI(No.32) 위젯 통합 시험 — 가짜 `speechSynthesis`·`MediaRecorder`·`getUserMedia`로
 * voice-ai-ui-spec §4(VO-W1~W3) · 설계 §9를 DOM 레벨에서 검증한다.
 */

const SLUG = 'voice-bot';
const API_BASE = 'https://api.example.test/api/v1';
const KO_LOCAL = { lang: 'ko-KR', localService: true, default: true };

type Voice = { voice?: { input: boolean; tts: boolean; autoReadToggle: boolean; rate: number } };

function makeConfig(voice?: Voice['voice']): PublicChatbotConfig {
  return {
    slug: SLUG,
    name: '음성봇',
    skin: { primaryColor: '#4F46E5', headerTitle: '챗봇 상담' },
    greetingMessage: '무엇을 도와드릴까요?',
    quickReplies: [],
    launcherPosition: 'RIGHT',
    showLauncher: true,
    ...(voice ? { voice } : {}),
  } as PublicChatbotConfig;
}

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

class FakeUtterance {
  voice: unknown;
  lang = '';
  rate = 1;
  pitch = 1;
  volume = 1;
  onend: (() => void) | null = null;
  onerror: ((e: { error?: string }) => void) | null = null;
  constructor(public text: string) {}
}

class FakeRecorder {
  static instances: FakeRecorder[] = [];
  static isTypeSupported = () => true;
  mimeType = 'audio/webm;codecs=opus';
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  constructor(
    public stream: unknown,
    public opts: unknown,
  ) {
    FakeRecorder.instances.push(this);
  }
  start = vi.fn();
  stop(): void {
    this.ondataavailable?.({ data: new Blob([new Uint8Array(200)]) });
    queueMicrotask(() => this.onstop?.());
  }
}

interface Env {
  synth: { getVoices: ReturnType<typeof vi.fn>; speak: ReturnType<typeof vi.fn>; cancel: ReturnType<typeof vi.fn>; spoken: FakeUtterance[] };
  track: { stop: ReturnType<typeof vi.fn> };
  getUserMedia: ReturnType<typeof vi.fn>;
}

function installEnv(opts: { voices?: unknown[]; media?: boolean } = {}): Env {
  const spoken: FakeUtterance[] = [];
  const synth = {
    getVoices: vi.fn(() => opts.voices ?? [KO_LOCAL]),
    speak: vi.fn((u: FakeUtterance) => void spoken.push(u)),
    cancel: vi.fn(),
    addEventListener: vi.fn(),
    spoken,
  };
  Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true });
  vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance);
  const track = { stop: vi.fn() };
  const getUserMedia = vi.fn(async () => ({ getTracks: () => [track] }));
  if (opts.media !== false) {
    Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia }, configurable: true });
    vi.stubGlobal('MediaRecorder', FakeRecorder);
    Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true });
  }
  FakeRecorder.instances = [];
  return { synth, track, getUserMedia };
}

interface Boot {
  shadow: ShadowRoot;
  fetchMock: ReturnType<typeof vi.fn>;
  messageBodies: Array<Record<string, unknown>>;
  transcriptionCalls: Array<{ init: RequestInit }>;
}

function boot(opts: {
  voice?: Voice['voice'];
  messageResponse?: (n: number) => Partial<PublicMessageResponse> & { speech?: { text: string; tone: string } };
  transcription?: () => Response;
}): Boot {
  const messageBodies: Array<Record<string, unknown>> = [];
  const transcriptionCalls: Array<{ init: RequestInit }> = [];
  let n = 0;
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/config')) return jsonResponse(makeConfig(opts.voice));
    if (url.endsWith('/speech/transcriptions')) {
      transcriptionCalls.push({ init: init! });
      return opts.transcription ? opts.transcription() : jsonResponse({ text: '카드 분실 신고', durationMs: 1800 });
    }
    if (url.endsWith('/messages')) {
      messageBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      n += 1;
      const extra = opts.messageResponse?.(n) ?? {};
      return jsonResponse({
        messageId: `00000000-0000-4000-8000-00000000000${n}`,
        outputs: [{ type: 'TEXT', payload: { text: `응답 ${n}` } }],
        state: { version: 1, contextSession: null },
        stateReset: false,
        ...extra,
      });
    }
    throw new Error(`예상치 못한 fetch 호출: ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  const mount = mountWidgetRoot();
  createWidgetApp(mount, { slug: SLUG, apiBase: API_BASE, mode: 'desktop', autoOpen: false });
  return { shadow: mount.container as ShadowRoot, fetchMock, messageBodies, transcriptionCalls };
}

async function openPanel(shadow: ShadowRoot): Promise<void> {
  shadow.querySelector<HTMLButtonElement>('#cb-launcher')!.click();
  await vi.waitFor(() => expect(shadow.querySelector<HTMLElement>('#cb-panel')!.hidden).toBe(false));
  await vi.waitFor(() => expect(shadow.querySelector('.cb-msg-bot')).not.toBeNull());
}

async function sendText(shadow: ShadowRoot, text: string, expectedBotMessages: number): Promise<void> {
  const input = shadow.querySelector<HTMLTextAreaElement>('#cb-input')!;
  input.value = text; // 'input' 이벤트를 내지 않는다(글자 입력 시작 = 읽기 정지 계기라 시험 의도와 섞이지 않게)
  shadow.querySelector<HTMLFormElement>('#cb-composer')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await vi.waitFor(() => expect(shadow.querySelectorAll('.cb-msg-bot')).toHaveLength(expectedBotMessages));
}

const q = <T extends Element>(shadow: ShadowRoot, sel: string): T | null => shadow.querySelector<T>(sel);
const SPEECH = { text: '첫 문장입니다. 둘째 문장입니다.', tone: 'CALM' };

beforeEach(() => {
  window.sessionStorage.clear();
});
afterEach(() => {
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
  delete (window as unknown as Record<string, unknown>).speechSynthesis;
  delete (navigator as unknown as Record<string, unknown>).mediaDevices;
  Object.defineProperty(document, 'hidden', { value: false, configurable: true });
});

describe('config.voice 없음 — 음성 코드는 아무것도 실행하지 않는다(NFR-VOP5)', () => {
  it('DOM 0 · getVoices() 0 · 권한 요청 0 · 가시성 리스너 0 · features 3개 그대로', async () => {
    const env = installEnv();
    const { shadow, messageBodies } = boot({ messageResponse: () => ({ speech: SPEECH }) }); // 서버가 보내도 위젯은 무시
    const addSpy = vi.spyOn(document, 'addEventListener');
    await openPanel(shadow);
    await sendText(shadow, '안녕', 2); // 인사말 1 + 응답 1
    expect(shadow.querySelector('.cb-mic, .cb-voice, .cb-voicebar, .cb-listen, .cb-actions, #cb-voice-reason')).toBeNull();
    expect(shadow.querySelector('.cb-composer--voice')).toBeNull();
    expect(env.synth.getVoices).not.toHaveBeenCalled();
    expect(env.getUserMedia).not.toHaveBeenCalled();
    expect(addSpy.mock.calls.filter(([type]) => type === 'visibilitychange')).toHaveLength(0);
    expect(messageBodies[0].features).toEqual(['handoff-v1', 'feedback-v1', 'rich-v1']);
  });

  it('voice 키가 있어도 input·tts가 모두 거짓이면 조립하지 않는다', async () => {
    const env = installEnv();
    const { shadow } = boot({ voice: { input: false, tts: false, autoReadToggle: false, rate: 1 } });
    await openPanel(shadow);
    expect(shadow.querySelector('.cb-voicebar, .cb-mic')).toBeNull();
    expect(env.synth.getVoices).not.toHaveBeenCalled();
  });

  it('Esc는 지금처럼 패널을 닫는다(가드 미설정)', async () => {
    installEnv();
    const { shadow } = boot({});
    await openPanel(shadow);
    q<HTMLElement>(shadow, '#cb-panel')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(q<HTMLElement>(shadow, '#cb-panel')!.hidden).toBe(true);
  });
});

describe('답변 듣기(VO-W2)', () => {
  const voice = { input: false, tts: true, autoReadToggle: true, rate: 1 };

  it('tts=true면 요청 features 끝에 speech-v1을 싣는다', async () => {
    installEnv();
    const { shadow, messageBodies } = boot({ voice });
    await openPanel(shadow);
    await sendText(shadow, '안녕', 2);
    expect(messageBodies[0].features).toEqual(['handoff-v1', 'feedback-v1', 'rich-v1', 'speech-v1']);
  });

  it('speech 키가 있는 응답에만 듣기 버튼이 생기고, 키 없는 응답(시스템 안내 등)에는 없다', async () => {
    installEnv();
    const { shadow } = boot({ voice, messageResponse: (n) => (n === 1 ? { speech: SPEECH } : {}) });
    await openPanel(shadow);
    await sendText(shadow, '하나', 2);
    expect(shadow.querySelectorAll('.cb-listen')).toHaveLength(1);
    await sendText(shadow, '둘', 3);
    expect(shadow.querySelectorAll('.cb-listen')).toHaveLength(1); // speech 없는 두 번째 응답에는 버튼 없음
    const btn = q<HTMLButtonElement>(shadow, '.cb-listen')!;
    expect(btn.textContent).toBe('듣기');
    expect(btn.getAttribute('aria-label')).toBe('이 답변 듣기');
    expect(btn.closest('[role=group]')).toBeNull(); // 평가 막대(role=group)에 넣지 않는다
  });

  it('듣기 → 말투·속도로 문장 단위 재생 · 같은 노드가 멈추기로 바뀌고 새 노드가 생기지 않는다', async () => {
    const env = installEnv();
    const { shadow } = boot({ voice: { ...voice, rate: 1.1 }, messageResponse: () => ({ speech: { text: '첫 문장입니다. 둘째 문장입니다.', tone: 'APOLOGETIC' } }) });
    await openPanel(shadow);
    await sendText(shadow, '질문', 2);
    const btn = q<HTMLButtonElement>(shadow, '.cb-listen')!;
    const nodeCountBefore = shadow.querySelectorAll('#cb-messages *').length;
    btn.click();
    expect(env.synth.spoken).toHaveLength(2);
    expect(env.synth.spoken[0].volume).toBeCloseTo(0.9, 5);
    expect(env.synth.spoken[0].pitch).toBeCloseTo(0.9, 5);
    expect(env.synth.spoken[0].rate).toBeCloseTo(0.9 * 1.1, 5);
    expect(q<HTMLButtonElement>(shadow, '.cb-listen')).toBe(btn); // 같은 노드
    expect(btn.textContent).toBe('멈추기');
    expect(btn.getAttribute('aria-label')).toBe('듣기 멈추기');
    expect(btn.hasAttribute('aria-pressed')).toBe(false);
    expect(shadow.querySelectorAll('#cb-messages *').length).toBe(nodeCountBefore);
    btn.click(); // 멈추기
    expect(env.synth.cancel).toHaveBeenCalled();
    expect(btn.textContent).toBe('듣기');
    // 재생 시작·끝은 라이브 영역으로 낭독하지 않는다
    expect(q(shadow, '#cb-status')!.textContent).toBe('');
  });

  it('읽기 중 다른 답의 듣기를 누르면 앞의 답이 멈추고 그 버튼은 듣기로 돌아간다(한 번에 한 답)', async () => {
    const env = installEnv();
    const { shadow } = boot({ voice, messageResponse: () => ({ speech: SPEECH }) });
    await openPanel(shadow);
    await sendText(shadow, '하나', 2);
    await sendText(shadow, '둘', 3);
    const [a, b] = Array.from(shadow.querySelectorAll<HTMLButtonElement>('.cb-listen'));
    a.click();
    expect(a.textContent).toBe('멈추기');
    b.click();
    expect(a.textContent).toBe('듣기');
    expect(b.textContent).toBe('멈추기');
    expect(env.synth.cancel).toHaveBeenCalled();
  });

  it('기기에 한국어 음성이 없으면 숨기지 않고 aria-disabled + 이유 줄 연결 · 눌러도 speak 0(AC-VO3-2)', async () => {
    const env = installEnv({ voices: [{ lang: 'en-US', localService: true }, { lang: 'ko-KR', localService: false }] });
    const { shadow } = boot({ voice, messageResponse: () => ({ speech: SPEECH }) });
    await openPanel(shadow);
    await sendText(shadow, '질문', 2);
    // 2초 대기 전에는 "확인 중" 이유 줄
    expect(q(shadow, '#cb-voice-reason')!.textContent).toBe(M.voiceChecking);
    await vi.waitFor(() => expect(q(shadow, '#cb-voice-reason')!.textContent).toBe(M.voiceUnavailable), { timeout: 3500 });
    const btn = q<HTMLButtonElement>(shadow, '.cb-listen')!;
    expect(btn.getAttribute('aria-disabled')).toBe('true');
    expect(btn.getAttribute('aria-describedby')).toBe('cb-voice-reason');
    btn.click();
    expect(env.synth.speak).not.toHaveBeenCalled();
    const toggle = q<HTMLButtonElement>(shadow, '.cb-ar-switch')!;
    expect(toggle.getAttribute('aria-disabled')).toBe('true');
    toggle.click();
    expect(toggle.getAttribute('aria-checked')).toBe('false');
  }, 8000);

  it('입력창에 글자를 치기 시작하면 읽기를 멈춘다', async () => {
    installEnv();
    const { shadow } = boot({ voice, messageResponse: () => ({ speech: SPEECH }) });
    await openPanel(shadow);
    await sendText(shadow, '질문', 2);
    const btn = q<HTMLButtonElement>(shadow, '.cb-listen')!;
    btn.click();
    expect(btn.textContent).toBe('멈추기');
    const input = q<HTMLTextAreaElement>(shadow, '#cb-input')!;
    input.value = 'ㄱ';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(btn.textContent).toBe('듣기');
  });

  it('창을 닫으면 읽기를 멈춘다', async () => {
    const env = installEnv();
    const { shadow } = boot({ voice, messageResponse: () => ({ speech: SPEECH }) });
    await openPanel(shadow);
    await sendText(shadow, '질문', 2);
    const btn = q<HTMLButtonElement>(shadow, '.cb-listen')!;
    btn.click();
    q<HTMLButtonElement>(shadow, '#cb-close')!.click();
    expect(env.synth.cancel).toHaveBeenCalled();
    expect(btn.textContent).toBe('듣기');
  });
});

describe('답변 소리로 듣기 토글(VO-W3) · 자동 읽기', () => {
  const voice = { input: false, tts: true, autoReadToggle: true, rate: 1 };

  it('헤더 바로 아래 행 · 기본 꺼짐 · role=switch · 켜짐/꺼짐 글자 상시 · 설명 연결', async () => {
    installEnv();
    const { shadow } = boot({ voice });
    await openPanel(shadow);
    const panel = q<HTMLElement>(shadow, '#cb-panel')!;
    expect(panel.children[0].tagName).toBe('HEADER');
    expect(panel.children[1].classList.contains('cb-voicebar')).toBe(true);
    const sw = q<HTMLButtonElement>(shadow, '.cb-ar-switch')!;
    expect(sw.getAttribute('role')).toBe('switch');
    expect(sw.getAttribute('aria-checked')).toBe('false');
    expect(sw.textContent).toContain('답변 소리로 듣기');
    expect(q(shadow, '.cb-ar-state')!.textContent).toBe('꺼짐');
    expect(sw.getAttribute('aria-describedby')).toContain('cb-ar-help');
    expect(q(shadow, '#cb-ar-help')!.textContent).toBe(M.autoReadHelp);
    expect(window.sessionStorage.getItem(`cb.vo.ar.${SLUG}`)).toBeNull();
  });

  it('autoReadToggle=false면 토글 행이 없다(읽기 가능하면 이유 줄도 숨김)', async () => {
    installEnv();
    const { shadow } = boot({ voice: { ...voice, autoReadToggle: false } });
    await openPanel(shadow);
    expect(q(shadow, '.cb-ar-switch')).toBeNull();
    expect(q<HTMLElement>(shadow, '.cb-voicebar')!.hidden).toBe(true);
  });

  it('autoReadToggle=false면 세션에 켜짐이 남아 있어도 자동으로 읽지 않는다(L-1)', async () => {
    const env = installEnv();
    window.sessionStorage.setItem(`cb.vo.ar.${SLUG}`, '1');
    const { shadow } = boot({ voice: { ...voice, autoReadToggle: false }, messageResponse: () => ({ speech: SPEECH }) });
    await openPanel(shadow);
    await sendText(shadow, '질문', 2);
    expect(env.synth.spoken).toHaveLength(0);
  });

  it('켜기 = 사용자 조작 · 세션 기억 · 무음 발화 1회(소리 없음) · 소리는 새 speech 응답에서만', async () => {
    const env = installEnv();
    const { shadow } = boot({ voice, messageResponse: () => ({ speech: SPEECH }) });
    await openPanel(shadow);
    const sw = q<HTMLButtonElement>(shadow, '.cb-ar-switch')!;
    sw.click();
    expect(sw.getAttribute('aria-checked')).toBe('true');
    expect(q(shadow, '.cb-ar-state')!.textContent).toBe('켜짐');
    expect(window.sessionStorage.getItem(`cb.vo.ar.${SLUG}`)).toBe('1');
    expect(env.synth.spoken).toHaveLength(1);
    expect(env.synth.spoken[0].volume).toBe(0);
    await sendText(shadow, '질문', 2);
    await vi.waitFor(() => expect(env.synth.spoken.length).toBeGreaterThan(1));
    expect(env.synth.spoken[1].text).toBe('첫 문장입니다.');
  });

  it('새 탭(저장값 없음)은 꺼짐 · 저장값이 있으면 켜짐으로 복원', async () => {
    installEnv();
    window.sessionStorage.setItem(`cb.vo.ar.${SLUG}`, '1');
    const { shadow } = boot({ voice });
    await openPanel(shadow);
    expect(q(shadow, '.cb-ar-switch')!.getAttribute('aria-checked')).toBe('true');
  });

  it('읽는 중 새 speech 응답이 오면 취소하고 최신 답을 읽는다(대기열 없음)', async () => {
    const env = installEnv();
    const { shadow } = boot({
      voice,
      messageResponse: (n) => ({ speech: { text: n === 1 ? '오래된 답입니다.' : '최신 답입니다.', tone: 'CALM' } }),
    });
    await openPanel(shadow);
    q<HTMLButtonElement>(shadow, '.cb-ar-switch')!.click();
    await sendText(shadow, '하나', 2);
    await vi.waitFor(() => expect(env.synth.spoken.some((u) => u.text === '오래된 답입니다.')).toBe(true));
    env.synth.cancel.mockClear();
    await sendText(shadow, '둘', 3);
    await vi.waitFor(() => expect(env.synth.spoken.some((u) => u.text === '최신 답입니다.')).toBe(true));
    expect(env.synth.cancel).toHaveBeenCalled();
    const buttons = Array.from(shadow.querySelectorAll<HTMLButtonElement>('.cb-listen'));
    expect(buttons[0].textContent).toBe('듣기');
    expect(buttons[1].textContent).toBe('멈추기');
  });

  it('speech 없는 응답(시스템 안내 등)은 읽지 않고 진행 중인 읽기도 끊지 않는다(speak·cancel 0)', async () => {
    const env = installEnv();
    const { shadow } = boot({ voice, messageResponse: (n) => (n === 1 ? { speech: SPEECH } : {}) });
    await openPanel(shadow);
    q<HTMLButtonElement>(shadow, '.cb-ar-switch')!.click();
    await sendText(shadow, '하나', 2);
    await vi.waitFor(() => expect(env.synth.spoken.length).toBeGreaterThan(1));
    const speakCalls = env.synth.speak.mock.calls.length;
    env.synth.cancel.mockClear();
    await sendText(shadow, '둘', 3);
    expect(env.synth.speak.mock.calls.length).toBe(speakCalls);
    expect(env.synth.cancel).not.toHaveBeenCalled();
    expect(q<HTMLButtonElement>(shadow, '.cb-listen')!.textContent).toBe('멈추기'); // 앞 답은 계속 읽는 중
  });

  it('탭이 숨겨진 동안 온 답은 읽지 않는다 · 탭이 숨겨지면 읽기를 멈춘다', async () => {
    const env = installEnv();
    const { shadow } = boot({ voice, messageResponse: () => ({ speech: SPEECH }) });
    await openPanel(shadow);
    q<HTMLButtonElement>(shadow, '.cb-ar-switch')!.click();
    await sendText(shadow, '하나', 2);
    await vi.waitFor(() => expect(env.synth.spoken.length).toBeGreaterThan(1));
    env.synth.cancel.mockClear();
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(env.synth.cancel).toHaveBeenCalled();
    const speakCalls = env.synth.speak.mock.calls.length;
    await sendText(shadow, '둘', 3);
    expect(env.synth.speak.mock.calls.length).toBe(speakCalls); // 숨겨진 동안 온 답은 읽지 않는다
    expect(shadow.querySelectorAll('.cb-listen')).toHaveLength(2); // 대신 듣기 버튼으로 들을 수 있다
  });

  it('창이 닫힌 동안 도착한 답은 읽지 않는다(닫은 뒤 갑자기 소리 나지 않음)', async () => {
    const env = installEnv();
    let release: (() => void) | undefined;
    const gate = new Promise<void>((r) => (release = r));
    const { shadow, fetchMock } = boot({ voice, messageResponse: () => ({ speech: SPEECH }) });
    const original = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('/messages')) await gate;
      return original(input, init);
    });
    await openPanel(shadow);
    q<HTMLButtonElement>(shadow, '.cb-ar-switch')!.click();
    q<HTMLTextAreaElement>(shadow, '#cb-input')!.value = '질문';
    q<HTMLFormElement>(shadow, '#cb-composer')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    q<HTMLButtonElement>(shadow, '#cb-close')!.click(); // 응답 도착 전에 창을 닫는다
    const before = env.synth.speak.mock.calls.length;
    release?.();
    await vi.waitFor(() => expect(shadow.querySelectorAll('.cb-listen')).toHaveLength(1));
    expect(env.synth.speak.mock.calls.length).toBe(before);
  });
});

describe('말하기(VO-W1)', () => {
  const voice = { input: true, tts: false, autoReadToggle: false, rate: 1 };

  it('input=true ∧ 보안 컨텍스트 ∧ getUserMedia ∧ MediaRecorder면 입력창 옆에 말하기 버튼과 상태 줄 영역이 생긴다', async () => {
    installEnv();
    const { shadow } = boot({ voice });
    await openPanel(shadow);
    const mic = q<HTMLButtonElement>(shadow, '#cb-mic')!;
    expect(mic.textContent).toBe('말하기');
    expect(mic.getAttribute('aria-describedby')).toBe('cb-mic-hint');
    expect(q(shadow, '#cb-mic-hint')!.textContent).toBe(M.micHint);
    // 탭 순서: 입력창 → 말하기 → 전송, 상태 줄(취소)은 폼 맨 위
    const form = q<HTMLElement>(shadow, '#cb-composer')!;
    const order = Array.from(form.querySelectorAll('textarea, button')).map((e) => e.id || e.className);
    expect(order).toEqual(['cb-voice-cancel', 'cb-input', 'cb-mic', 'cb-send']);
    expect(q(shadow, '.cb-voicebar')).toBeNull(); // tts=false — 토글 행 없음
  });

  it.each([
    ['보안 컨텍스트가 아님', () => Object.defineProperty(window, 'isSecureContext', { value: false, configurable: true })],
    ['MediaRecorder 미지원', () => vi.stubGlobal('MediaRecorder', undefined)],
    ['getUserMedia 없음', () => Object.defineProperty(navigator, 'mediaDevices', { value: {}, configurable: true })],
  ])('%s → 버튼을 만들지 않는다(눌러서 실패하게 두지 않음)', async (_name, breakIt) => {
    const env = installEnv();
    breakIt();
    const { shadow } = boot({ voice });
    await openPanel(shadow);
    expect(q(shadow, '.cb-mic')).toBeNull();
    expect(env.getUserMedia).not.toHaveBeenCalled();
  });

  it('말하기 → 끝내기 → 인식 글자가 입력창 기존 글자 뒤에 공백으로 이어 붙고 자동 전송은 없다', async () => {
    const env = installEnv();
    const { shadow, fetchMock, transcriptionCalls } = boot({ voice });
    await openPanel(shadow);
    const input = q<HTMLTextAreaElement>(shadow, '#cb-input')!;
    input.value = '안녕하세요';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const mic = q<HTMLButtonElement>(shadow, '#cb-mic')!;
    mic.focus();
    mic.click();
    await vi.waitFor(() => expect(mic.textContent).toBe('말하기 끝내기'));
    expect(shadow.activeElement).toBe(mic); // 포커스는 말하기 버튼에 그대로
    expect(q(shadow, '.cb-voice-text')!.textContent).toBe(M.recording(30));
    expect(q<HTMLElement>(shadow, '.cb-voice-cancel')!.hidden).toBe(false);
    expect(mic.classList.contains('cb-mic--rec')).toBe(true);
    expect(q(shadow, '#cb-status')!.textContent).toBe(M.recordingAnnounce);
    expect(FakeRecorder.instances[0].opts).toMatchObject({ mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 32000 });

    mic.click(); // 말하기 끝내기
    expect(env.track.stop).toHaveBeenCalled();
    await vi.waitFor(() => expect(input.value).toBe('안녕하세요 카드 분실 신고'));
    expect(shadow.activeElement).toBe(input);
    expect(q(shadow, '.cb-voice-text')!.textContent).toBe(M.done);
    expect(q(shadow, '#cb-status')!.textContent).toBe(M.done);

    // 요청 계약: 본문 = 녹음 바이트(JSON 아님) · 세션 헤더 · credentials omit
    expect(transcriptionCalls).toHaveLength(1);
    const init = transcriptionCalls[0].init;
    expect(init.method).toBe('POST');
    expect(init.body).toBeInstanceOf(Blob);
    expect(init.credentials).toBe('omit');
    const headers = init.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('audio/webm;codecs=opus');
    expect(headers['x-cb-session-id']).toMatch(/^[0-9a-f-]{36}$/);
    // 자동 전송 0 — /messages 호출 없음
    expect(fetchMock.mock.calls.some(([u]) => String(u).endsWith('/messages'))).toBe(false);
  });

  it('녹음 중 Esc는 음성만 취소하고 패널을 닫지 않는다(F-1) · 취소 직후 1회 낭독 · 포커스는 말하기', async () => {
    const env = installEnv();
    const { shadow, transcriptionCalls } = boot({ voice });
    await openPanel(shadow);
    const mic = q<HTMLButtonElement>(shadow, '#cb-mic')!;
    mic.click();
    await vi.waitFor(() => expect(mic.textContent).toBe('말하기 끝내기'));
    q<HTMLElement>(shadow, '#cb-panel')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(q<HTMLElement>(shadow, '#cb-panel')!.hidden).toBe(false); // 닫히지 않음
    expect(env.track.stop).toHaveBeenCalled();
    expect(mic.textContent).toBe('말하기');
    expect(q(shadow, '#cb-status')!.textContent).toBe(M.recCanceled);
    expect(shadow.activeElement).toBe(mic);
    expect(transcriptionCalls).toHaveLength(0);
    // 그 밖의 상태(IDLE)의 Esc는 지금처럼 패널을 닫는다
    q<HTMLElement>(shadow, '#cb-panel')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(q<HTMLElement>(shadow, '#cb-panel')!.hidden).toBe(true);
  });

  it('상태 줄 취소 버튼(터치용)은 Esc와 같다', async () => {
    const env = installEnv();
    const { shadow } = boot({ voice });
    await openPanel(shadow);
    const mic = q<HTMLButtonElement>(shadow, '#cb-mic')!;
    mic.click();
    await vi.waitFor(() => expect(mic.textContent).toBe('말하기 끝내기'));
    q<HTMLButtonElement>(shadow, '.cb-voice-cancel')!.click();
    expect(env.track.stop).toHaveBeenCalled();
    expect(shadow.activeElement).toBe(mic);
    expect(q<HTMLElement>(shadow, '.cb-voice-cancel')!.hidden).toBe(true);
  });

  it('창을 닫으면 녹음을 조용히 취소한다(마이크 닫힘 · 요청 0 · 안내 없음)', async () => {
    const env = installEnv();
    const { shadow, transcriptionCalls } = boot({ voice });
    await openPanel(shadow);
    const mic = q<HTMLButtonElement>(shadow, '#cb-mic')!;
    mic.click();
    await vi.waitFor(() => expect(mic.textContent).toBe('말하기 끝내기'));
    q<HTMLButtonElement>(shadow, '#cb-close')!.click();
    expect(env.track.stop).toHaveBeenCalled();
    expect(transcriptionCalls).toHaveLength(0);
    expect(q(shadow, '.cb-voice-text')!.textContent).toBe('');
  });

  it('503 SPEECH_UNAVAILABLE → 마이크 유지(재시도 가능) + 포커스는 마이크 + 안내 문구 유지(M-3)', async () => {
    installEnv();
    const { shadow } = boot({ voice, transcription: () => jsonResponse({ statusCode: 503, code: 'SPEECH_UNAVAILABLE', message: 'x' }, 503) });
    await openPanel(shadow);
    const mic = q<HTMLButtonElement>(shadow, '#cb-mic')!;
    mic.focus();
    mic.click();
    await vi.waitFor(() => expect(mic.textContent).toBe('말하기 끝내기'));
    mic.click();
    await vi.waitFor(() => expect(q(shadow, '.cb-voice-text')!.textContent).toBe(M.unavailable));
    expect(q(shadow, '#cb-mic')).not.toBeNull();
    expect(shadow.activeElement).toBe(q(shadow, '#cb-mic'));
    expect(q(shadow, '#cb-status')!.textContent).toBe(M.unavailable);
  });

  it.each([
    [503, 'SPEECH_BUSY', M.busy],
    [400, 'SPEECH_AUDIO_INVALID', M.invalid],
    [413, 'SPEECH_AUDIO_TOO_LARGE', M.tooLarge],
    [502, 'SPEECH_FAILED', M.failed],
    [429, 'RATE_LIMITED', M.rateLimited],
    [400, 'VALIDATION_FAILED', M.sessionBad],
  ])('%i %s → 상태 줄에 원인+행동 문구, 버튼은 "다시 말하기"', async (status, code, text) => {
    installEnv();
    const { shadow } = boot({ voice, transcription: () => jsonResponse({ statusCode: status, code, message: 'x' }, status) });
    await openPanel(shadow);
    const mic = q<HTMLButtonElement>(shadow, '#cb-mic')!;
    mic.click();
    await vi.waitFor(() => expect(mic.textContent).toBe('말하기 끝내기'));
    mic.click();
    await vi.waitFor(() => expect(mic.textContent).toBe('다시 말하기'));
    expect(q(shadow, '.cb-voice-text')!.textContent).toBe(text);
    expect(shadow.activeElement).toBe(mic);
  });

  it('403은 이 사이트에서 쓸 수 없음 — 마이크 제거', async () => {
    installEnv();
    const { shadow } = boot({ voice, transcription: () => jsonResponse({ code: 'ORIGIN_NOT_ALLOWED' }, 403) });
    await openPanel(shadow);
    const mic = q<HTMLButtonElement>(shadow, '#cb-mic')!;
    mic.click();
    await vi.waitFor(() => expect(mic.textContent).toBe('말하기 끝내기'));
    mic.click();
    await vi.waitFor(() => expect(q(shadow, '#cb-mic')).toBeNull());
    expect(q(shadow, '.cb-voice-text')!.textContent).toBe(M.siteBlocked);
  });

  it('empty 응답은 입력창을 그대로 두고 "말소리가 들리지 않았어요"', async () => {
    installEnv();
    const { shadow } = boot({ voice, transcription: () => jsonResponse({ text: '', durationMs: 900, empty: true }) });
    await openPanel(shadow);
    const input = q<HTMLTextAreaElement>(shadow, '#cb-input')!;
    input.value = '기존';
    const mic = q<HTMLButtonElement>(shadow, '#cb-mic')!;
    mic.click();
    await vi.waitFor(() => expect(mic.textContent).toBe('말하기 끝내기'));
    mic.click();
    await vi.waitFor(() => expect(mic.textContent).toBe('다시 말하기'));
    expect(input.value).toBe('기존');
    expect(q(shadow, '.cb-voice-text')!.textContent).toBe(M.empty);
  });

  it('권한 거부는 BLOCKED — aria-disabled + 이유 상시 · 재요청 0', async () => {
    const env = installEnv();
    env.getUserMedia.mockRejectedValue(Object.assign(new Error('d'), { name: 'NotAllowedError' }));
    const { shadow } = boot({ voice });
    await openPanel(shadow);
    const mic = q<HTMLButtonElement>(shadow, '#cb-mic')!;
    mic.click();
    await vi.waitFor(() => expect(q(shadow, '.cb-voice-text')!.textContent).toBe(M.permDenied));
    expect(mic.getAttribute('aria-disabled')).toBe('true');
    mic.click();
    expect(env.getUserMedia).toHaveBeenCalledTimes(1);
  });

  it('녹음 중에는 듣기 버튼이 aria-disabled + "녹음 중에는 답변을 들을 수 없어요" 이유 · 시작 시 진행 중 읽기가 멈춘다', async () => {
    const env = installEnv();
    const { shadow } = boot({ voice: { input: true, tts: true, autoReadToggle: true, rate: 1 }, messageResponse: () => ({ speech: SPEECH }) });
    await openPanel(shadow);
    await sendText(shadow, '질문', 2);
    const listen = q<HTMLButtonElement>(shadow, '.cb-listen')!;
    listen.click();
    expect(listen.textContent).toBe('멈추기');
    q<HTMLButtonElement>(shadow, '#cb-mic')!.click();
    await vi.waitFor(() => expect(q<HTMLButtonElement>(shadow, '#cb-mic')!.textContent).toBe('말하기 끝내기'));
    expect(listen.textContent).toBe('듣기'); // 녹음 시작 = 읽기 정지(FR-VO1-11)
    expect(env.synth.cancel).toHaveBeenCalled();
    expect(listen.getAttribute('aria-disabled')).toBe('true');
    expect(q(shadow, '#cb-voice-reason')!.textContent).toBe(M.listenWhileRecording);
    const speakCalls = env.synth.speak.mock.calls.length;
    listen.click();
    expect(env.synth.speak.mock.calls.length).toBe(speakCalls);
  });

  it('인식 글자가 1,000자를 넘으면 기존 규칙대로 남은 글자가 0이 되고 전송이 aria-disabled(추가 UI 0)', async () => {
    installEnv();
    const { shadow } = boot({ voice, transcription: () => jsonResponse({ text: '가'.repeat(1100), durationMs: 5000 }) });
    await openPanel(shadow);
    const mic = q<HTMLButtonElement>(shadow, '#cb-mic')!;
    mic.click();
    await vi.waitFor(() => expect(mic.textContent).toBe('말하기 끝내기'));
    mic.click();
    await vi.waitFor(() => expect(q<HTMLTextAreaElement>(shadow, '#cb-input')!.value.length).toBe(1100));
    expect(q(shadow, '#cb-send')!.getAttribute('aria-disabled')).toBe('true');
  });
});
