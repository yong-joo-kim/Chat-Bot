import type { RagConnectionCheckResult } from '@chat-bot/shared-types';
import { formatDateTime } from '../../../lib/date';
import { MESSAGES } from '../../../constants/messages';

/** 연결 상태 배지(4상태 — 미확인/정상/사용 불가/문서 0건, ui-spec §4.1). */
export function ConnectionStatusBadge({ connection }: { connection: RagConnectionCheckResult | null }): JSX.Element {
  const msg = MESSAGES.answerSettings.rag;

  if (!connection || connection.upstreamStatus === 'NOT_CONFIGURED') {
    return (
      <span className="connection-status-badge">
        <span aria-hidden="true">ⓘ</span> {msg.connectionStatus.NOT_CONFIGURED}
      </span>
    );
  }

  const checkedAt = formatDateTime(connection.checkedAt);
  if (connection.upstreamStatus === 'UNAVAILABLE') {
    return (
      <span className="connection-status-badge connection-status-badge--error">
        <span aria-hidden="true">⚠</span> {msg.connectionStatus.UNAVAILABLE(checkedAt)}
      </span>
    );
  }

  const zeroScope = connection.scopeChunkCount === 0;
  return (
    <span className="connection-status-badge connection-status-badge--ok">
      <span aria-hidden="true">✔</span>{' '}
      {zeroScope ? `적재된 문서 0건 · 방금 확인` : msg.connectionStatus.OK(checkedAt)}
    </span>
  );
}
