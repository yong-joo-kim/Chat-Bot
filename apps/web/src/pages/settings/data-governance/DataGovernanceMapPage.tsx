import { useCallback, useEffect, useState } from 'react';
import type { GovernanceMapResponse } from '@chat-bot/shared-types';
import { governanceApi } from '../../../api/governance';
import { ErrorState } from '../../../components/ErrorState';
import { SkeletonRow } from '../../../components/Skeleton';
import { AsyncJobProgress } from '../../../components/AsyncJobProgress';
import { CopyButton } from '../../../components/CopyButton';
import { DataGovernanceModeBanner } from '../../../components/DataGovernanceModeBanner';
import { EgressJudgementBadge } from '../../../components/DataGovernanceBadges';
import { MESSAGES } from '../../../constants/messages';
import { formatDateTime } from '../../../lib/date';

/** G1 — 데이터 지도(`/settings/data-governance/map`, `data-governance-ui-spec.md` §3.1). 읽기 전용 1회 조회. */
export function DataGovernanceMapPage(): JSX.Element {
  const msg = MESSAGES.dataGovernance.map;
  const [data, setData] = useState<GovernanceMapResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError(false);
    governanceApi
      .map()
      .then(setData)
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <>
        <SkeletonRow />
        <SkeletonRow />
        <SkeletonRow />
        <SkeletonRow />
        <SkeletonRow />
        <SkeletonRow />
      </>
    );
  }
  if (error || !data) return <ErrorState title={msg.loadFailed} onRetry={load} />;

  return (
    <div className="data-governance-map-page">
      <DataGovernanceModeBanner visible={data.mode === 'OFF'} />

      <section className="settings-card">
        <h2>{msg.modeLabel}</h2>
        <p>
          {msg.modeLabel}: {data.mode === 'ON' ? msg.modeOn : msg.modeOff}
        </p>
        <p>
          {msg.storageLocationLabel}: {data.storage.location}
        </p>
        <p>
          {msg.allowedDirsLabel}: {data.storage.allowedDirs.length > 0 ? data.storage.allowedDirs.join(', ') : msg.residencyNotConfigured}
        </p>
        <p>
          {msg.diskEncryptionLabel}: {data.storage.atRestEncryptionDeclared ? '예' : '아니오'}
        </p>
        <p className="field-hint">{msg.diskEncryptionHint}</p>
      </section>

      <section className="settings-card">
        <h2>{msg.egressSectionTitle}</h2>
        <div className="dialogue-table-wrap">
          <table className="dialogue-table desktop-only">
            <thead>
              <tr>
                <th scope="col">{msg.egressColumnExit}</th>
                <th scope="col">{msg.egressColumnHost}</th>
                <th scope="col">{msg.egressColumnData}</th>
                <th scope="col">{msg.egressColumnMasked}</th>
                <th scope="col">{msg.egressColumnDecision}</th>
              </tr>
            </thead>
            <tbody>
              {data.egress.exits.map((exit) => (
                <tr key={exit.exitId}>
                  <td>{msg.exitLabel[exit.exitId]}</td>
                  <td>{exit.host ?? msg.notConfigured}</td>
                  <td>{msg.dataKindLabel[exit.dataKind]}</td>
                  <td>{msg.maskedLabel[exit.masked]}</td>
                  <td>
                    <EgressJudgementBadge decision={exit.decision} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <ul className="settings-card-list mobile-only">
            {data.egress.exits.map((exit) => (
              <li key={exit.exitId} className="settings-card">
                <div className="settings-card-header">
                  <span className="settings-card-title">{msg.exitLabel[exit.exitId]}</span>
                  <EgressJudgementBadge decision={exit.decision} />
                </div>
                <dl className="settings-card-fields">
                  <div>
                    <dt>{msg.egressColumnHost}</dt>
                    <dd>{exit.host ?? msg.notConfigured}</dd>
                  </div>
                  <div>
                    <dt>{msg.egressColumnData}</dt>
                    <dd>{msg.dataKindLabel[exit.dataKind]}</dd>
                  </div>
                  <div>
                    <dt>{msg.egressColumnMasked}</dt>
                    <dd>{msg.maskedLabel[exit.masked]}</dd>
                  </div>
                </dl>
              </li>
            ))}
          </ul>
        </div>

        {data.egress.legacyConnections.length > 0 && (
          <>
            <h3>{msg.legacyConnectionsSectionTitle}</h3>
            <div className="dialogue-table-wrap">
              <table className="dialogue-table desktop-only">
                <thead>
                  <tr>
                    <th scope="col">{msg.legacyConnectionNameLabel}</th>
                    <th scope="col">{msg.egressColumnHost}</th>
                    <th scope="col">{msg.egressColumnDecision}</th>
                    <th scope="col">{msg.egressColumnBlocked24h}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.egress.legacyConnections.map((conn) => (
                    <tr key={conn.connectionId}>
                      <td>{conn.name}</td>
                      <td>{conn.host}</td>
                      <td>
                        <EgressJudgementBadge decision={conn.decision} />
                      </td>
                      <td>{conn.blockedLast24h}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <ul className="settings-card-list mobile-only">
                {data.egress.legacyConnections.map((conn) => (
                  <li key={conn.connectionId} className="settings-card">
                    <div className="settings-card-header">
                      <span className="settings-card-title">{conn.name}</span>
                      <EgressJudgementBadge decision={conn.decision} />
                    </div>
                    <dl className="settings-card-fields">
                      <div>
                        <dt>{msg.egressColumnHost}</dt>
                        <dd>{conn.host}</dd>
                      </div>
                      <div>
                        <dt>{msg.egressColumnBlocked24h}</dt>
                        <dd>{conn.blockedLast24h}</dd>
                      </div>
                    </dl>
                  </li>
                ))}
              </ul>
            </div>
          </>
        )}

        {data.egress.exits.some((e) => e.rawTextOffHost) &&
          data.egress.exits
            .filter((e) => e.rawTextOffHost && e.host)
            .map((e) => (
              <p key={e.exitId} className="field-hint field-hint--warning">
                <span aria-hidden="true">⚠</span> {msg.rawTextOffHostWarning(e.host as string)}
              </p>
            ))}
      </section>

      <section className="settings-card">
        <h2>{msg.encryptionSectionTitle}</h2>
        <p>
          {msg.encryptionTargetLabel}:{' '}
          {data.encryption.fields.length > 0 ? data.encryption.fields.map((f) => msg.encryptedFieldLabel[f.field]).join(' · ') : '—'}
        </p>
        <p>
          {data.encryption.enabled ? msg.encryptionStatusOn : msg.encryptionStatusOff}
          {data.encryption.writeKeyId && ` · ${msg.encryptionWriteKeyLabel(data.encryption.writeKeyId)}`}
        </p>
        {data.encryption.fields.map((f) => {
          const keyParts = Object.entries(f.byKey)
            .map(([keyId, rows]) => msg.keyRowCountItem(keyId, rows))
            .join(' · ');
          return (
            <div key={f.field}>
              <p>
                {msg.encryptedFieldLabel[f.field]}: {msg.plaintextRemaining(f.plaintextRows)}
              </p>
              {keyParts && <p className="field-hint">{msg.keyRowCountsLabel(keyParts)}</p>}
              {f.unknownKeyRows > 0 && <p className="field-hint field-hint--warning">{msg.unknownKeyRowsWarning(f.unknownKeyRows)}</p>}
            </div>
          );
        })}
        {data.encryption.statsComputedAt && <p className="field-hint">{msg.statsComputedAtLabel(formatDateTime(data.encryption.statsComputedAt))}</p>}
        {data.encryption.passInProgress && <AsyncJobProgress label={msg.backfillInProgress} />}
        <p className="field-hint">{msg.encryptionProtectedScope}</p>
        <p className="field-hint">{msg.encryptionUnprotectedScope}</p>
      </section>

      <section className="settings-card">
        <h2>{msg.retentionSectionTitle}</h2>
        {data.retention.global.map((k) => (
          <p key={k.kind}>
            {MESSAGES.dataGovernance.retention.kindLabels[k.kind]}: {k.days === null ? MESSAGES.dataGovernance.retention.unlimitedDaysLabel : `${k.days}일`}
          </p>
        ))}
        {data.retention.chatbotOverrideCount > 0 && <p>{msg.overrideCountText(data.retention.chatbotOverrideCount)}</p>}
        {data.retention.nextWindowStartAt && <p>{msg.nextWindowText(formatDateTime(data.retention.nextWindowStartAt))}</p>}
        {data.retention.auditMinimumLowered && <p className="field-hint field-hint--warning">{msg.auditMinimumLoweredNotice}</p>}

        <h3>{msg.auditChainSectionTitle}</h3>
        {data.auditChain.head ? (
          <p>
            {msg.auditChainHeadText(data.auditChain.head.seq, data.auditChain.head.hash.slice(0, 12) + '…')}{' '}
            <CopyButton text={data.auditChain.head.hash} />
          </p>
        ) : (
          <p>{msg.auditChainNoneYet}</p>
        )}
        {data.auditChain.lastVerification && <p>{msg.auditChainLastVerifiedText(formatDateTime(data.auditChain.lastVerification.at))}</p>}
      </section>

      <section className="settings-card">
        <h2>{msg.residualRiskSectionTitle}</h2>
        <p>
          {msg.v1TokenSummary(
            data.risks.v1PlainHeaderNodes,
            data.risks.v1PlainHeaderSnapshots ?? 0,
            data.risks.snapshotScanAt ? formatDateTime(data.risks.snapshotScanAt) : '—',
          )}
        </p>
        {data.risks.v1PlainHeaderNodes > 0 && <p className="field-hint">{msg.v1TokenRemovalHint}</p>}
        <p>{msg.rawPersonalDataConnectionsText(data.risks.rawPersonalDataConnections)}</p>
        <p>{msg.externalLlmAugmentationText(data.risks.externalLlmAugmentation)}</p>
        <p>{msg.maskingModeText(data.risks.piiMaskMode)}</p>
      </section>
    </div>
  );
}
