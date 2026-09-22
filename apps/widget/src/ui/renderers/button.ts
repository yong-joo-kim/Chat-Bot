import type { ButtonActionView } from '@chat-bot/shared-types/output-view';
import type { ButtonItem } from '@chat-bot/shared-types';
import { resolveButtonAction } from '../../core/button-action';
import { MESSAGES } from '../../constants/messages';

/**
 * 되묻기 후보가 FAQ/의도 원문(수십 자)일 수 있으면 세로 스택으로 전환한다
 * (`nlu-rag-answering-ui-spec.md` §4.5.2). 백엔드가 동음이의어/의미매칭 후보를 구분하는 필드를
 * 내려주지 않아(둘 다 `BUTTON`+`MESSAGE`) 라벨 길이 휴리스틱을 쓴다 — `apps/web`의
 * `OutputRenderer.tsx` 주석 참고. 접근성 이름(`textContent`)은 항상 후보 문장 전체를 유지한다(NFR-A2).
 *
 * 이 휴리스틱이 기존 `BUTTON` 아웃풋 소비자(대화노드 퀵메뉴, 퀵리플라이)까지 조용히 레이아웃을
 * 바꾸지 않도록 평가 범위를 구조적으로 좁힌다(code-reviewer 지적, Medium):
 *   1) 호출부가 `{ allowStackedLayout: false }`를 넘기면 평가하지 않는다 — 퀵리플라이는
 *      `apps/widget/src/ui/app.ts`의 인사말 렌더링에서 이 옵션으로 항상 제외한다.
 *   2) 그룹 내 모든 버튼이 `action:'MESSAGE'`일 때만 평가한다 — 되묻기는 항상 전부 `MESSAGE`
 *      액션이지만(DD-27, FR-N1-12), 대화노드 퀵메뉴는 `NODE`/`LINK` 액션도 섞어 쓰므로 이 조건만으로
 *      자연히 제외된다.
 */
const STACKED_LABEL_LENGTH_THRESHOLD = 10;

export interface ButtonGroupOptions {
  /** `false`면 세로 스택 평가 자체를 하지 않는다(예: 퀵리플라이 — 되묻기가 아닌 UI 자체 생성 버튼). */
  allowStackedLayout?: boolean;
}

/** 버튼 그룹 — 모두 `<button>` 요소(FR-W-20, `div+role` 금지), 44×44px 이상(FR-W-18). */
export function renderButtonGroup(
  buttons: ButtonItem[],
  onButtonAction: (action: ButtonActionView) => void,
  options: ButtonGroupOptions = {},
): HTMLElement {
  const group = document.createElement('div');
  group.className = 'cb-buttons';
  const allowStacked = options.allowStackedLayout ?? true;
  if (
    allowStacked &&
    buttons.every((b) => b.action === 'MESSAGE') &&
    buttons.some((b) => b.label.length > STACKED_LABEL_LENGTH_THRESHOLD)
  ) {
    group.className += ' cb-buttons--stacked';
  }
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', MESSAGES.buttonGroupLabel);
  for (const btn of buttons) {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'cb-btn';
    el.textContent = btn.label;
    el.addEventListener('click', () => onButtonAction(resolveButtonAction(btn)));
    group.appendChild(el);
  }
  return group;
}

/** `BUTTON` 아웃풋(선택형 안내 문구 + 버튼 그룹). */
export function renderButtonBlock(
  payload: { text?: string; buttons: ButtonItem[] },
  onButtonAction: (action: ButtonActionView) => void,
  options: ButtonGroupOptions = {},
): HTMLElement {
  const wrap = document.createElement('div');
  if (payload.text) {
    const p = document.createElement('p');
    p.className = 'cb-msg-text';
    p.textContent = payload.text;
    wrap.appendChild(p);
  }
  wrap.appendChild(renderButtonGroup(payload.buttons, onButtonAction, options));
  return wrap;
}
