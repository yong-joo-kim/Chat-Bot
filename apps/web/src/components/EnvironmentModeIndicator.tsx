import type { EnvironmentStatus } from '@chat-bot/shared-types';

/**
 * `TabNav` "환경" 탭의 소형 점 표시(§1.4). 모드 켜짐 챗봇에서만 렌더되는 순수 장식 —
 * 실제 상태 정보는 헤더 배지(`EnvironmentHeaderBadge`)가 텍스트로 이미 제공하므로 여기서는
 * 중복 낭독을 막기 위해 `aria-hidden`으로 숨긴다.
 */
export function EnvironmentModeIndicator({ status }: { status: EnvironmentStatus | null }): JSX.Element | null {
  if (!status || !status.enabled) return null;
  return (
    <span className="environment-mode-indicator" aria-hidden="true">
      ●
    </span>
  );
}
