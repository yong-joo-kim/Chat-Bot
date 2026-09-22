/**
 * 답변 대기(PENDING) 진행 인디케이터 DOM 생성/제거(`nlu-rag-answering-ui-spec.md` §4.4.2).
 * 점 3개 펄스 애니메이션(시각)만 담당하고 텍스트 안내는 없다 — 상태 안내는 `#cb-status`
 * (`role="status"`)가 별도로 1회만 담당한다(FR-N2-39 "애니메이션만으로 상태를 전달하지 않는다").
 * 인터림 말풍선(일반 봇 말풍선)의 텍스트는 이 노드가 절대 건드리지 않는다 — "수정"이 아니라
 * "추가"로만 상태를 표현해 `#cb-messages`의 `aria-relevant="additions"` 계약을 지킨다.
 */
export function createPendingIndicator(messageId: string): HTMLElement {
  const el = document.createElement('div');
  el.className = 'cb-pending-indicator';
  el.dataset.pendingId = messageId;
  el.setAttribute('aria-hidden', 'true');
  el.append(document.createElement('span'), document.createElement('span'), document.createElement('span'));
  return el;
}

/** `messageId`를 지정하면 해당 인디케이터만, 생략하면 남아있는 모든 인디케이터를 제거한다. */
export function removePendingIndicator(root: ParentNode, messageId?: string): void {
  const selector = messageId ? `[data-pending-id="${CSS.escape(messageId)}"]` : '[data-pending-id]';
  root.querySelectorAll(selector).forEach((el) => el.remove());
}
