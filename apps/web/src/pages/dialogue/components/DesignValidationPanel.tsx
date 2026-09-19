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

function issueHref(chatbotId: string, issue: DesignIssue): string | null {
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
            return (
              <div key={i} className="design-issue-row">
                <SeverityBadge severity={issue.severity} />
                <span style={{ flex: 1 }}>{issue.message}</span>
                {href && (
                  <div className="design-issue-links">
                    <Link to={href} className="btn btn-secondary">
                      {msg.editLink(issue.resourceName ?? '')}
                    </Link>
                  </div>
                )}
              </div>
            );
          })}
          <p className="design-validation-note">{msg.noteText}</p>
        </>
      )}
    </div>
  );
}
