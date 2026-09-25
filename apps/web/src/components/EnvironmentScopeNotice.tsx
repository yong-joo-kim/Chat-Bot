import { MESSAGES } from '../constants/messages';

/**
 * "환경 분리 대상이 아닙니다" 배너(§4.15). 환경 분리가 켜진 챗봇에서만 렌더된다 — 꺼진 챗봇은
 * 원래도 전부 즉시 반영이라 알릴 "차이"가 없다. `ArchivedBanner`/`ScheduleConflictBanner`(No.28)와
 * 같은 배치 관행(페이지 최상단, 본문보다 먼저 Tab 순서).
 */
export function EnvironmentScopeNotice({ visible, variant = 'default' }: { visible: boolean; variant?: 'default' | 'topic' }): JSX.Element | null {
  if (!visible) return null;
  return (
    <div className="environment-scope-notice" role="status">
      <span aria-hidden="true">ⓘ</span> {MESSAGES.environment.scopeNotice[variant]}
    </div>
  );
}
