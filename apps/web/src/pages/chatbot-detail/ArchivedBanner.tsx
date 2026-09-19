import { MESSAGES } from '../../constants/messages';

/** settings/skin 탭 상단에 노출되는 보관 상태 안내(AC-1-12). */
export function ArchivedBanner({ visible }: { visible: boolean }): JSX.Element | null {
  if (!visible) return null;
  return (
    <div className="archived-banner" role="status">
      <span aria-hidden="true">⚠</span> {MESSAGES.detail.archivedBanner}
    </div>
  );
}
