import { MESSAGES } from '../constants/messages';

/** S1/S4 상단 — 엔진 비활성 경고(FR-D3-8/FR-D7-8, `scheduled-deploy-ui-spec.md` §3.2). */
export function EngineDisabledBanner({ visible }: { visible: boolean }): JSX.Element | null {
  if (!visible) return null;
  return (
    <p className="form-banner form-banner--warning" role="status">
      <span aria-hidden="true">⚠</span> {MESSAGES.deploySchedules.engineDisabledBanner}
    </p>
  );
}
