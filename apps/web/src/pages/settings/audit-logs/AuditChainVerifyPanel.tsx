import { useState } from 'react';
import { auditLogsApi } from '../../../api/auditLogs';
import { ApiError } from '../../../api/client';
import { AsyncJobProgress } from '../../../components/AsyncJobProgress';
import { CopyButton } from '../../../components/CopyButton';
import { DateRangeField } from '../../../components/DateRangeField';
import { ChainVerifyResultBadge } from '../../../components/DataGovernanceBadges';
import { MESSAGES } from '../../../constants/messages';
import { addDaysToDateInputValue, kstTodayDateInputValue } from '../../../lib/date';
import type { AuditChainVerifyResponse } from '@chat-bot/shared-types';

/** G3 — 감사 해시 체인 무결성 검증 접이식 섹션(`data-governance-ui-spec.md` §3.5). 기본은 접힘. */
export function AuditChainVerifyPanel(): JSX.Element {
  const msg = MESSAGES.dataGovernance.chainVerify;
  const [expanded, setExpanded] = useState(false);
  const [from, setFrom] = useState(addDaysToDateInputValue(kstTodayDateInputValue(), -29));
  const [to, setTo] = useState(kstTodayDateInputValue());
  const [verifying, setVerifying] = useState(false);
  const [result, setResult] = useState<AuditChainVerifyResponse | null>(null);
  const [rangeError, setRangeError] = useState<string | undefined>();

  async function handleVerify(): Promise<void> {
    setVerifying(true);
    setRangeError(undefined);
    setResult(null);
    try {
      const res = await auditLogsApi.verify({ from: from ? new Date(from) : undefined, to: to ? new Date(to) : undefined });
      setResult(res);
    } catch (e) {
      if (e instanceof ApiError && (e.code === 'AUDIT_RANGE_TOO_WIDE' || e.code === 'INVALID_PERIOD')) {
        setRangeError(e.message);
      }
    } finally {
      setVerifying(false);
    }
  }

  return (
    <div className="audit-chain-verify-panel settings-card">
      <button type="button" className="link-button" aria-expanded={expanded} onClick={() => setExpanded((v) => !v)}>
        <span aria-hidden="true">{expanded ? '▾' : '▸'}</span> {msg.sectionTitle}
      </button>
      {expanded && (
        <div className="audit-chain-verify-body">
          <div className="dialogue-toolbar">
            <DateRangeField from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} maxRangeDays={90} errorMessage={rangeError} />
            <button type="button" className="btn btn-primary" onClick={() => void handleVerify()} disabled={verifying}>
              {msg.verifyButton}
            </button>
          </div>

          {verifying && <AsyncJobProgress label={msg.verifying} />}

          {!verifying && result && (
            <div className="audit-chain-verify-result">
              <p>
                <ChainVerifyResultBadge status={result.status} /> {msg.checkedRowsText(result.checkedRows)}
                {result.preChainRows > 0 && ` · ${msg.preChainRowsText(result.preChainRows)}`}
              </p>
              {result.head && (
                <p>
                  {msg.headText(result.head.seq, result.head.hash.slice(0, 12) + '…')} <CopyButton text={result.head.hash} />
                </p>
              )}
              {result.firstBadSeq !== undefined && <p>{msg.mismatchDetail(result.firstBadSeq)}</p>}
              <p className="field-hint">{msg.guaranteeScopeNotice}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
