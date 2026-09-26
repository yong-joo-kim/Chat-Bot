import { MESSAGES } from '../constants/messages';

/**
 * G7 — 열람 감사 안내 배너(data-governance-ui-spec.md §3.10, 2026-09-26 PM 확정 신설). 거버넌스
 * 모드 ON일 때 `VIEW` 감사 대상 8개 화면 상단에 정적 안내를 넣는다.
 *
 * PM이 명시적으로 라이브 리전을 배제했다 — `role="status"`/`aria-live`를 쓰지 않는다. 페이지 로드 시
 * DOM에 이미 존재하는 일반 문단(`<p>`)으로 렌더되며, 탭 전환 등으로 재마운트돼도 재알림으로 취급하지
 * 않는다(§3.10 접근성 규칙, `UIUX_준수기준.md` §8의 "새 항목만 aria-live 1회 안내" 원칙의 의도된 예외).
 */
export function GovernanceViewAuditBanner({ visible }: { visible: boolean }): JSX.Element | null {
  if (!visible) return null;
  return <p className="form-banner form-banner--info">{MESSAGES.dataGovernance.viewAuditBanner}</p>;
}
