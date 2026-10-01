import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { VoicePreviewPanel } from './VoicePreviewPanel';

/** 들어보기(VO-C6) — 가짜 `speechSynthesis`로 재생 인자·상태 전이·서버 호출 0을 검증한다. */
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

const KO_LOCAL = { lang: 'ko-KR', localService: true, default: true };
const KO_ONLINE = { lang: 'ko-KR', localService: false, default: false };

function installSynth(voices: unknown[]) {
  const spoken: FakeUtterance[] = [];
  const synth = {
    getVoices: vi.fn(() => voices),
    speak: vi.fn((u: FakeUtterance) => void spoken.push(u)),
    cancel: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true });
  vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance);
  return { synth, spoken };
}

let fetchSpy: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchSpy = vi.fn();
  vi.stubGlobal('fetch', fetchSpy);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete (window as unknown as Record<string, unknown>).speechSynthesis;
});

describe('기기 음성 확인', () => {
  it('기기 안 한국어 음성 개수만 센다(온라인 음성 제외) · 있으면 버튼 활성', () => {
    installSynth([KO_LOCAL, KO_LOCAL, KO_ONLINE, { lang: 'en-US', localService: true }]);
    render(<VoicePreviewPanel rateMultiplier={1} initialTone="CALM" />);
    expect(screen.getByTestId('voice-preview-count')).toHaveTextContent('이 브라우저에서 쓸 수 있는 기기 안 한국어 음성: 2개');
    expect(screen.getByRole('button', { name: '▶ 들어보기' })).not.toHaveAttribute('aria-disabled', 'true');
  });

  it('음성 목록이 비어 있으면 "확인 중"(최대 2초) → 없음 판정 후 aria-disabled + 이유(온라인 음성은 쓰지 않음)', () => {
    vi.useFakeTimers();
    installSynth([]);
    render(<VoicePreviewPanel rateMultiplier={1} initialTone="CALM" />);
    expect(screen.getByTestId('voice-preview-count')).toHaveTextContent('기기 음성을 확인하고 있습니다…');
    const button = screen.getByRole('button', { name: '▶ 들어보기' });
    expect(button).toHaveAttribute('aria-disabled', 'true');
    act(() => void vi.advanceTimersByTime(2000));
    expect(screen.getByTestId('voice-preview-count')).toHaveTextContent('이 브라우저에서 쓸 수 있는 기기 안 한국어 음성: 0개');
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button.getAttribute('aria-describedby')).toBe('voice-preview-reason');
    expect(screen.getByText(/온라인 음성\(글자를 외부로 보내는 음성\)은 쓰지 않습니다/)).toBeInTheDocument();
  });

  it('speechSynthesis가 없으면 즉시 사용 불가', () => {
    render(<VoicePreviewPanel rateMultiplier={1} initialTone="CALM" />);
    expect(screen.getByTestId('voice-preview-count')).toHaveTextContent('0개');
    expect(screen.getByRole('button', { name: '▶ 들어보기' })).toHaveAttribute('aria-disabled', 'true');
  });

  it('온라인 ko 음성뿐이면 불가로 본다(판별 불확실 = 쓰지 않음)', () => {
    vi.useFakeTimers();
    installSynth([KO_ONLINE]);
    render(<VoicePreviewPanel rateMultiplier={1} initialTone="CALM" />);
    act(() => void vi.advanceTimersByTime(2000));
    expect(screen.getByTestId('voice-preview-count')).toHaveTextContent('0개');
  });
});

describe('재생', () => {
  it('고른 말투·폼의 읽기 속도로 문장 단위 재생 · 눌러야만 소리가 난다(자동 재생 0)', async () => {
    const { synth, spoken } = installSynth([KO_LOCAL]);
    render(<VoicePreviewPanel rateMultiplier={1.1} initialTone="APOLOGETIC" />);
    expect(synth.speak).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText(/들어볼 문장/), { target: { value: '첫째입니다. 둘째입니다.' } });
    expect(synth.speak).not.toHaveBeenCalled(); // 입력만으로는 소리 없음
    await userEvent.click(screen.getByRole('button', { name: '▶ 들어보기' }));
    expect(spoken.map((u) => u.text)).toEqual(['첫째입니다.', '둘째입니다.']);
    // APOLOGETIC {0.9, 0.9, 0.9} × 배율 1.1
    expect(spoken[0].rate).toBeCloseTo(0.99, 5);
    expect(spoken[0].pitch).toBeCloseTo(0.9, 5);
    expect(spoken[0].volume).toBeCloseTo(0.9, 5);
    expect(spoken[0].lang).toBe('ko-KR');
    expect(spoken[0].voice).toBe(KO_LOCAL);
    expect(screen.getByRole('button', { name: '■ 멈추기' })).toBeInTheDocument();
  });

  it('멈추기 · 끝까지 재생되면 자동 복귀 · 말투를 바꾸면 재생이 멈추고 다시 눌러야 한다', async () => {
    const { synth, spoken } = installSynth([KO_LOCAL]);
    render(<VoicePreviewPanel rateMultiplier={1} initialTone="CALM" />);
    await userEvent.click(screen.getByRole('button', { name: '▶ 들어보기' }));
    await userEvent.click(screen.getByRole('button', { name: '■ 멈추기' }));
    expect(synth.cancel).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '▶ 들어보기' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: '▶ 들어보기' }));
    act(() => spoken[spoken.length - 1].onend?.());
    expect(screen.getByRole('button', { name: '▶ 들어보기' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: '▶ 들어보기' }));
    const calls = synth.speak.mock.calls.length;
    await userEvent.click(screen.getByRole('radio', { name: '밝게' }));
    expect(screen.getByRole('button', { name: '▶ 들어보기' })).toBeInTheDocument(); // 멈춤
    expect(synth.speak.mock.calls.length).toBe(calls); // 자동으로 다시 재생하지 않는다
  });

  it('빈 문장은 aria-disabled + 이유', async () => {
    installSynth([KO_LOCAL]);
    render(<VoicePreviewPanel rateMultiplier={1} initialTone="CALM" />);
    fireEvent.change(screen.getByLabelText(/들어볼 문장/), { target: { value: '   ' } });
    const button = screen.getByRole('button', { name: '▶ 들어보기' });
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByText('들어볼 문장을 입력하세요.')).toBeInTheDocument();
  });

  it('최대 200자 + 남은 글자 실시간', () => {
    installSynth([KO_LOCAL]);
    render(<VoicePreviewPanel rateMultiplier={1} initialTone="CALM" />);
    const input = screen.getByLabelText(/들어볼 문장/);
    expect(input).toHaveAttribute('maxlength', '200');
    fireEvent.change(input, { target: { value: '가'.repeat(13) } });
    expect(screen.getByText('남은 글자 187자')).toBeInTheDocument();
  });

  it('재생 오류는 인라인으로 1회 안내하고 자동 재시도하지 않는다', async () => {
    const { synth, spoken } = installSynth([KO_LOCAL]);
    render(<VoicePreviewPanel rateMultiplier={1} initialTone="CALM" />);
    await userEvent.click(screen.getByRole('button', { name: '▶ 들어보기' }));
    const calls = synth.speak.mock.calls.length;
    act(() => spoken[0].onerror?.({ error: 'synthesis-failed' }));
    expect(screen.getByRole('alert')).toHaveTextContent('재생하지 못했습니다. 다시 시도하세요.');
    expect(synth.speak.mock.calls.length).toBe(calls);
    expect(screen.getByRole('button', { name: '▶ 들어보기' })).toBeInTheDocument();
  });

  it('섹션을 접으면(언마운트) 재생을 멈춘다', async () => {
    const { synth } = installSynth([KO_LOCAL]);
    const { unmount } = render(<VoicePreviewPanel rateMultiplier={1} initialTone="CALM" />);
    await userEvent.click(screen.getByRole('button', { name: '▶ 들어보기' }));
    synth.cancel.mockClear();
    unmount();
    expect(synth.cancel).toHaveBeenCalled();
  });

  it('서버 호출 0 — fetch·XMLHttpRequest·sendBeacon·스토리지 기록이 전혀 없다', async () => {
    installSynth([KO_LOCAL]);
    const xhrOpen = vi.spyOn(XMLHttpRequest.prototype, 'open');
    const beacon = vi.fn();
    Object.defineProperty(navigator, 'sendBeacon', { value: beacon, configurable: true });
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    render(<VoicePreviewPanel rateMultiplier={1} initialTone="CALM" />);
    await userEvent.click(screen.getByRole('button', { name: '▶ 들어보기' }));
    await userEvent.click(screen.getByRole('button', { name: '■ 멈추기' }));
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(xhrOpen).not.toHaveBeenCalled();
    expect(beacon).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
    xhrOpen.mockRestore();
    setItem.mockRestore();
    delete (navigator as unknown as Record<string, unknown>).sendBeacon;
  });

  it('소스에 네트워크·스토리지 호출이 없다(정적 검사 — 위젯 VO-9와 같은 원칙)', () => {
    const src = readFileSync(join(__dirname, 'VoicePreviewPanel.tsx'), 'utf8')
      .split('\n')
      .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
      .join('\n');
    expect(src).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|sendBeacon|localStorage|sessionStorage|indexedDB|voiceApi|apiClient/);
  });
});
