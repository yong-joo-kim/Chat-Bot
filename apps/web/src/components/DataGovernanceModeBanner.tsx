import { MESSAGES } from '../constants/messages';

/**
 * 거버넌스 모드 OFF일 때 G1·G1-b·G1-c 상단에 뜨는 상시 정적 배너(FR-DG1-6, data-governance-ui-spec.md
 * §2.3). 매 렌더 알림이 아니라 조용한 정적 문구라 `role="status"`를 쓰지 않는다.
 */
export function DataGovernanceModeBanner({ visible }: { visible: boolean }): JSX.Element | null {
  if (!visible) return null;
  return <p className="form-banner form-banner--info">{MESSAGES.dataGovernance.modeOffBanner}</p>;
}
