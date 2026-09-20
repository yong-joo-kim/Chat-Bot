import { MESSAGES } from '../constants/messages';

export interface LauncherController {
  root: HTMLButtonElement;
  setExpanded(expanded: boolean): void;
  focus(): void;
}

/** `#cb-launcher`(FR-W-19). 클릭 또는 `Enter`/`Space`로 패널을 연다(버튼 요소가 기본 제공). */
export function createLauncher(onActivate: () => void): LauncherController {
  const btn = document.createElement('button');
  btn.id = 'cb-launcher';
  btn.type = 'button';
  btn.className = 'cb-launcher';
  btn.setAttribute('aria-haspopup', 'dialog');
  btn.setAttribute('aria-expanded', 'false');
  btn.setAttribute('aria-controls', 'cb-panel');
  btn.setAttribute('aria-label', MESSAGES.launcherLabel);
  btn.textContent = '💬';
  btn.addEventListener('click', onActivate);

  return {
    root: btn,
    setExpanded(expanded) {
      btn.setAttribute('aria-expanded', String(expanded));
    },
    focus() {
      btn.focus();
    },
  };
}
