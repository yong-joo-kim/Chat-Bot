import type { KbDocumentView } from '@chat-bot/shared-types';
import { formatDateTime } from '../../../lib/date';
import { CopyButton } from '../../../components/CopyButton';
import { MESSAGES } from '../../../constants/messages';
import { KbCleanupReasonBadge, KbDocumentStateBadge, KbExcludeReasonBadge } from './badges';

function titleOf(doc: KbDocumentView): string {
  return doc.title ? `${doc.title} (${doc.displayUrl})` : doc.displayUrl;
}

function fileNameCell(doc: KbDocumentView, copyLabel: string) {
  if (!doc.externalFileName) return '—';
  return (
    <>
      {doc.externalFileName} <CopyButton text={doc.externalFileName} label={copyLabel} />
    </>
  );
}

/**
 * KB5 — 문서 목록 표(`kb-crawling-ui-spec.md` §3.5 레이아웃 · §9 반응형). 열이 6개로 많아 모바일
 * (≤640px)에서는 카드형으로 전환하고 "정리 필요"·"제외 사유"만 상단 배지로 강조, 나머지는 `<dl>`로
 * 접는다(DataGovernanceMapPage `desktop-only`/`mobile-only` 선례).
 */
export function KbDocumentTable({ items }: { items: KbDocumentView[] }): JSX.Element {
  const msg = MESSAGES.kbDocuments;
  return (
    <>
      <table className="dialogue-table desktop-only">
        <caption className="sr-only">{`${msg.columnUrl} — 총 ${items.length}건`}</caption>
        <thead>
          <tr>
            <th scope="col">{msg.columnUrl}</th>
            <th scope="col">{msg.columnState}</th>
            <th scope="col">{msg.columnCleanup}</th>
            <th scope="col">{msg.columnLastChanged}</th>
            <th scope="col">{msg.columnLastIngested}</th>
            <th scope="col">{msg.columnFileName}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((doc) => (
            <tr key={doc.id}>
              <td>{titleOf(doc)}</td>
              <td>
                <KbDocumentStateBadge state={doc.state} />
                {doc.excludeReason && <KbExcludeReasonBadge reason={doc.excludeReason} />}
              </td>
              <td>{doc.cleanupReason ? <KbCleanupReasonBadge reason={doc.cleanupReason} /> : '—'}</td>
              <td>{formatDateTime(doc.lastSeenAt)}</td>
              <td>{doc.lastIngestedAt ? formatDateTime(doc.lastIngestedAt) : '—'}</td>
              <td>{fileNameCell(doc, msg.copyFileName)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <ul className="settings-card-list mobile-only">
        {items.map((doc) => (
          <li key={doc.id} className="settings-card">
            <div className="settings-card-header">
              <span className="settings-card-title">{titleOf(doc)}</span>
            </div>
            <div className="api-connection-badge-row">
              <KbDocumentStateBadge state={doc.state} />
              {doc.cleanupReason && <KbCleanupReasonBadge reason={doc.cleanupReason} />}
              {doc.excludeReason && <KbExcludeReasonBadge reason={doc.excludeReason} />}
            </div>
            <dl className="settings-card-fields">
              <div>
                <dt>{msg.columnLastChanged}</dt>
                <dd>{formatDateTime(doc.lastSeenAt)}</dd>
              </div>
              <div>
                <dt>{msg.columnLastIngested}</dt>
                <dd>{doc.lastIngestedAt ? formatDateTime(doc.lastIngestedAt) : '—'}</dd>
              </div>
              <div>
                <dt>{msg.columnFileName}</dt>
                <dd>{fileNameCell(doc, msg.copyFileName)}</dd>
              </div>
            </dl>
          </li>
        ))}
      </ul>
    </>
  );
}
