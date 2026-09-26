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

/**
 * [신규 No.41 2차] 업무 자동화 웹훅 출구 행의 마스킹 라벨은 대상별 정책(각 발송 대상의
 * `allowRawPersonalData`에 따라 다름)이라 `PER_TARGET`("대상별")로 고정 표시한다 — 서버 `exits[]`는
 * 이 값을 싣지 않으므로(기존 `YES|NO|PER_CONNECTION` 중 하나로 내려온다) 렌더링 쪽에서 지정한다.
 */
function maskedLabelFor(exit: GovernanceMapResponse['egress']['exits'][number], msg: typeof MESSAGES.dataGovernance.map): string {
  if (exit.exitId === 'WORKFLOW_WEBHOOK') return msg.maskedLabel.PER_TARGET;
  return msg.maskedLabel[exit.masked];
}

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
                  <td>{maskedLabelFor(exit, msg)}</td>
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
                    <dd>{maskedLabelFor(exit, msg)}</dd>
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

        {/* [신규 No.41] 업무 자동화 웹훅 대상별 하위 목록(§3.10) — 레거시 연결과 같은 펼침 방식.
            대상 0개 설치는 선택 키(`egress.workflowTargets`) 자체가 없어 이 절이 렌더되지 않는다. */}
        {data.egress.workflowTargets && data.egress.workflowTargets.length > 0 && (
          <>
            <h3>{msg.egressWorkflowLabel}</h3>
            <p>{msg.egressWorkflowTargetsHeader(data.egress.workflowTargets.length)}</p>
            <div className="dialogue-table-wrap">
              <table className="dialogue-table desktop-only">
                <thead>
                  <tr>
                    <th scope="col">{msg.legacyConnectionNameLabel}</th>
                    <th scope="col">{msg.egressColumnHost}</th>
                    <th scope="col">{msg.egressColumnData}</th>
                    <th scope="col">{msg.egressColumnDecision}</th>
                    <th scope="col">{msg.egressColumnBlocked24h}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.egress.workflowTargets.map((t) => (
                    <tr key={t.targetId}>
                      <td>{t.name}</td>
                      <td>{t.host}</td>
                      <td>{msg.dataKindLabel.WORKFLOW_PAYLOAD}</td>
                      <td>
                        <EgressJudgementBadge decision={t.decision} />
                      </td>
                      <td>{t.failedLast24h}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <ul className="settings-card-list mobile-only">
                {data.egress.workflowTargets.map((t) => (
                  <li key={t.targetId} className="settings-card">
                    <div className="settings-card-header">
                      <span className="settings-card-title">{t.name}</span>
                      <EgressJudgementBadge decision={t.decision} />
                    </div>
                    <dl className="settings-card-fields">
                      <div>
                        <dt>{msg.egressColumnHost}</dt>
                        <dd>{t.host}</dd>
                      </div>
                      <div>
                        <dt>{msg.egressColumnBlocked24h}</dt>
                        <dd>{t.failedLast24h}</dd>
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
        {/* [신규 No.41] 원문 개인정보 전송 허용 업무 자동화 대상 — 대상 0개면 키 자체가 없다(§9.6). */}
        {data.risks.rawPersonalDataWorkflowTargets !== undefined && (
          <p>{msg.riskRawPersonalDataWorkflowTargets(data.risks.rawPersonalDataWorkflowTargets)}</p>
        )}
        <p>{msg.externalLlmAugmentationText(data.risks.externalLlmAugmentation)}</p>
        <p>{msg.maskingModeText(data.risks.piiMaskMode)}</p>
      </section>

      {/* [신규 No.42] 통합 인박스 카드(§3.12 OI-12) — 고객 0명이면 선택 키 자체가 없어 렌더되지 않는다. */}
      {data.inbox && (
        <section className="settings-card">
          <h2>{msg.inboxCardTitle}</h2>
          <p>{msg.inboxCustomersLine(data.inbox.customers, data.inbox.identifiedCustomers, data.inbox.customers - data.inbox.identifiedCustomers)}</p>
          <p>{msg.inboxThreadsLine(data.inbox.threads, data.inbox.entries)}</p>
          <p>{msg.inboxIdentityLine}</p>
          <p>{msg.inboxDisplayNameEncrypted(data.inbox.displayNameEncrypted)}</p>
          <p>{msg.inboxRetentionLine(data.inbox.retentionDays.INBOX_TEXT, data.inbox.retentionDays.CUSTOMER_IDENTITY)}</p>
        </section>
      )}
    </div>
  );
}
