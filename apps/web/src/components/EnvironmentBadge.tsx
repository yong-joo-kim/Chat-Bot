import type { EnvironmentBadge as EnvironmentBadgeKind } from '@chat-bot/shared-types';
import { MESSAGES } from '../constants/messages';

/**
 * 환경 배지 3종(`environment-separation-ui-spec.md` §3.3-(1), FR-EN4-6, NFR-ENA1 — 색상 단독 금지).
 * `VersionRow`·헤더·이력 표가 공용으로 쓴다. 아이콘 + 텍스트 + 색상 3중 표현.
 */
const STYLE: Record<EnvironmentBadgeKind, { icon: string; bg: string; fg: string }> = {
  PROD: { icon: '●', bg: '#DCFCE7', fg: '#166534' },
  STAGING: { icon: '◐', bg: '#DBEAFE', fg: '#1D4ED8' },
  PROD_HISTORY: { icon: '○', bg: '#F3F4F6', fg: '#374151' },
};

export function EnvironmentBadge({ kind }: { kind: EnvironmentBadgeKind }): JSX.Element {
  const style = STYLE[kind];
  return (
    <span className="environment-badge" style={{ backgroundColor: style.bg, color: style.fg }}>
      <span aria-hidden="true">{style.icon}</span> {MESSAGES.environment.badge[kind]}
    </span>
  );
}

export function EnvironmentBadgeList({ badges }: { badges?: EnvironmentBadgeKind[] }): JSX.Element | null {
  if (!badges || badges.length === 0) return null;
  return (
    <span className="environment-badge-list">
      {badges.map((b) => (
        <EnvironmentBadge key={b} kind={b} />
      ))}
    </span>
  );
}
