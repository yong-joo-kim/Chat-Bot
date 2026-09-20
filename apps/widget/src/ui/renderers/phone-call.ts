/** `PHONE_CALL` 아웃풋 — `tel:` 링크. */
export function renderPhoneCall(payload: { label: string; phoneNumber: string }): HTMLElement {
  const a = document.createElement('a');
  a.className = 'cb-phone';
  a.href = `tel:${payload.phoneNumber}`;
  a.textContent = payload.label;
  return a;
}
