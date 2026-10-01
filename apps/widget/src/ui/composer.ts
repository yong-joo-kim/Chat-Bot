import { MESSAGES } from '../constants/messages';

const MAX_LENGTH = 1000;

export interface ComposerController {
  root: HTMLFormElement;
  input: HTMLTextAreaElement;
  send: HTMLButtonElement;
  setDisabled(disabled: boolean): void;
  focus(): void;
  /**
   * [신규 No.32] 음성 입력 선택 슬롯 — 상태 줄(strip)은 폼 맨 위, 말하기 버튼은 전송 바로 앞(탭 순서: 입력창 →
   * 말하기 → 전송). 호출하지 않으면 DOM·동작이 지금과 같다(`config.voice` 없음).
   */
  setMicSlot(strip: HTMLElement, mic: HTMLElement): void;
  /** 인식 글자를 기존 글자 **뒤에 공백 1개로 이어 붙이고**(덮어쓰기 없음) 포커스를 입력창 끝으로 옮긴다. */
  insertTranscript(text: string): void;
  /** 사용자가 입력창에 글자를 치기 시작할 때 호출될 훅(읽기 멈춤 등). 새 리스너를 만들지 않는다. */
  setInputHook(hook: (() => void) | null): void;
}

/**
 * 입력창 + 전송(FR-W-17~20). 레이블은 `<label for>`(플레이스홀더 대체 금지), `Enter` 전송/
 * `Shift+Enter` 줄바꿈, 전송 버튼 44×44px. `SENDING`/`403` 동안은 `readOnly` + `aria-disabled`로
 * 이중으로 막는다(포커스는 유지해 스크린리더가 상태를 계속 읽을 수 있게 한다).
 */
export function createComposer(onSubmit: (text: string) => void): ComposerController {
  const form = document.createElement('form');
  form.id = 'cb-composer';
  form.className = 'cb-composer';

  const label = document.createElement('label');
  label.className = 'cb-input-label';
  label.htmlFor = 'cb-input';
  label.textContent = MESSAGES.inputLabel;

  const input = document.createElement('textarea');
  input.id = 'cb-input';
  input.className = 'cb-input';
  input.maxLength = MAX_LENGTH + 200;
  input.rows = 1;
  input.setAttribute('aria-describedby', 'cb-remaining');

  const remaining = document.createElement('span');
  remaining.id = 'cb-remaining';
  remaining.className = 'cb-remaining';
  remaining.setAttribute('aria-hidden', 'true');

  const send = document.createElement('button');
  send.type = 'submit';
  send.id = 'cb-send';
  send.className = 'cb-send';
  send.textContent = MESSAGES.send;

  let disabled = false;
  let inputHook: (() => void) | null = null;

  function updateRemaining(): void {
    const left = MAX_LENGTH - input.value.length;
    remaining.textContent = left < 0 ? MESSAGES.over(-left) : MESSAGES.remaining(left);
    remaining.style.color = left < 0 ? '#b91c1c' : '';
    const overOrDisabled = left < 0 || disabled;
    send.setAttribute('aria-disabled', String(overOrDisabled));
  }

  function submit(): void {
    if (disabled) return;
    const value = input.value;
    if (value.length > MAX_LENGTH) return;
    if (value.trim().length === 0) return;
    onSubmit(value);
    input.value = '';
    updateRemaining();
  }

  input.addEventListener('input', () => {
    updateRemaining();
    inputHook?.();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    submit();
  });

  form.append(label, input, remaining, send);
  updateRemaining();

  return {
    root: form,
    input,
    send,
    setDisabled(next) {
      disabled = next;
      input.readOnly = next;
      input.setAttribute('aria-disabled', String(next));
      updateRemaining();
    },
    focus() {
      input.focus();
    },
    setMicSlot(strip, mic) {
      form.classList.add('cb-composer--voice');
      form.insertBefore(strip, form.firstChild);
      form.insertBefore(mic, send);
    },
    insertTranscript(text) {
      const piece = text.trim();
      if (piece.length === 0) return;
      input.value = input.value.length > 0 ? `${input.value} ${piece}` : piece;
      updateRemaining();
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    },
    setInputHook(hook) {
      inputHook = hook;
    },
  };
}
