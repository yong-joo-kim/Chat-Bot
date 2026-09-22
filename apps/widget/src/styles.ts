/**
 * Shadow DOM 내부 전용 스타일(FR-W-12, ADR-0012 §3) — TS 문자열로 보관해 별도 CSS 요청 0건.
 * 터치 영역 44×44px(FR-W-18), 포커스 아웃라인, 색상 단독 금지(FR-W-24)를 여기서 강제한다.
 */
export const WIDGET_STYLES = `
:host, .cb-root {
  all: initial;
  font-family: 'Noto Sans KR', system-ui, sans-serif;
  font-size: 14px;
  line-height: 1.5;
  color: #1f2937;
  box-sizing: border-box;
}
.cb-root *, .cb-root *::before, .cb-root *::after { box-sizing: border-box; }
.cb-root {
  position: fixed;
  z-index: 2147483000;
  bottom: 20px;
  right: 20px;
}
.cb-root[data-position="left"] { right: auto; left: 20px; }

.cb-launcher {
  min-width: 56px;
  min-height: 56px;
  width: 56px;
  height: 56px;
  border-radius: 50%;
  border: none;
  background: var(--cb-primary, #4f46e5);
  color: #fff;
  font-size: 24px;
  cursor: pointer;
  box-shadow: 0 4px 14px rgba(0,0,0,0.25);
}
.cb-launcher:focus-visible { outline: 3px solid #1d4ed8; outline-offset: 2px; }

.cb-panel {
  position: fixed;
  bottom: 88px;
  right: 20px;
  width: 360px;
  max-width: calc(100vw - 24px);
  height: 560px;
  max-height: calc(100vh - 110px);
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 12px 32px rgba(0,0,0,0.3);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.cb-root[data-position="left"] .cb-panel { right: auto; left: 20px; }
.cb-panel[hidden] { display: none; }

.cb-root[data-mode="mobile"] .cb-panel,
.cb-root[data-fullscreen="true"] .cb-panel {
  bottom: 0;
  right: 0;
  left: 0;
  top: 0;
  width: 100vw;
  height: 100dvh;
  max-width: 100vw;
  max-height: 100dvh;
  border-radius: 0;
}

.cb-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 14px;
  background: var(--cb-primary, #4f46e5);
  color: var(--cb-header-text, #fff);
  flex: none;
}
.cb-logo { width: 28px; height: 28px; border-radius: 6px; object-fit: cover; }
.cb-title { flex: 1; margin: 0; font-size: 16px; font-weight: 700; }
.cb-close {
  min-width: 44px;
  min-height: 44px;
  border: none;
  background: transparent;
  color: inherit;
  font-size: 18px;
  cursor: pointer;
  border-radius: 6px;
}
.cb-close:focus-visible { outline: 3px solid #fff; outline-offset: -3px; }

.cb-messages {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: #f9fafb;
}
.cb-messages:focus-visible { outline: 2px solid #4f46e5; outline-offset: -2px; }

.cb-msg { max-width: 82%; }
.cb-msg-bot { align-self: flex-start; }
.cb-msg-user { align-self: flex-end; }
.cb-msg-system { align-self: center; color: #6b7280; font-size: 12px; text-align: center; }
.cb-msg-error { align-self: flex-start; }

.cb-bubble {
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  padding: 8px 12px;
}
.cb-msg-user .cb-bubble { background: var(--cb-primary, #4f46e5); color: var(--cb-header-text, #fff); border-color: transparent; }
.cb-msg-error .cb-bubble { background: #fef2f2; border-color: #fecaca; color: #b91c1c; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }

.cb-msg-text { margin: 0; white-space: pre-wrap; word-break: break-word; }

.cb-card { border: 1px solid #e5e7eb; border-radius: 10px; overflow: hidden; background: #fff; }
.cb-card-image { width: 100%; display: block; max-height: 160px; object-fit: cover; }
.cb-card-body { padding: 8px 12px; }
.cb-card-title { margin: 0 0 4px; font-weight: 700; }
.cb-card-desc { margin: 0; color: #4b5563; }

.cb-image { max-width: 100%; border-radius: 10px; display: block; }

.cb-buttons { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
.cb-btn {
  min-height: 44px;
  padding: 8px 14px;
  border-radius: 999px;
  border: 1px solid var(--cb-primary, #4f46e5);
  background: #fff;
  color: var(--cb-primary, #4f46e5);
  font-size: 14px;
  cursor: pointer;
}
.cb-btn:focus-visible { outline: 3px solid #1d4ed8; outline-offset: 2px; }

.cb-link, .cb-phone {
  display: inline-flex;
  align-items: center;
  min-height: 44px;
  padding: 6px 12px;
  border-radius: 8px;
  border: 1px solid #e5e7eb;
  color: #1d4ed8;
  text-decoration: none;
}

.cb-status {
  min-height: 20px;
  padding: 0 12px 6px;
  font-size: 12px;
  color: #6b7280;
  flex: none;
}

.cb-composer {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  padding: 10px;
  border-top: 1px solid #e5e7eb;
  flex: none;
  background: #fff;
}
.cb-input-label { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; }
.cb-input {
  flex: 1;
  min-height: 44px;
  max-height: 96px;
  resize: none;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 8px 10px;
  font: inherit;
}
.cb-input:focus-visible { outline: 3px solid #4f46e5; outline-offset: 1px; }
.cb-input[aria-disabled="true"] { background: #f3f4f6; color: #9ca3af; }
.cb-remaining { align-self: center; font-size: 11px; color: #9ca3af; white-space: nowrap; }
.cb-send {
  min-width: 44px;
  min-height: 44px;
  border-radius: 8px;
  border: none;
  background: var(--cb-primary, #4f46e5);
  color: var(--cb-header-text, #fff);
  font-weight: 700;
  cursor: pointer;
  padding: 0 14px;
}
.cb-send[aria-disabled="true"] { background: #a5a6f0; cursor: not-allowed; }
.cb-send:focus-visible { outline: 3px solid #1d4ed8; outline-offset: 2px; }

.cb-retry {
  min-height: 36px;
  border-radius: 6px;
  border: 1px solid #b91c1c;
  background: #fff;
  color: #b91c1c;
  padding: 4px 10px;
  cursor: pointer;
}

/* 되묻기 후보 문장이 길 때의 세로 스택(nlu-rag-answering-ui-spec.md §4.5.2) */
.cb-buttons--stacked { flex-direction: column; align-items: stretch; }
.cb-buttons--stacked .cb-btn {
  width: 100%;
  min-height: 44px;
  text-align: left;
  border-radius: 8px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

/* 답변 대기(PENDING) 진행 인디케이터 — 애니메이션만으로 상태를 전달하지 않는다(#cb-status가 텍스트 담당) */
.cb-pending-indicator {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 12px;
  align-self: flex-start;
}
.cb-pending-indicator span {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #9ca3af;
  animation: cb-pending-pulse 1.2s ease-in-out infinite;
}
.cb-pending-indicator span:nth-child(2) { animation-delay: 0.2s; }
.cb-pending-indicator span:nth-child(3) { animation-delay: 0.4s; }
@keyframes cb-pending-pulse {
  0%, 80%, 100% { opacity: 0.3; transform: scale(0.85); }
  40% { opacity: 1; transform: scale(1); }
}
@media (prefers-reduced-motion: reduce) {
  .cb-pending-indicator span { animation: none; opacity: 0.6; }
}

/* 출처 표기(RAG 근거) — 링크가 아니라 텍스트다(NFR-A3) */
.cb-sources { margin-top: 8px; border-top: 1px solid #e5e7eb; padding-top: 6px; }
.cb-sources-label { font-weight: 700; font-size: 12px; color: #4b5563; }
.cb-sources ul { margin: 4px 0; padding-left: 18px; font-size: 13px; color: #374151; }
.cb-sources-caption { margin: 4px 0 0; font-size: 11px; color: #9ca3af; }

@media (max-width: 420px) {
  .cb-panel { bottom: 0; right: 0; left: 0; width: 100vw; max-width: 100vw; }
}
`;
