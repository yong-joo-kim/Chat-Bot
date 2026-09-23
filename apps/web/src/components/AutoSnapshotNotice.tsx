import { Link } from 'react-router-dom';
import type { AutoSnapshotOutcome } from '@chat-bot/shared-types';
import { SeverityBadge } from './SeverityBadge';

export interface AutoSnapshotNoticeProps {
  outcome: AutoSnapshotOutcome | undefined;
  chatbotId: string;
  createdText: (versionNo: number) => string;
  viewLinkText: string;
  failedText: string;
}

/**
 * 자동 스냅샷 결과 안내(`version-history-ui-spec.md` §4.5). `outcome` 필드가 없으면(구버전 서버)
 * 또는 `UNCHANGED`/`DISABLED`면 아무것도 렌더하지 않는다(§0-6, §4.5.1 표).
 */
export function AutoSnapshotNotice({ outcome, chatbotId, createdText, viewLinkText, failedText }: AutoSnapshotNoticeProps): JSX.Element | null {
  if (!outcome) return null;
  if (outcome.status === 'CREATED' && outcome.versionNo !== undefined) {
    return (
      <p className="form-banner form-banner--info auto-snapshot-notice" role="status">
        <span aria-hidden="true">✔</span> {createdText(outcome.versionNo)}{' '}
        <Link to={`/chatbots/${chatbotId}/versions`}>{viewLinkText}</Link>
      </p>
    );
  }
  if (outcome.status === 'FAILED') {
    return (
      <p className="form-banner form-banner--warning auto-snapshot-notice" role="status">
        <SeverityBadge severity="WARNING" label={failedText} />
      </p>
    );
  }
  return null;
}
