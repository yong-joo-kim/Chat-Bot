import type { AuditLogDetail } from '@chat-bot/shared-types';
import { MESSAGES } from '../../../constants/messages';
import { CopyButton } from '../../../components/CopyButton';

/**
 * [신규 No.45] 체인 정보 소절(`chain?` 값이 있을 때만) — 앞 12자 + 전체 복사 버튼 방식(2026-09-26 PM
 * 확정 §13-4, data-governance-ui-spec.md §3.5).
 */
function AuditChainInfo({ chain }: { chain: NonNullable<AuditLogDetail['chain']> }): JSX.Element {
  const msg = MESSAGES.auditLogs;
  return (
    <div className="audit-chain-info">
      <h3>{msg.chainInfoTitle}</h3>
      <p>
        {msg.chainSeqLabel}: {chain.seq}
      </p>
      <p>
        {msg.chainPrevHashLabel}: <code>{chain.prevHash.slice(0, 12)}…</code>{' '}
        <CopyButton text={chain.prevHash} label={msg.copyPrevHashLabel} />
      </p>
      <p>
        {msg.chainRowHashLabel}: <code>{chain.rowHash.slice(0, 12)}…</code>{' '}
        <CopyButton text={chain.rowHash} label={msg.copyRowHashLabel} />
      </p>
      <p>{chain.method === 'HMAC' ? msg.chainMethodSigned : msg.chainMethodUnsigned}</p>
    </div>
  );
}

/** §3.9 `AuditDiffTable` — `changedFields`만 좌/우로 렌더한다. */
function AuditDiffTable({ detail }: { detail: AuditLogDetail }): JSX.Element {
  const msg = MESSAGES.auditLogs;
  const fields = detail.changedFields.length > 0 ? detail.changedFields : [...new Set([...Object.keys(detail.before ?? {}), ...Object.keys(detail.after ?? {})])];

  return (
    <div className="audit-diff-table">
      <div className="audit-diff-columns">
        <div>
          <h3>{msg.beforeLabel}</h3>
          {detail.before === null ? (
            <p className="field-hint">—</p>
          ) : (
            <dl>
              {fields.map((f) => (
                <div key={f} className="key-value-row">
                  <dt>{f}</dt>
                  <dd>{formatValue(detail.before?.[f])}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
        <div>
          <h3>{msg.afterLabel}</h3>
          {detail.after === null ? (
            <p className="field-hint">{msg.deletedValue}</p>
          ) : (
            <dl>
              {fields.map((f) => (
                <div key={f} className="key-value-row">
                  <dt>{f}</dt>
                  <dd>{formatValue(detail.after?.[f])}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      </div>
      {detail.summary && <p className="field-hint">{detail.summary}</p>}
      {detail.truncated && <p className="field-hint">{msg.truncatedNotice}</p>}
    </div>
  );
}

function formatValue(v: unknown): string {
  if (v === undefined) return '—';
  if (v === null) return 'null';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

/** 대량 작업(`IMPORT`/`BULK_DELETE`) 전용 렌더러 — `afterValue.{created,updated,deleted,targetIds,truncated}`. */
function AuditBulkSummary({ detail }: { detail: AuditLogDetail }): JSX.Element {
  const msg = MESSAGES.auditLogs;
  const after = (detail.after ?? {}) as Record<string, unknown>;
  const targetIds = Array.isArray(after.targetIds) ? (after.targetIds as string[]) : [];

  return (
    <div className="audit-bulk-summary">
      {detail.summary && <p>{detail.summary}</p>}
      <ul>
        {typeof after.created === 'number' && <li>{msg.bulkCreated(after.created)}</li>}
        {typeof after.updated === 'number' && <li>{msg.bulkUpdated(after.updated)}</li>}
        {typeof after.deleted === 'number' && <li>{msg.bulkDeleted(after.deleted)}</li>}
      </ul>
      {targetIds.length > 0 && (
        <p className="field-hint">
          {msg.bulkTargetIdsLabel(50)}: {targetIds.join(', ')}
          {after.truncated ? ` (${msg.truncatedNotice})` : ''}
        </p>
      )}
    </div>
  );
}

/** 인증 이력(`Session` 대상) 전용 — `ip`/`userAgent`만 표시. */
function AuditSessionMeta({ detail }: { detail: AuditLogDetail }): JSX.Element {
  const msg = MESSAGES.auditLogs;
  return (
    <div className="audit-session-meta">
      <p>
        {msg.ipLabel}: {detail.ip ?? '—'}
      </p>
      <p>
        {msg.userAgentLabel}: {detail.userAgent ?? '—'}
      </p>
    </div>
  );
}

/**
 * A1 상세 확장 렌더러(security-audit-ui-spec.md §3.9.2). 응답 성격에 따라 3분기한다.
 * `PERMISSION_DENIED`는 `summary` 텍스트 한 줄만 보여준다(IP/UA보다 사유가 우선).
 */
export function AuditLogDetailPanel({ detail }: { detail: AuditLogDetail }): JSX.Element {
  let body: JSX.Element;
  if (detail.action === 'PERMISSION_DENIED') {
    body = <p className="field-hint">{detail.summary}</p>;
  } else if (detail.targetType === 'Session') {
    body = <AuditSessionMeta detail={detail} />;
  } else if (detail.action === 'IMPORT' || detail.action === 'BULK_DELETE') {
    body = <AuditBulkSummary detail={detail} />;
  } else {
    body = <AuditDiffTable detail={detail} />;
  }
  return (
    <>
      {body}
      {/* [신규 No.45] 체인 도입 후 행만(§3.5) */}
      {detail.chain && <AuditChainInfo chain={detail.chain} />}
    </>
  );
}
