import { MESSAGES } from '../constants/messages';

const MAX_LENGTH = 1000;

export interface ComposerController {
  root: HTMLFormElement;
  input: HTMLTextAreaElement;
  send: HTMLButtonElement;
  setDisabled(disabled: boolean): void;
  focus(): void;
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

  function updateRemaining(): void {
    const left = MAX_LENGTH - input.value.length;
    remaining.textContent = MESSAGES.remaining(Math.max(0, left));
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

  input.addEventListener('input', updateRemaining);
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
  };
}
