import { MESSAGES } from '../../../constants/messages';

/** "미저장 변경 적용됨" 배지 — 색상 + 텍스트 병기(NFR-A2, FR-10-24). */
export function OverlayBadge(): JSX.Element {
  return (
    <span className="overlay-badge">
      <span aria-hidden="true">🟡</span> {MESSAGES.simulator.overlayBadge}
    </span>
  );
}
