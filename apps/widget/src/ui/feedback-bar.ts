import { MESSAGES } from '../constants/messages';
import { planFeedbackAttempt, type FeedbackAttemptResult, type FeedbackRating } from '../core/feedback';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface FeedbackBarBinding {
  /** 이 말풍선의 서버 `messageId` — 평가 요청 결합 검증에 쓰인다(`feedback-loop-설계.md` §13.3). */
  messageId: string;
  /** 실제 `fetch` 호출 + 오류 분류는 `ui/app.ts`가 맡는다(이 파일은 DOM만 다룬다). */
  onRate: (rating: FeedbackRating) => Promise<FeedbackAttemptResult>;
  /** `#cb-status`(polite) 1회 안내 — `panel.setStatusText`(다른 상태 문구를 덮어쓸 수 있으므로
   * 자기 문구일 때만 지우는 책임은 호출부가 진다). */
  onAnnounce: (text: string) => void;
}

/**
 * 답변 평가 막대(FB-W, `feedback-loop-ui-spec.md` §3.2). `.cb-msg` 안, `.cb-bubble` 바로 다음
 * 형제로 붙어야 하며(호출부 책임), 이후 상태 변화는 **이 함수가 만든 기존 노드의 속성/텍스트만**
 * 바꾼다 — 새 DOM 노드를 추가하지 않는다(`#cb-messages`의 `aria-relevant="additions"` 재낭독 방지).
 */
export function createFeedbackBar(binding: FeedbackBarBinding): HTMLElement {
  const bar = document.createElement('div');
  bar.className = 'cb-feedback-bar';
  bar.setAttribute('role', 'group');
  bar.setAttribute('aria-label', MESSAGES.feedback.groupLabel);
  bar.dataset.messageId = binding.messageId;

  function createButton(kind: 'up' | 'down', label: string, icon: string): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `cb-feedback-btn cb-feedback-${kind}`;
    btn.setAttribute('aria-pressed', 'false');
    const iconSpan = document.createElement('span');
    iconSpan.className = 'cb-feedback-icon';
    iconSpan.setAttribute('aria-hidden', 'true');
    iconSpan.textContent = icon;
    const labelSpan = document.createElement('span');
    labelSpan.className = 'cb-feedback-label';
    labelSpan.textContent = label;
    btn.append(iconSpan, labelSpan);
    return btn;
  }

  const upBtn = createButton('up', MESSAGES.feedback.up, '\u{1F44D}');
  const downBtn = createButton('down', MESSAGES.feedback.down, '\u{1F44E}');
  const note = document.createElement('span');
  note.className = 'cb-feedback-note';
  note.setAttribute('aria-hidden', 'true');

  bar.append(upBtn, downBtn, note);

  // 서버가 돌려준 마지막 확정값(취소 없음 — FR-FB9-6). null = 아직 저장된 평가 없음.
  let confirmed: FeedbackRating | null = null;
  let locked = false;
  let busy = false;

  function setPressed(rating: FeedbackRating | null): void {
    upBtn.setAttribute('aria-pressed', String(rating === 'UP'));
    downBtn.setAttribute('aria-pressed', String(rating === 'DOWN'));
    upBtn.classList.toggle('cb-feedback-btn--selected', rating === 'UP');
    downBtn.classList.toggle('cb-feedback-btn--selected', rating === 'DOWN');
  }

  function applyDisabled(): void {
    const disabled = busy || locked;
    upBtn.disabled = disabled;
    downBtn.disabled = disabled;
  }

  function setBusy(value: boolean): void {
    busy = value;
    bar.setAttribute('aria-busy', String(value));
    applyDisabled();
  }

  function lock(): void {
    locked = true;
    applyDisabled();
  }

  // 동시 요청 방지(진행 중에는 비활성) + 이미 선택된 버튼 재클릭 = 무동작(취소 불가).
  async function attempt(rating: FeedbackRating): Promise<void> {
    if (busy || locked) return;
    if (confirmed === rating) return;

    const previous = confirmed;
    confirmed = rating; // 즉시 선택 표시(낙관적)
    setPressed(rating);
    setBusy(true);
    note.textContent = '';

    let attemptNo: 1 | 2 = 1;
    for (;;) {
      const result = await binding.onRate(rating);
      const plan = planFeedbackAttempt(result, attemptNo);

      if (plan.action === 'RETRY') {
        await sleep(plan.delayMs);
        attemptNo = 2;
        continue;
      }

      setBusy(false);

      if (plan.action === 'DONE_OK') {
        binding.onAnnounce(MESSAGES.feedback.thanks);
        return;
      }

      // DONE_FAIL
      switch (plan.notice) {
        case 'SAVE_FAILED':
          confirmed = previous;
          setPressed(previous);
          note.textContent = MESSAGES.feedback.saveFailed;
          binding.onAnnounce(MESSAGES.feedback.saveFailed);
          break;
        case 'UNAVAILABLE':
          confirmed = null;
          setPressed(null);
          note.textContent = MESSAGES.feedback.unavailable;
          binding.onAnnounce(MESSAGES.feedback.unavailable);
          break;
        case 'LOCKED':
          confirmed = previous;
          setPressed(previous);
          note.textContent = MESSAGES.feedback.locked;
          binding.onAnnounce(MESSAGES.feedback.locked);
          break;
        case 'SILENT':
        default:
          // 429 — 사용자에게 오류로 보이지 않도록 조용히 직전 값으로 복귀(문구 없음).
          confirmed = previous;
          setPressed(previous);
          break;
      }
      if (plan.disable) lock();
      return;
    }
  }

  upBtn.addEventListener('click', () => void attempt('UP'));
  downBtn.addEventListener('click', () => void attempt('DOWN'));

  return bar;
}
