import { Link } from 'react-router-dom';
import type { DesignIssue, DesignValidationReport } from '@chat-bot/shared-types';
import { ErrorState } from '../../../components/ErrorState';
import { SkeletonRow } from '../../../components/Skeleton';
import { SeverityBadge } from '../../../components/SeverityBadge';
import { MESSAGES } from '../../../constants/messages';

export interface DesignValidationPanelProps {
  chatbotId: string;
  report: DesignValidationReport | null;
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  onClose: () => void;
}

/**
 * [코드 리뷰 1회차 M-3] 토픽 규칙 4종은 구조화된 `issue.topicRef`(edge·출발/도착 리소스·토픽)로부터
 * `MESSAGES.topics.designRule*`를 사용해 행 문구를 클라이언트가 직접 구성한다 — 서버 `message` 문자열에만
 * 의존하지 않는다(§3.5 메시지 패턴표와 동일한 문구를 클라이언트가 재현·검증할 수 있게 한다).
 * `topicRef`가 없으면(코드가 매칭되지 않거나 서버가 아직 채우지 않은 경우) 서버 `issue.message`로 폴백한다.
 */
function topicRuleText(issue: DesignIssue): string | undefined {
  const msg = MESSAGES.topics;
  if (issue.code === 'NO_LIVE_ENTRY_POINT') return msg.designRuleNoLiveEntryPoint;
  const ref = issue.topicRef;
  if (!ref) return undefined;
  const source = issue.resourceName ?? '';
  switch (issue.code) {
    case 'INACTIVE_TOPIC_REFERENCE':
      return msg.designRuleInactiveTopicReference(source, ref.sourceTopicName, ref.targetResourceName, ref.targetTopicName);
    case 'CROSS_TOPIC_REFERENCE':
      return msg.designRuleCrossTopicReference(ref.sourceTopicName, source, ref.targetTopicName, ref.targetResourceName);
    case 'CROSS_TOPIC_DUPLICATE_EXAMPLE':
      return msg.designRuleCrossTopicDuplicateExample(ref.sourceTopicName, source, ref.targetTopicName, ref.targetResourceName);
    default:
      return undefined;
  }
}

function issueHref(chatbotId: string, issue: DesignIssue): string | null {
  // [No.22] `NO_LIVE_ENTRY_POINT`(대상 CHATBOT)는 개별 리소스가 없다 — 토픽 관리로 바로가기
  // (topic-system-ui-spec.md §3.5). 개별 리소스 id가 없어도 이 한 코드만은 링크를 낸다.
  if (issue.resourceType === 'CHATBOT') return `/chatbots/${chatbotId}/dialogue/topics`;
  if (!issue.resourceId) return null;
  switch (issue.resourceType) {
    case 'NODE':
      return `/chatbots/${chatbotId}/dialogue/nodes/${issue.resourceId}`;
    case 'INTENT':
      return `/chatbots/${chatbotId}/dialogue/intents?resource=intent&edit=${issue.resourceId}`;
    case 'KEYWORD':
      return `/chatbots/${chatbotId}/dialogue/intents?resource=keyword&edit=${issue.resourceId}`;
    case 'CONTEXT':
      return `/chatbots/${chatbotId}/dialogue/contexts/${issue.resourceId}`;
    case 'FAQ':
      return `/chatbots/${chatbotId}/dialogue/faqs?edit=${issue.resourceId}`;
    case 'HOMONYM':
      return `/chatbots/${chatbotId}/dialogue/homonyms?edit=${issue.resourceId}`;
    default:
      return null;
  }
}

/** D1 — 설계 점검 결과 패널(ui-spec §4.1.2, FR-5-16~18). 저장은 막지 않는 순수 진단 도구. */
export function DesignValidationPanel({ chatbotId, report, loading, error, onRetry, onClose }: DesignValidationPanelProps): JSX.Element {
  const msg = MESSAGES.dialogue.validation;
  return (
    <div className="dialogue-panel">
      <div className="dialogue-panel-header">
        <h3 style={{ margin: 0 }}>{msg.title}</h3>
        <button type="button" className="btn btn-secondary" onClick={onClose}>
          {msg.close}
        </button>
      </div>
      {loading && (
        <>
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
        </>
      )}
      {!loading && error && <ErrorState title={msg.loadFailed} onRetry={onRetry} />}
      {!loading && !error && report && (
        <>
          <div className="design-validation-summary">
            <SeverityBadge severity="ERROR" label={msg.errorCount(report.summary.error)} />
            <SeverityBadge severity="WARNING" label={msg.warningCount(report.summary.warning)} />
            <SeverityBadge severity="INFO" label={msg.infoCount(report.summary.info)} />
          </div>
          {report.issues.map((issue, i) => {
            const href = issueHref(chatbotId, issue);
            // [No.22] CHATBOT 대상(NO_LIVE_ENTRY_POINT)은 개별 리소스 편집 링크가 아니라
            // "토픽 관리로 이동" 바로가기다(§3.5) — 링크 라벨을 분기한다.
            const linkLabel = issue.resourceType === 'CHATBOT' ? MESSAGES.topics.designRuleGoToTopics : msg.editLink(issue.resourceName ?? '');
            return (
              <div key={i} className="design-issue-row">
                <SeverityBadge severity={issue.severity} />
                <span style={{ flex: 1 }}>{topicRuleText(issue) ?? issue.message}</span>
                {href && (
                  <div className="design-issue-links">
                    <Link to={href} className="btn btn-secondary">
                      {linkLabel}
                    </Link>
                  </div>
                )}
              </div>
            );
          })}
          {/* [코드 리뷰 1회차 M-4] 규칙별 50건 초과 시 "외 N건" 안내(EX-TP-23). */}
          {report.ruleTotals &&
            Object.entries(report.ruleTotals).map(([code, total]) => {
              const shown = report.issues.filter((i) => i.code === code).length;
              if (total === undefined || total <= shown) return null;
              const label = MESSAGES.topics.designRuleLabel[code] ?? code;
              return (
                <p key={code} className="design-rule-overflow-note field-hint">
                  {label} {MESSAGES.topics.designRuleMoreCount(total - shown)}
                </p>
              );
            })}
          <p className="design-validation-note">{msg.noteText}</p>
        </>
      )}
    </div>
  );
}
