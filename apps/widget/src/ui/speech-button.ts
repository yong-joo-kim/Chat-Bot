import { SPEECH_MESSAGES as M } from '../constants/speech';
import { el } from './dom';

export interface SpeechPayload {
  text: string;
  tone: string;
}

export interface ListenHubState {
  /** 지금 읽고 있는 응답 키(없으면 null). */
  playingKey: string | null;
  /** 기기 음성 없음·확인 중·녹음 중 — `aria-disabled`. */
  disabled: boolean;
  /** 공유 이유 줄 문구(`#cb-voice-reason`) — 비활성 이유가 있을 때만 비어 있지 않다. */
  reason: string;
}

/** 모든 듣기 버튼이 공유하는 허브(`app.ts`가 구현) — 한 번에 한 답만 읽는다(FR-VO3-7). */
export interface ListenHub {
  state(): ListenHubState;
  toggle(key: string, speech: SpeechPayload): void;
  subscribe(listener: () => void): void;
}

export interface SpeechBinding {
  /** 응답 키(서버 `messageId` 또는 보류 답변 id). */
  key: string;
  speech: SpeechPayload;
  hub: ListenHub;
}

/**
 * VO-W2 응답별 듣기 버튼(voice-ai-ui-spec §4.3). `듣기 ↔ 멈추기`는 **같은 노드의 텍스트·`aria-label`만** 바꾼다
 * (새 노드 0 — `#cb-messages`의 `aria-relevant="additions"` 재낭독 방지). `aria-pressed`는 쓰지 않고(이름이 상태를
 * 말한다) 재생 시작·끝은 라이브 영역으로 낭독하지 않는다. 읽기 불가는 숨기지 않고 `aria-disabled` + 이유 줄 연결.
 */
export function createSpeechButton(binding: SpeechBinding): HTMLButtonElement {
  const btn = el('button', 'cb-listen', undefined, { type: 'button' });

  function render(): void {
    const s = binding.hub.state();
    const playing = s.playingKey === binding.key;
    btn.textContent = playing ? M.stopLabel : M.listenLabel;
    btn.setAttribute('aria-label', playing ? M.stopAria : M.listenAria);
    const disabled = !playing && s.disabled;
    btn.setAttribute('aria-disabled', String(disabled));
    if (disabled && s.reason) btn.setAttribute('aria-describedby', 'cb-voice-reason');
    else btn.removeAttribute('aria-describedby');
  }

  btn.addEventListener('click', () => {
    if (btn.getAttribute('aria-disabled') === 'true') return;
    binding.hub.toggle(binding.key, binding.speech);
  });
  binding.hub.subscribe(render);
  render();
  return btn;
}
