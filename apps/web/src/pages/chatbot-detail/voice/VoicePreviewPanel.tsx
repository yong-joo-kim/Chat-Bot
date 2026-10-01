import { useEffect, useRef, useState } from 'react';
import { SPEECH_LIMITS } from '@chat-bot/shared-types';
import {
  SPEECH_TONES,
  computeUtteranceParams,
  isLocalKoreanVoice,
  selectLocalKoreanVoice,
  splitForSpeech,
  type SpeechTone,
} from '@chat-bot/shared-types/speech-voice';
import { MESSAGES } from '../../../constants/messages';

type Availability = 'checking' | 'ready' | 'none';

/** 재생 중 발화 참조 유지(모듈 스코프) — 일부 Chrome에서 GC로 onend가 유실되는 것을 막는다. 종료·오류·취소 시 해제. */
const liveUtterances = new Set<SpeechSynthesisUtterance>();

/**
 * 관리자 브라우저의 기기 안 한국어 음성 개수·가용성. `getVoices()`가 비어 있으면 `voiceschanged`를 최대
 * `SPEECH_LIMITS.voicesWaitMs`(2초) 기다린 뒤 "없음"으로 판정하고, 이후 생기면 다시 판정한다. `speechSynthesis`가
 * 없으면 즉시 "없음".
 */
function useDeviceVoices(): { availability: Availability; count: number } {
  const [state, setState] = useState<{ availability: Availability; count: number }>({ availability: 'checking', count: 0 });
  useEffect(() => {
    const synth = typeof window !== 'undefined' ? window.speechSynthesis : undefined;
    if (!synth || typeof synth.getVoices !== 'function') {
      setState({ availability: 'none', count: 0 });
      return;
    }
    const evaluate = (final: boolean): void => {
      const count = synth.getVoices().filter((v) => isLocalKoreanVoice(v)).length;
      if (count > 0) setState({ availability: 'ready', count });
      else if (final) setState({ availability: 'none', count: 0 });
    };
    evaluate(false);
    const onChanged = (): void => evaluate(false);
    synth.addEventListener?.('voiceschanged', onChanged);
    const timer = setTimeout(() => evaluate(true), SPEECH_LIMITS.voicesWaitMs);
    return () => {
      synth.removeEventListener?.('voiceschanged', onChanged);
      clearTimeout(timer);
      synth.cancel?.();
    };
  }, []);
  return state;
}

/**
 * VO-C6 들어보기 — 관리자가 입력한 문장을 고른 말투·읽기 속도로 **자기 브라우저의 기기 안 한국어 음성**으로 재생한다.
 * **서버 호출 0 · 감사 0 · 입력 문장 저장 0**(FR-VO5-3). 재생 인자는 위젯과 같은 공유 함수로 만든다. 조작 없이 소리가 나지 않는다
 * (자동 재생 0) — 말투를 바꾸면 재생을 멈추고 다시 누르게 한다. 섹션을 접거나 화면을 떠나면 멈춘다.
 * 이 파일은 `fetch`·`XMLHttpRequest`·`sendBeacon`·스토리지를 쓰지 않는다(정적 검사 대상).
 */
export function VoicePreviewPanel({ rateMultiplier, initialTone }: { rateMultiplier: number; initialTone: SpeechTone }): JSX.Element {
  const msg = MESSAGES.voice;
  const { availability, count } = useDeviceVoices();
  const [text, setText] = useState<string>(msg.previewTextDefault);
  const [tone, setTone] = useState<SpeechTone>(initialTone);
  const [playing, setPlaying] = useState(false);
  const [playError, setPlayError] = useState(false);
  const generation = useRef(0);

  function stop(): void {
    generation.current += 1;
    window.speechSynthesis?.cancel?.();
    liveUtterances.clear();
    setPlaying(false);
  }

  // 화면을 떠나거나 섹션이 접히면(언마운트) 멈춘다. `useDeviceVoices`의 정리와 별개로 재생 상태를 끊는다.
  useEffect(() => () => void (generation.current += 1), []);

  const trimmed = text.trim();
  const unavailable = availability === 'none';
  const blockedReason = availability === 'checking' ? msg.previewChecking : unavailable ? msg.previewNoVoice : trimmed === '' ? msg.previewEmpty : undefined;

  function play(): void {
    if (blockedReason) return;
    const synth = window.speechSynthesis;
    const voice = selectLocalKoreanVoice(synth.getVoices());
    if (!voice) return;
    setPlayError(false);
    const params = computeUtteranceParams(tone, rateMultiplier);
    const chunks = splitForSpeech(trimmed);
    generation.current += 1;
    const mine = generation.current;
    synth.cancel();
    setPlaying(true);
    chunks.forEach((chunk, i) => {
      const u = new SpeechSynthesisUtterance(chunk);
      u.voice = voice;
      u.lang = voice.lang;
      u.rate = params.rate;
      u.pitch = params.pitch;
      u.volume = params.volume;
      liveUtterances.add(u); // GC로 onend가 유실되지 않도록 참조 유지(L-2)
      u.onend = () => {
        liveUtterances.delete(u);
        if (mine === generation.current && i === chunks.length - 1) setPlaying(false);
      };
      u.onerror = (e) => {
        liveUtterances.delete(u);
        if (mine !== generation.current) return;
        if (e.error === 'canceled' || e.error === 'interrupted') return;
        generation.current += 1;
        synth.cancel();
        liveUtterances.clear();
        setPlaying(false);
        setPlayError(true);
      };
      synth.speak(u);
    });
  }

  const remaining = SPEECH_LIMITS.previewTextMax - text.length;
  return (
    <section className="voice-block" aria-labelledby="voice-preview-title">
      <h4 id="voice-preview-title">{msg.previewTitle}</h4>
      <p className="field-hint">
        <span aria-hidden="true">ⓘ</span> {msg.previewNotice1}
      </p>
      <p className="field-hint">
        <span aria-hidden="true">ⓘ</span> {msg.previewNotice2}
      </p>
      <p data-testid="voice-preview-count">{availability === 'checking' ? msg.previewChecking : msg.previewVoiceCount(count)}</p>

      <div className="form-field">
        <label htmlFor="voice-preview-text">
          {msg.previewTextLabel} <span className="required-mark" aria-hidden="true">*</span>
        </label>
        <input
          id="voice-preview-text"
          type="text"
          maxLength={SPEECH_LIMITS.previewTextMax}
          value={text}
          aria-describedby="voice-preview-remaining"
          onChange={(e) => {
            setText(e.target.value);
          }}
        />
        <span id="voice-preview-remaining" className="field-hint">
          {msg.previewRemaining(Math.max(0, remaining))}
        </span>
      </div>

      <fieldset className="form-field voice-tone-group">
        <legend>{msg.previewToneLegend}</legend>
        {SPEECH_TONES.map((t) => (
          <label key={t} className="voice-radio-label">
            <input
              type="radio"
              name="voice-preview-tone"
              value={t}
              checked={tone === t}
              onChange={() => {
                // 말투를 바꾸면 재생 중인 소리는 즉시 멈추고 다시 누르게 한다(자동 재생 금지).
                if (playing) stop();
                setTone(t);
              }}
            />
            <span className="voice-radio-text">{msg.toneNames[t]}</span>
          </label>
        ))}
      </fieldset>
      <p className="field-hint">{msg.previewRateNote(rateMultiplier.toFixed(2))}</p>

      <button
        type="button"
        className="btn btn-secondary"
        aria-disabled={(!playing && Boolean(blockedReason)) || undefined}
        aria-describedby={!playing && blockedReason ? 'voice-preview-reason' : undefined}
        onClick={() => (playing ? stop() : play())}
      >
        {playing ? msg.previewStop : msg.previewPlay}
      </button>
      {!playing && blockedReason && (
        <p id="voice-preview-reason" className="field-hint">
          {blockedReason}
        </p>
      )}
      {playError && (
        <p className="field-error" role="alert">
          <span aria-hidden="true">⚠</span> {msg.previewError}
        </p>
      )}
    </section>
  );
}
