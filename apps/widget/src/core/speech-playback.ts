import { computeUtteranceParams, selectLocalKoreanVoice, splitForSpeech, type VoiceLike } from '@chat-bot/shared-types/speech-voice';
import { SPEECH_LIMITS } from '../constants/speech';

/**
 * [신규 No.32] 답변 읽기 제어(설계 §9.4) — DOM 무의존. `speechSynthesis`·`SpeechSynthesisUtterance`는 주입한다
 * (시험은 가짜). **사용자 기기 안(`localService===true`) 한국어 음성만** 쓴다(온라인 음성 제외 — FR-VO6-8).
 * 이 모듈은 `fetch`·`XMLHttpRequest`·`sendBeacon`을 쓰지 않는다(VO-9 · 글자가 기기 밖으로 나가지 않는다).
 * 교체 단위: 훗날 서버 합성을 도입하면 이 인터페이스(`speak`·`cancel`·`availability`)의 구현만 바꾼다(NFR-VOM4).
 */
export interface UtteranceLike {
  voice?: unknown;
  lang: string;
  rate: number;
  pitch: number;
  volume: number;
  onend: (() => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
}

export interface SynthLike {
  getVoices(): VoiceLike[];
  speak(u: UtteranceLike): void;
  cancel(): void;
  addEventListener?(type: 'voiceschanged', cb: () => void): void;
}

export interface PlaybackDeps {
  synth: SynthLike | undefined;
  createUtterance(text: string): UtteranceLike;
}

export type PlaybackAvailability = 'checking' | 'available' | 'unavailable';

export interface PlaybackHooks {
  /** 가용성·재생 상태가 바뀔 때(버튼·토글·이유 줄 갱신용). */
  onChange(): void;
  /** 읽기 `error` — 연속 재시도 없이 호출부가 1회만 안내한다(AC-VO3-12). */
  onError(): void;
}

export interface SpeechPlayback {
  /** 음성 판별 시작 — `config.voice.tts`일 때만 호출한다(`getVoices()` 최초 호출 지점). */
  start(): void;
  availability(): PlaybackAvailability;
  playingKey(): string | null;
  speak(key: string, speech: { text: string; tone: string }): boolean;
  cancel(): void;
  /** 토글을 켜는 클릭 처리기 안에서 호출 — 소리 없는 발화 1회로 재생 권한을 확보한다(EX-VO-22). */
  unlock(): void;
}

export function defaultPlaybackDeps(): PlaybackDeps {
  const synth = typeof window !== 'undefined' && 'speechSynthesis' in window ? (window.speechSynthesis as unknown as SynthLike) : undefined;
  return {
    synth,
    createUtterance: (text) => new SpeechSynthesisUtterance(text) as unknown as UtteranceLike,
  };
}

/** 재생 중 발화 참조 유지용(모듈 스코프) — 종료·오류·취소 시 해제한다. */
const live = new Set<UtteranceLike>();

export function createSpeechPlayback(deps: PlaybackDeps, rate: number, hooks: PlaybackHooks): SpeechPlayback {
  const { synth } = deps;
  let availability: PlaybackAvailability = 'checking';
  let current: string | null = null;
  // 취소·교체된 발화의 늦은 이벤트(`canceled`·`interrupted` 포함)를 걸러내는 세대 카운터.
  let gen = 0;
  let started = false;

  function setAvailability(next: PlaybackAvailability): void {
    if (next === availability) return;
    availability = next;
    hooks.onChange();
  }

  function pickVoice(): VoiceLike | null {
    return synth ? selectLocalKoreanVoice(synth.getVoices()) : null;
  }

  function stopNow(): void {
    gen += 1;
    synth?.cancel();
    live.clear();
    if (current !== null) {
      current = null;
      hooks.onChange();
    }
  }

  return {
    start() {
      if (!synth || typeof synth.getVoices !== 'function') {
        setAvailability('unavailable');
        return;
      }
      if (pickVoice()) {
        setAvailability('available');
        return;
      }
      if (started) return; // 중복 등록 방지(L-4) — 위젯에 teardown 경로가 없어 리스너·타이머는 페이지 수명 동안 1회만 유지
      started = true;
      // 판정 뒤에도 `voiceschanged`가 오면 활성화만 한다(EX-VO-14 — 비활성으로 되돌리지 않음).
      synth.addEventListener?.('voiceschanged', () => {
        if (pickVoice()) setAvailability('available');
      });
      setTimeout(() => {
        if (availability === 'checking') setAvailability('unavailable');
      }, SPEECH_LIMITS.voicesWaitMs);
    },
    availability: () => availability,
    playingKey: () => current,
    speak(key, speech) {
      if (availability !== 'available' || !synth) return false;
      const voice = pickVoice() as (VoiceLike & { lang?: string }) | null;
      if (!voice) return false;
      const chunks = splitForSpeech(speech.text);
      if (chunks.length === 0) return false;
      gen += 1;
      const mine = gen;
      synth.cancel();
      current = key;
      hooks.onChange();
      const p = computeUtteranceParams(speech.tone, rate);
      chunks.forEach((chunk, i) => {
        const u = deps.createUtterance(chunk);
        u.voice = voice;
        u.lang = typeof voice.lang === 'string' ? voice.lang : 'ko-KR';
        u.rate = p.rate;
        u.pitch = p.pitch;
        u.volume = p.volume;
        live.add(u); // 지역 변수만 두면 일부 Chrome에서 GC로 onend가 오지 않는다(L-2)
        u.onend = () => {
          live.delete(u);
          if (mine !== gen || i !== chunks.length - 1) return;
          current = null;
          hooks.onChange();
        };
        u.onerror = (e) => {
          live.delete(u);
          if (mine !== gen) return;
          if (e && (e.error === 'canceled' || e.error === 'interrupted')) return;
          stopNow();
          hooks.onError();
        };
        synth.speak(u);
      });
      return true;
    },
    cancel() {
      if (current === null) return;
      stopNow();
    },
    unlock() {
      if (availability !== 'available' || !synth) return;
      const u = deps.createUtterance(' ');
      u.volume = 0;
      synth.speak(u);
    },
  };
}
