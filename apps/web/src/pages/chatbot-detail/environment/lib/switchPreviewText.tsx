import type { EnvironmentGateSettings, GateEvaluation, ProdSwitchWarning } from '@chat-bot/shared-types';
import { MESSAGES } from '../../../../constants/messages';
import { formatDateTime, formatPercent } from '../../../../lib/date';
import { warningText as restoreWarningText } from '../../versions/restore/restorePreviewText';

/**
 * 운영 전환 미리보기(`ProdSwitchDialog`)·예약 전환(`ScheduleDeployDialog`) 공용 매핑 함수
 * (`environment-separation-ui-spec.md` §3.3-(3)~(5)). No.25 `restorePreviewText.tsx`와 같은 패턴 —
 * 도메인 유니온이 달라 별도 파일로 둔다.
 *
 * `settings`(minPassRate·validHours)는 `EnvironmentStatus.gate`(게이트 설정)에서 온다 — `GateEvaluation`
 * 자체에는 기준값이 없어(판정 결과만) 문구에 "기준 {min}% 이상"을 채우려면 함께 전달해야 한다.
 */
export function gateReasonText(gate: GateEvaluation, settings?: EnvironmentGateSettings): string {
  const msg = MESSAGES.environment.gateReason;
  const min = settings?.minPassRate ?? 0;
  const validHours = settings?.validHours ?? 0;
  switch (gate.reason) {
    case 'PASSED':
      return gate.run ? msg.PASSED(gate.run.setName, formatPercent(gate.run.passRate), min, formatDateTime(gate.run.finishedAt)) : '';
    case 'NO_RUN':
      return msg.NO_RUN;
    case 'BELOW_THRESHOLD':
      return gate.run ? msg.BELOW_THRESHOLD(gate.run.setName, formatPercent(gate.run.passRate), min, formatDateTime(gate.run.finishedAt)) : '';
    case 'EXPIRED':
      return gate.run ? msg.EXPIRED(validHours, formatDateTime(gate.run.finishedAt)) : '';
    case 'MODEL_CHANGED':
      return msg.MODEL_CHANGED;
    case 'SET_MISSING':
      return msg.SET_MISSING;
    case 'NOT_CONFIGURED':
      return msg.NOT_CONFIGURED;
    default:
      return '';
  }
}

/** [No.40 신설] 전환 미리보기 경고 12종 문구(§3.3-(4)). 5종은 No.25 `RestoreWarningList`과 동일 문구를 재사용한다. */
export function SwitchWarningText(warning: ProdSwitchWarning, gateSettings?: EnvironmentGateSettings): string {
  const msg = MESSAGES.environment.switchDialog.warnings;
  switch (warning.code) {
    case 'GATE_WARN':
      return gateReasonText(warning.gate, gateSettings);
    case 'LEGACY_TIEBREAK':
      return msg.LEGACY_TIEBREAK;
    case 'SEMANTIC_INDEX_PENDING':
      return msg.SEMANTIC_INDEX_PENDING(warning.count);
    case 'CONTEXT_FLOWS_AFFECTED':
      return msg.CONTEXT_FLOWS_AFFECTED(warning.count);
    case 'TOPIC_EXPOSURE_CHANGE':
      return msg.TOPIC_EXPOSURE_CHANGE(warning.exposed, warning.hidden);
    case 'TOPIC_MISSING':
      // No.25 복원 경고와 동일 문구 재사용(설계서 §9.4 "복원 경고 재사용").
      return restoreWarningText({ code: 'TOPIC_MISSING', count: warning.count });
    case 'SURVEY_MISSING':
      return restoreWarningText({ code: 'SURVEY_MISSING', count: warning.count });
    case 'SURVEY_NOT_OPEN':
      return restoreWarningText({ code: 'SURVEY_NOT_OPEN', count: warning.count });
    case 'API_CONNECTION_MISSING':
      return restoreWarningText({ code: 'API_CONNECTION_MISSING', count: warning.count });
    case 'API_CONNECTION_DISABLED':
      return restoreWarningText({ code: 'API_CONNECTION_DISABLED', count: warning.count });
    case 'PROFILE_WILL_CHANGE': {
      const msgRestore = MESSAGES.versions.restore;
      const fields = warning.fields.map((f) => (msgRestore.profileFieldLabel as Record<string, string>)[f] ?? f).join(', ');
      return msg.PROFILE_WILL_CHANGE(fields);
    }
    case 'OLDER_THAN_DRAFT':
      return msg.OLDER_THAN_DRAFT;
    default:
      return '';
  }
}

export type ProdSwitchBlockerCode = 'TARGET_NOT_ALLOWED' | 'GATE_BLOCKED' | 'GATE_CONFIG_ERROR' | 'TARGET_UNREADABLE' | 'CHATBOT_ARCHIVED' | 'ENV_MODE_DISABLED';

/** [No.40 신설] 전환 차단 6종 문구(§3.3-(5)). `GATE_BLOCKED`는 게이트 사유 문구를 이어 붙인다. */
export function SwitchBlockerText(code: ProdSwitchBlockerCode, gate?: GateEvaluation, gateSettings?: EnvironmentGateSettings): string {
  const msg = MESSAGES.environment.switchDialog.blockers;
  switch (code) {
    case 'TARGET_NOT_ALLOWED':
      return msg.TARGET_NOT_ALLOWED;
    case 'GATE_BLOCKED':
      return msg.GATE_BLOCKED(gate ? gateReasonText(gate, gateSettings) : '');
    case 'GATE_CONFIG_ERROR':
      return msg.GATE_CONFIG_ERROR;
    case 'TARGET_UNREADABLE':
      return msg.TARGET_UNREADABLE;
    case 'CHATBOT_ARCHIVED':
      return msg.CHATBOT_ARCHIVED;
    case 'ENV_MODE_DISABLED':
      return msg.ENV_MODE_DISABLED;
    default:
      return '';
  }
}
