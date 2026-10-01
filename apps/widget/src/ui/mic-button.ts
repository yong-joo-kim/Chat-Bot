import type { CaptureView } from '../core/speech-capture';
import { SPEECH_MESSAGES as M } from '../constants/speech';
import { el } from './dom';

export interface MicBinding {
  /** 말하기 버튼 — 시작/끝내기(상태기계가 판단). */
  onToggle(): void;
  /** 상태 줄 "취소" 버튼(터치 기기에는 Esc가 없다). */
  onCancel(): void;
}

export interface MicButtonController {
  /** 폼 맨 위에 놓는 상태 줄 영역(항상 DOM에 있고, 안내가 있을 때만 줄이 보인다). */
  strip: HTMLElement;
  button: HTMLButtonElement;
  render(view: CaptureView): void;
  focus(): void;
}

/**
 * VO-W1 말하기 버튼 + 상태 줄(voice-ai-ui-spec §4.2). 텍스트 우선(아이콘 0) — 녹음 중은 `●`(aria-hidden) + 글자 +
 * 버튼 형태 변화(`cb-mic--rec`)로 알린다. 상태 줄 글자는 라이브 영역이 아니다(낭독은 `#cb-status` 1회 안내만).
 * 상태가 바뀌어도 같은 노드의 텍스트·속성만 바꾼다.
 */
export function createMicButton(binding: MicBinding): MicButtonController {
  const dot = el('span', '', '● ', { 'aria-hidden': 'true' });
  const text = el('span', 'cb-voice-text');
  const cancel = el('button', 'cb-voice-cancel', M.cancelLabel, { type: 'button' });
  const line = el('div', 'cb-voice-line');
  line.append(dot, text, cancel);
  const strip = el('div', 'cb-voice');
  strip.append(line, el('span', 'cb-sr-only', M.micHint, { id: 'cb-mic-hint' }));
  const button = el('button', 'cb-mic', M.micLabel, { type: 'button', id: 'cb-mic', 'aria-describedby': 'cb-mic-hint' });

  cancel.addEventListener('click', () => binding.onCancel());
  button.addEventListener('click', () => {
    // REQUESTING·UPLOADING·BLOCKED 동안은 `aria-disabled` — 눌러도 아무 일도 없다(연타 방지).
    if (button.getAttribute('aria-disabled') !== 'true') binding.onToggle();
  });

  function render({ state, notice }: CaptureView): void {
    if (state === 'REMOVED') button.remove();
    button.textContent =
      state === 'FAILED'
        ? M.micLabelRetry
        : state === 'REQUESTING'
          ? M.micLabelPreparing
          : state === 'RECORDING'
            ? M.micLabelStop
            : state === 'UPLOADING'
              ? M.micLabelBusy
              : M.micLabel;
    button.setAttribute('aria-disabled', String(state === 'REQUESTING' || state === 'UPLOADING' || state === 'BLOCKED'));
    button.classList.toggle('cb-mic--rec', state === 'RECORDING');
    dot.hidden = state !== 'RECORDING';
    cancel.hidden = state !== 'RECORDING' && state !== 'UPLOADING';
    text.textContent = notice;
    line.hidden = notice === '';
  }

  render({ state: 'IDLE', remaining: 0, notice: '' });

  return { strip, button, render, focus: () => button.focus() };
}
