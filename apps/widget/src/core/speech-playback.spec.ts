import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSpeechPlayback, type SynthLike, type UtteranceLike } from './speech-playback';

/** 가짜 `speechSynthesis` — 발화 큐·`cancel()`·`voiceschanged`를 직접 제어한다. */
function makeSynth(initialVoices: Array<Record<string, unknown>>) {
  let voices = initialVoices;
  let changed: (() => void) | undefined;
  const spoken: UtteranceLike[] = [];
  const synth = {
    getVoices: vi.fn(() => voices),
    speak: vi.fn((u: UtteranceLike) => void spoken.push(u)),
    cancel: vi.fn(),
    addEventListener: vi.fn((_t: 'voiceschanged', cb: () => void) => {
      changed = cb;
    }),
  };
  return {
    synth: synth as unknown as SynthLike & typeof synth,
    spoken,
    setVoices(v: Array<Record<string, unknown>>) {
      voices = v;
      changed?.();
    },
  };
}

const KO_LOCAL = { lang: 'ko-KR', localService: true, default: false };
const KO_ONLINE = { lang: 'ko-KR', localService: false, default: true };
const EN_LOCAL = { lang: 'en-US', localService: true, default: true };

function make(synthParts: ReturnType<typeof makeSynth>, rate = 1) {
  const onChange = vi.fn();
  const onError = vi.fn();
  const playback = createSpeechPlayback(
    {
      synth: synthParts.synth,
      createUtterance: (text) => ({ text, lang: '', rate: 1, pitch: 1, volume: 1, onend: null, onerror: null }) as unknown as UtteranceLike,
    },
    rate,
    { onChange, onError },
  );
  return { playback, onChange, onError };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('음성 판별(기기 안 한국어 음성만 — FR-VO6-8)', () => {
  it('기기 안 ko 음성이 있으면 즉시 available', () => {
    const s = makeSynth([EN_LOCAL, KO_LOCAL]);
    const { playback } = make(s);
    expect(playback.availability()).toBe('checking');
    playback.start();
    expect(playback.availability()).toBe('available');
  });

  it('온라인 ko 음성뿐이면 2초 대기 뒤 unavailable(온라인 음성은 쓰지 않는다)', () => {
    const s = makeSynth([KO_ONLINE, EN_LOCAL]);
    const { playback, onChange } = make(s);
    playback.start();
    expect(playback.availability()).toBe('checking');
    vi.advanceTimersByTime(1999);
    expect(playback.availability()).toBe('checking');
    vi.advanceTimersByTime(1);
    expect(playback.availability()).toBe('unavailable');
    expect(onChange).toHaveBeenCalled();
    expect(playback.speak('a', { text: '안녕하세요.', tone: 'CALM' })).toBe(false);
    expect(s.synth.speak).not.toHaveBeenCalled();
  });

  it('speechSynthesis가 없으면 즉시 unavailable', () => {
    const playback = createSpeechPlayback({ synth: undefined, createUtterance: () => ({}) as UtteranceLike }, 1, { onChange: vi.fn(), onError: vi.fn() });
    playback.start();
    expect(playback.availability()).toBe('unavailable');
  });

  it('2초 뒤 불가로 판정한 뒤에도 voiceschanged로 음성이 생기면 활성화만 한다(EX-VO-14)', () => {
    const s = makeSynth([]);
    const { playback } = make(s);
    playback.start();
    vi.advanceTimersByTime(2000);
    expect(playback.availability()).toBe('unavailable');
    s.setVoices([KO_LOCAL]);
    expect(playback.availability()).toBe('available');
  });

  it('확인 중(≤2초) voiceschanged가 먼저 오면 타이머 없이 available', () => {
    const s = makeSynth([]);
    const { playback } = make(s);
    playback.start();
    s.setVoices([KO_LOCAL]);
    expect(playback.availability()).toBe('available');
    vi.advanceTimersByTime(5000);
    expect(playback.availability()).toBe('available');
  });
});

describe('재생(문장 분할 · 말투 · 한 번에 한 답)', () => {
  it('speak은 cancel 후 문장 조각마다 발화하고 말투·속도 배율·음성을 반영한다', () => {
    const s = makeSynth([KO_LOCAL]);
    const { playback } = make(s, 1.2);
    playback.start();
    expect(playback.speak('m1', { text: '첫 문장입니다. 둘째 문장입니다?', tone: 'BRIGHT' })).toBe(true);
    expect(s.synth.cancel).toHaveBeenCalledTimes(1);
    expect(s.spoken).toHaveLength(2);
    // BRIGHT {1.05, 1.1, 1.0} × 배율 1.2 → rate 1.26(안전 구간 1.3 이내)
    expect(s.spoken[0].rate).toBeCloseTo(1.26, 5);
    expect(s.spoken[0].pitch).toBeCloseTo(1.1, 5);
    expect(s.spoken[0].volume).toBe(1);
    expect(s.spoken[0].lang).toBe('ko-KR');
    expect(s.spoken[0].voice).toBe(KO_LOCAL);
    expect(playback.playingKey()).toBe('m1');
  });

  it('마지막 조각이 끝나면 playingKey가 비워진다', () => {
    const s = makeSynth([KO_LOCAL]);
    const { playback } = make(s);
    playback.start();
    playback.speak('m1', { text: '하나. 둘.', tone: 'CALM' });
    s.spoken[0].onend?.();
    expect(playback.playingKey()).toBe('m1');
    s.spoken[1].onend?.();
    expect(playback.playingKey()).toBeNull();
  });

  it('새 답을 읽으면 이전 답을 취소하고 이전 발화의 늦은 이벤트를 무시한다(대기열 없음)', () => {
    const s = makeSynth([KO_LOCAL]);
    const { playback, onError } = make(s);
    playback.start();
    playback.speak('old', { text: '오래된 답입니다.', tone: 'CALM' });
    const oldUtterance = s.spoken[0];
    playback.speak('new', { text: '최신 답입니다.', tone: 'CALM' });
    expect(playback.playingKey()).toBe('new');
    oldUtterance.onerror?.({ error: 'interrupted' });
    oldUtterance.onend?.();
    expect(playback.playingKey()).toBe('new');
    expect(onError).not.toHaveBeenCalled();
  });

  it('cancel은 재생 중일 때만 synth.cancel을 부른다', () => {
    const s = makeSynth([KO_LOCAL]);
    const { playback } = make(s);
    playback.start();
    playback.cancel();
    expect(s.synth.cancel).not.toHaveBeenCalled();
    playback.speak('m1', { text: '안녕하세요.', tone: 'CALM' });
    s.synth.cancel.mockClear();
    playback.cancel();
    expect(s.synth.cancel).toHaveBeenCalledTimes(1);
    expect(playback.playingKey()).toBeNull();
  });

  it('error 이벤트는 1회만 알리고 재시도하지 않는다(AC-VO3-12)', () => {
    const s = makeSynth([KO_LOCAL]);
    const { playback, onError } = make(s);
    playback.start();
    playback.speak('m1', { text: '하나. 둘. 셋.', tone: 'CALM' });
    const before = s.synth.speak.mock.calls.length;
    s.spoken[0].onerror?.({ error: 'synthesis-failed' });
    s.spoken[1].onerror?.({ error: 'synthesis-failed' }); // 취소 이후 도착 — 무시
    expect(onError).toHaveBeenCalledTimes(1);
    expect(playback.playingKey()).toBeNull();
    expect(s.synth.speak.mock.calls.length).toBe(before);
  });

  it('unlock은 볼륨 0 무음 발화 1회뿐이고 재생 상태를 만들지 않는다(EX-VO-22)', () => {
    const s = makeSynth([KO_LOCAL]);
    const { playback } = make(s);
    playback.start();
    playback.unlock();
    expect(s.spoken).toHaveLength(1);
    expect(s.spoken[0].volume).toBe(0);
    expect(playback.playingKey()).toBeNull();
  });
});
