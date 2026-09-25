import type { ReadinessWarning } from '@chat-bot/shared-types';
import { MESSAGES } from '../../../constants/messages';
import { formatPercent } from '../../../lib/date';
import { formatScheduleDateTime } from '../../../lib/scheduleTime';
import { useDeployScheduleTimezone } from '../../../lib/useDeployScheduleMeta';
import { warningText } from '../versions/restore/restorePreviewText';

/**
 * 준비도 경고(G0') 목록(`scheduled-deploy-ui-spec.md` §4.3.3). `RESTORE_WARNINGS`는 No.25
 * `RestoreWarningList`의 문구 매핑(`warningText`)을 그대로 재사용하고, 나머지 8종은 이 컴포넌트가
 * 전담한다 — 도메인 유니온이 달라 재사용하지 않는다(§3.2 근거 그대로).
 */
export function ReadinessWarningList({ warnings }: { warnings: ReadinessWarning[] }): JSX.Element | null {
  const timezone = useDeployScheduleTimezone();
  if (warnings.length === 0) return null;
  const msg = MESSAGES.deploySchedules.detail.readiness;

  return (
    <ul className="readiness-warning-list">
      {warnings.map((w, i) => {
        if (w.code === 'RESTORE_WARNINGS') {
          return w.warnings.map((rw, j) => (
            <li key={`${i}-${j}`} className="readiness-warning-item readiness-warning-item--warning">
              <span aria-hidden="true">⚠</span> {warningText(rw)}
            </li>
          ));
        }
        let text: string;
        switch (w.code) {
          case 'EMBEDDING_INDEX_INCOMPLETE':
            text = msg.EMBEDDING_INDEX_INCOMPLETE(w.pendingCount);
            break;
          case 'LAST_TEST_RUN':
            text = msg.LAST_TEST_RUN(w.setName, formatPercent(w.passRate), formatScheduleDateTime(w.ranAt, timezone));
            break;
          case 'NO_RECENT_TEST_RUN':
            text = msg.NO_RECENT_TEST_RUN;
            break;
          case 'ACTIVE_JOB':
            text = msg.ACTIVE_JOB;
            break;
          case 'WEB_CHANNEL_NOT_CONFIGURED':
            text = msg.WEB_CHANNEL_NOT_CONFIGURED;
            break;
          case 'PUBLISHED_BUT_CHANNEL_CLOSED':
            text = msg.PUBLISHED_BUT_CHANNEL_CLOSED;
            break;
          case 'LONG_HORIZON':
            text = msg.LONG_HORIZON(w.days);
            break;
          case 'PREDECESSOR_HELD':
            text = msg.PREDECESSOR_HELD;
            break;
          case 'ENGINE_DISABLED_ON_THIS_INSTANCE':
            text = msg.ENGINE_DISABLED_ON_THIS_INSTANCE;
            break;
          // [신규 No.40] 모드 켜진 챗봇의 RESTORE_VERSION 예약 — 복원 예약이 초안에만 적용된다는 의미 변화 안내.
          case 'ENV_DRAFT_ONLY':
            text = msg.ENV_DRAFT_ONLY;
            break;
          default:
            text = '';
        }
        return (
          <li key={i} className="readiness-warning-item">
            <span aria-hidden="true">ⓘ</span> {text}
          </li>
        );
      })}
    </ul>
  );
}
