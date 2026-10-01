import { SPEECH_MESSAGES as M } from '../constants/speech';
import { el } from './dom';

export interface VoiceBarOptions {
  /** `voice.autoReadToggle` — false면 토글 없이 이유 줄만 필요할 때 단독 표시한다. */
  showToggle: boolean;
  checked: boolean;
  /** 사용자 조작으로만 호출된다(NFR-VOA2 — 자동 재생은 사용자가 켠 경우에만). */
  onToggle(next: boolean): void;
}

export interface VoiceBarController {
  /** 패널 헤더 바로 아래 행. */
  root: HTMLElement;
  setDisabled(disabled: boolean): void;
  /** 공유 이유 줄(`#cb-voice-reason` — 정적 안내, 라이브 영역 아님). 빈 문자열이면 비운다. */
  setReason(text: string): void;
}

/**
 * VO-W3 "답변 소리로 듣기" 토글 + 읽기 불가 이유 줄(voice-ai-ui-spec §4.4). 켜짐/꺼짐 글자를 항상 표시하고(색·위치만으로
 * 구분 금지) 44×44px 이상. 읽기 불가면 `aria-disabled` + 이유 연결 — 저장된 켜짐 값은 화면에서도 꺼짐으로 보이며 적용하지 않는다.
 */
export function createVoiceBar(opts: VoiceBarOptions): VoiceBarController {
  const root = el('div', 'cb-voicebar');
  const reasonEl = el('p', 'cb-ar-reason', '', { id: 'cb-voice-reason' });
  const sw = opts.showToggle ? el('button', 'cb-ar-switch', undefined, { type: 'button', role: 'switch' }) : null;
  // 상태 글자는 role=switch의 aria-checked가 알리므로 읽기에서 뺀다(이름 중복 방지).
  const stateEl = el('span', 'cb-ar-state', undefined, { 'aria-hidden': 'true' });
  let checked = opts.checked;
  let disabled = false;
  let reason = '';

  function render(): void {
    const on = checked && !disabled;
    if (sw) {
      sw.setAttribute('aria-checked', String(on));
      sw.setAttribute('aria-disabled', String(disabled));
      sw.setAttribute('aria-describedby', reason ? 'cb-ar-help cb-voice-reason' : 'cb-ar-help');
      stateEl.textContent = on ? M.autoReadOn : M.autoReadOff;
    }
    reasonEl.textContent = reason;
    reasonEl.hidden = reason === '';
    root.hidden = !sw && reason === '';
  }

  if (sw) {
    sw.append(el('span', '', M.autoReadLabel), stateEl);
    sw.addEventListener('click', () => {
      if (disabled) return; // 읽기 불가 — 눌러도 켜지지 않는다
      checked = !checked;
      render();
      opts.onToggle(checked);
    });
    root.append(sw, el('p', 'cb-ar-help', M.autoReadHelp, { id: 'cb-ar-help' }));
  }
  root.append(reasonEl);
  render();

  return {
    root,
    setDisabled(next) {
      disabled = next;
      render();
    },
    setReason(text) {
      reason = text;
      render();
    },
  };
}
