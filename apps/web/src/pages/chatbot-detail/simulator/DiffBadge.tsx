import { MESSAGES } from '../../../constants/messages';

/** `SAME`/`DIFFERENT` 배지 — SAME은 배지 없음(노이즈 최소화), DIFFERENT만 색상+텍스트로 부각(NFR-A2). */
export function DiffBadge({ status }: { status: 'SAME' | 'DIFFERENT' }): JSX.Element | null {
  if (status === 'SAME') return null;
  return (
    <span className="diff-badge diff-badge--different">
      <span aria-hidden="true">🟨</span> {MESSAGES.simulator.compare.changedBadge}
    </span>
  );
}
