import type { RestoreBlocker, RestoreWarning, VersionDiffSummaryRow } from '@chat-bot/shared-types';
import { MESSAGES } from '../../../../constants/messages';

/**
 * No.25 `RestoreDialog`의 blockers/warnings/diff요약 렌더 로직을 함수 단위로 추출한 공용 모듈
 * (`scheduled-deploy-ui-spec.md` §13 "함수 단위로 추출해 공유" 인계 — No.28 `ScheduleDeployDialog`의
 * `RESTORE_VERSION` 미리보기가 이 모듈을 그대로 재사용한다). 동작·문구는 원본과 완전히 동일하게 유지한다.
 */
export const KIND_LABELS: Record<string, string> = {
  ...MESSAGES.versions.content.kindTabs,
  INTEGRITY_WARNING: '무결성 경고',
};

export function summaryLine(rows: VersionDiffSummaryRow[]): string {
  const parts: string[] = [];
  for (const row of rows) {
    const label = KIND_LABELS[row.kind] ?? row.kind;
    if (row.added > 0) parts.push(`+ ${label} ${row.added}`);
    if (row.removed > 0) parts.push(`− ${label} ${row.removed}`);
    if (row.modified > 0) parts.push(`~ ${label} ${row.modified}`);
  }
  return parts.join('  ');
}

export function BlockerText({ blocker }: { blocker: RestoreBlocker }): JSX.Element {
  const msg = MESSAGES.versions.restore;
  switch (blocker.code) {
    case 'CHATBOT_ARCHIVED':
      return <>{msg.blockers.CHATBOT_ARCHIVED}</>;
    case 'ACTIVE_JOB':
      return (
        <>
          {blocker.jobs.map((job, i) => (
            <span key={i}>
              {msg.blockers.ACTIVE_JOB(msg.jobKindLabel[job.source], job.progress)}
              {i < blocker.jobs.length - 1 ? ' ' : ''}
            </span>
          ))}
        </>
      );
    case 'SCHEMA_UNSUPPORTED':
      return <>{msg.blockers.SCHEMA_UNSUPPORTED(blocker.schemaVersion)}</>;
    case 'INTEGRITY_FAILED':
      return <>{msg.blockers.INTEGRITY_FAILED(blocker.total)}</>;
    case 'RESTORE_IN_PROGRESS':
      return <>{msg.blockers.RESTORE_IN_PROGRESS}</>;
    case 'NO_CHANGES':
      return <>{msg.blockers.NO_CHANGES}</>;
    default:
      return null as unknown as JSX.Element;
  }
}

export function warningText(warning: RestoreWarning): string {
  const msg = MESSAGES.versions.restore;
  switch (warning.code) {
    case 'ACTIVE_CHATBOT':
      return msg.warnings.ACTIVE_CHATBOT;
    case 'TARGET_INTEGRITY_WARNINGS':
      return msg.warnings.TARGET_INTEGRITY_WARNINGS(warning.count);
    case 'BANNED_WORD_MATCHES':
      return msg.warnings.BANNED_WORD_MATCHES(warning.count);
    case 'PENDING_SUGGESTIONS_ORPHANED':
      return msg.warnings.PENDING_SUGGESTIONS_ORPHANED(warning.count);
    case 'ACCEPTED_SUGGESTIONS_NOT_RESUGGESTED':
      return msg.warnings.ACCEPTED_SUGGESTIONS_NOT_RESUGGESTED(warning.count);
    case 'TEST_CASES_UNRESOLVED':
      return msg.warnings.TEST_CASES_UNRESOLVED(warning.count);
    case 'CLASSIFIER_WILL_BE_DELETED':
      return msg.warnings.CLASSIFIER_WILL_BE_DELETED;
    case 'PROFILE_WILL_CHANGE':
      return msg.warnings.PROFILE_WILL_CHANGE(
        warning.fields.map((f) => (msg.profileFieldLabel as Record<string, string>)[f] ?? f).join(', '),
      );
    case 'RAG_NOT_CONFIGURED':
      return msg.warnings.RAG_NOT_CONFIGURED;
    case 'REINDEX_IN_PROGRESS':
      return msg.warnings.REINDEX_IN_PROGRESS;
    case 'SCHEMA_UPCASTED':
      return msg.warnings.SCHEMA_UPCASTED;
    default:
      return '';
  }
}
