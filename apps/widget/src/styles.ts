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
.cb-msg-agent { align-self: flex-start; }

.cb-bubble {
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  padding: 8px 12px;
}
.cb-msg-user .cb-bubble { background: var(--cb-primary, #4f46e5); color: var(--cb-header-text, #fff); border-color: transparent; }
.cb-msg-error .cb-bubble { background: #fef2f2; border-color: #fecaca; color: #b91c1c; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }

/* [No.24] 상담원 말풍선 — 색상 단독 구분이 아니라 보이는 텍스트 라벨과 함께 구분한다(NFR-CSA5). */
.cb-bubble-agent { background: #ecfdf5; border-color: #6ee7b7; }
.cb-agent-label { display: block; font-size: 11px; font-weight: 700; color: #047857; margin-bottom: 2px; }

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

/*
 * [No.44] 답변 평가 막대(FB-W, feedback-loop-ui-spec.md §3.2.3) — 말풍선 밖, .cb-msg 안의
 * 형제 요소. 선택 상태는 색상 하나에 기대지 않는다(배경 채움 + 굵은 테두리 + 체크 표시 3중).
 */
.cb-feedback-bar { display: flex; align-items: center; gap: 6px; margin-top: 4px; flex-wrap: wrap; }
.cb-feedback-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-width: 44px;
  min-height: 44px;
  padding: 6px 10px;
  border-radius: 999px;
  border: 1px solid #6b7280;
  background: #fff;
  color: #374151;
  font-size: 12px;
  cursor: pointer;
}
.cb-feedback-btn:focus-visible { outline: 3px solid #1d4ed8; outline-offset: 2px; }
.cb-feedback-btn:disabled { cursor: not-allowed; opacity: 0.6; }
.cb-feedback-btn--selected {
  background: var(--cb-primary, #4f46e5);
  border-color: var(--cb-primary, #4f46e5);
  border-width: 2px;
  color: var(--cb-header-text, #fff);
  font-weight: 700;
}
.cb-feedback-btn--selected .cb-feedback-label::before { content: '\\2713 '; }
.cb-feedback-bar[aria-busy="true"] .cb-feedback-btn { opacity: 0.5; }
.cb-feedback-icon { font-size: 14px; }
.cb-feedback-note { font-size: 11px; color: #6b7280; }

/* [신규 No.46] 캐러셀(RM-9, §3.9) — 자동 넘김 금지(타이머 0), 모든 카드 DOM 유지. */
.cb-carousel { display: flex; flex-direction: column; gap: 6px; }
.cb-carousel-track {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  scroll-snap-type: x mandatory;
  padding-bottom: 2px;
}
.cb-carousel-card {
  flex: 0 0 80%;
  scroll-snap-align: start;
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  padding: 8px 12px;
  background: #fff;
}
/* [코드 리뷰 R1 Medium] 카드 이미지 고정 비율 상자(§12.3) — 로드 실패로 <img>가 대체 텍스트로
   바뀌어도 카드 높이가 흔들리지 않는다. */
.cb-carousel-image-box {
  aspect-ratio: 16 / 9;
  overflow: hidden;
  border-radius: 8px;
  margin-bottom: 6px;
  background: #f3f4f6;
  display: flex;
  align-items: center;
  justify-content: center;
}
.cb-carousel-image-box img { width: 100%; height: 100%; object-fit: cover; display: block; }
.cb-carousel-image-box .cb-msg-text { padding: 8px; text-align: center; font-size: 13px; color: #6b7280; }
.cb-carousel-nav { display: flex; align-items: center; justify-content: center; gap: 8px; }
.cb-carousel-nav-btn {
  min-width: 44px;
  min-height: 44px;
  border-radius: 8px;
  border: 1px solid var(--cb-primary, #4f46e5);
  background: #fff;
  color: var(--cb-primary, #4f46e5);
  cursor: pointer;
}
.cb-carousel-nav-btn[aria-disabled="true"] { opacity: 0.4; cursor: not-allowed; }
.cb-carousel-nav-btn:focus-visible { outline: 3px solid #1d4ed8; outline-offset: 2px; }
.cb-carousel-position { font-size: 12px; color: #6b7280; }
@media (prefers-reduced-motion: reduce) {
  .cb-carousel-track { scroll-behavior: auto; }
}

/* [신규 No.46] 바로연결 칩(RM-10, §3.10) — 말풍선 아래·평가 막대 앞, 44px 이상. */
.cb-quick-replies { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 4px; }
.cb-quick-reply {
  min-height: 44px;
  padding: 6px 14px;
  border-radius: 999px;
  border: 1px solid var(--cb-primary, #4f46e5);
  background: #fff;
  color: var(--cb-primary, #4f46e5);
  font-size: 14px;
  cursor: pointer;
}
.cb-quick-reply:focus-visible { outline: 3px solid #1d4ed8; outline-offset: 2px; }

@media (max-width: 420px) {
  .cb-panel { bottom: 0; right: 0; left: 0; width: 100vw; max-width: 100vw; }
}

/* [신규 No.35] 선제 안내 말풍선(PA-W1, proactive-messaging-ui-spec.md 4장) — 패널과 무관하게
   런처의 형제 요소. 자동 사라짐 없음, 자동 포커스 이동 없음(구현은 ui/proactive-bubble.ts). */
.cb-sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; }

.cb-pa-bubble {
  position: fixed;
  bottom: 88px;
  right: 20px;
  width: 300px;
  max-width: calc(100vw - 24px);
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  box-shadow: 0 8px 24px rgba(0,0,0,0.2);
  padding: 14px;
  animation: cb-pa-fade-in 160ms ease-out;
}
.cb-pa-bubble[hidden] { display: none; }
.cb-root[data-position="left"] .cb-pa-bubble { right: auto; left: 20px; }

.cb-pa-label { display: block; font-size: 12px; font-weight: 700; color: var(--cb-primary, #4f46e5); margin-bottom: 6px; }
.cb-pa-text { margin: 0 0 10px; font-size: 14px; color: #1f2937; white-space: pre-line; }

.cb-pa-actions { display: flex; flex-direction: column; gap: 8px; margin-bottom: 10px; }
.cb-pa-btn {
  min-height: 44px;
  padding: 8px 14px;
  border-radius: 8px;
  border: 1px solid var(--cb-primary, #4f46e5);
  background: #fff;
  color: var(--cb-primary, #4f46e5);
  font-size: 14px;
  cursor: pointer;
  text-align: left;
  text-decoration: none;
  display: inline-flex;
  align-items: center;
}
.cb-pa-btn:focus-visible { outline: 3px solid #1d4ed8; outline-offset: 2px; }

/* FR-PA1-7 — 버튼 0개 규칙은 문구 영역 전체가 버튼이다. */
.cb-pa-body-button {
  display: block;
  width: 100%;
  min-height: 44px;
  padding: 10px 12px;
  border-radius: 8px;
  border: 1px solid #e5e7eb;
  background: #f9fafb;
  color: #1f2937;
  font-size: 14px;
  text-align: left;
  white-space: pre-line;
  cursor: pointer;
  margin-bottom: 10px;
}
.cb-pa-body-button:focus-visible { outline: 3px solid #1d4ed8; outline-offset: 2px; }

/* FR-0-247 ④ — 닫기·끄기는 서로 동등한 크기·대비로 둔다(하나를 흐리게·작게 하지 않는다). */
.cb-pa-footer { display: flex; flex-wrap: wrap; gap: 8px; border-top: 1px solid #e5e7eb; padding-top: 10px; }
.cb-pa-footer .cb-pa-btn { flex: 1 1 auto; justify-content: center; font-size: 13px; }

@keyframes cb-pa-fade-in { from { opacity: 0; } to { opacity: 1; } }
@media (prefers-reduced-motion: reduce) {
  .cb-pa-bubble { animation: none; }
}

@media (max-width: 420px) {
  .cb-root[data-mode="mobile"] .cb-pa-bubble {
    left: 12px;
    right: 12px;
    width: auto;
    max-height: 40vh;
    overflow-y: auto;
  }
}
`;
