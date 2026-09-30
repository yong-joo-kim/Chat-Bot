import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { EnvironmentGateSettings, ProdSwitchPreviewResponse, ProdSwitchResponse } from '@chat-bot/shared-types';
import { ENVIRONMENT_LIMITS } from '@chat-bot/shared-types';
import { Modal } from '../../../components/Modal';
import { GateResultBadge } from '../../../components/GateResultBadge';
import { MESSAGES } from '../../../constants/messages';
import { ApiError } from '../../../api/client';
import { environmentApi } from '../../../api/environment';
import { switchApprovalsApi } from '../../../api/switchApprovals';
import { SeverityBadge } from '../../../components/SeverityBadge';
import { approvalErrorView } from '../../../lib/approvalText';
import { summaryLine } from '../versions/restore/restorePreviewText';
import { displayGate, effectiveSwitchBlockers, isRollbackGateRelaxed } from './lib/rollbackGate';
import { SwitchBlockerText, SwitchWarningText, type ProdSwitchBlockerCode } from './lib/switchPreviewText';

export interface ProdSwitchDialogProps {
  chatbotId: string;
  kind: 'SWITCH' | 'ROLLBACK';
  /** SWITCH는 필수, ROLLBACK은 생략 가능(서버가 `pickRollbackTarget`으로 자동 계산). */
  targetVersionId?: string;
  isOpen: boolean;
  onClose: () => void;
  onSwitched: (result: ProdSwitchResponse) => void;
  /** 게이트 사유 문구의 기준값(minPassRate·validHours) 표기용 — `EnvironmentStatusPanel`이 넘긴다. */
  gateSettings?: EnvironmentGateSettings;
  /** [신규 No.36] 요청 모드 안내문에 넣을 승인 유효 시간(시간). 모르면 생략 — "정해진 시간 안에"로 표기한다. */
  approvalTtlHours?: number | null;
  /** [신규 No.36] 승인 요청을 보낸 뒤(요청 모드) 호출된다. 생략하면 대화상자만 닫는다. */
  onRequested?: () => void;
}

/**
 * EN1-d 운영 전환·롤백 공용(`environment-separation-ui-spec.md` §4.6).
 * [신규 No.36] 미리보기 응답의 `approval` 키(2인 승인이 켜졌을 때만 존재)로 모드를 정한다 — 키가 없으면 기존 동작과 같다.
 * 요청 모드(운영 전환·직전 아닌 롤백)는 승인 요청을 보내고, 단독 롤백 모드(직전 운영 버전 롤백)는 승인 없이 바로 되돌린다.
 */
export function ProdSwitchDialog({ chatbotId, kind, targetVersionId, isOpen, onClose, onSwitched, gateSettings, approvalTtlHours = null, onRequested }: ProdSwitchDialogProps): JSX.Element {
  const msg = MESSAGES.environment.switchDialog;
  const apMsg = MESSAGES.switchApproval.dialog;
  const [forceRequest, setForceRequest] = useState(false);
  const [soloAck, setSoloAck] = useState(false);
  const [soloAckError, setSoloAckError] = useState(false);
  const [pendingRequestId, setPendingRequestId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [preview, setPreview] = useState<ProdSwitchPreviewResponse | null>(null);
  const [acknowledgeWarnings, setAcknowledgeWarnings] = useState(false);
  const [ackError, setAckError] = useState(false);
  const [reason, setReason] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);

  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const fetchPreview = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const res = await environmentApi.prodPreview(chatbotId, { kind, targetVersionId });
      if (!isMountedRef.current) return;
      setPreview(res);
    } catch {
      if (!isMountedRef.current) return;
      setLoadError(true);
    } finally {
      if (isMountedRef.current) setLoading(false);
    }
  }, [chatbotId, kind, targetVersionId]);

  useEffect(() => {
    if (!isOpen) return;
    setAcknowledgeWarnings(false);
    setAckError(false);
    setReason('');
    setBanner(null);
    setForceRequest(false);
    setSoloAck(false);
    setSoloAckError(false);
    setPendingRequestId(null);
    void fetchPreview();
  }, [isOpen, fetchPreview]);

  // [신규 No.36] 모드 판정 — `approval` 키가 없으면 기존(둘 다 false).
  const approvalRequired = preview?.approval?.required === true;
  const soloRollback = kind === 'ROLLBACK' && approvalRequired && preview?.approval?.soloRollbackAllowed === true && !forceRequest;
  const requestMode = approvalRequired && !soloRollback;

  async function handleRequest(): Promise<void> {
    if (!preview || confirming) return;
    if (preview.warnings.length > 0 && !acknowledgeWarnings) {
      setAckError(true);
      return;
    }
    setConfirming(true);
    setBanner(null);
    setPendingRequestId(null);
    try {
      const common = {
        expectedProdVersionId: preview.expectedProdVersionId,
        acknowledgeWarnings: preview.warnings.length > 0 ? acknowledgeWarnings : undefined,
        reason: reason.trim() ? reason.trim() : undefined,
      };
      await switchApprovalsApi.createRequest(
        chatbotId,
        kind === 'SWITCH'
          ? { action: 'PROD_SWITCH', targetVersionId: preview.target.versionId, ...common }
          : { action: 'PROD_ROLLBACK', targetVersionId: preview.target.versionId, ...common },
      );
      if (!isMountedRef.current) return;
      if (onRequested) onRequested();
      else onClose();
    } catch (e) {
      if (!isMountedRef.current) return;
      const view = approvalErrorView(e, 'REQUEST');
      setBanner(view.text);
      if (view.kind === 'PENDING_EXISTS') setPendingRequestId(view.requestId ?? null);
      if (view.kind === 'STALE' || view.kind === 'POLICY_UNAVAILABLE') await fetchPreview();
    } finally {
      if (isMountedRef.current) setConfirming(false);
    }
  }

  function handleClose(): void {
    if (confirming) return;
    onClose();
  }

  async function handleConfirm(): Promise<void> {
    if (!preview || confirming) return;
    if (preview.warnings.length > 0 && !acknowledgeWarnings) {
      setAckError(true);
      return;
    }
    // [신규 No.36] 단독 롤백은 중첩 대화상자 대신 필수 체크로 확인한다(조정 A-5).
    if (soloRollback && !soloAck) {
      setSoloAckError(true);
      return;
    }
    setConfirming(true);
    setBanner(null);
    try {
      const dto = {
        targetVersionId: preview.target.versionId,
        expectedProdVersionId: preview.expectedProdVersionId,
        acknowledgeWarnings: preview.warnings.length > 0 ? acknowledgeWarnings : undefined,
        reason: reason.trim() ? reason.trim() : undefined,
      };
      const res = kind === 'SWITCH' ? await environmentApi.prodSwitch(chatbotId, dto) : await environmentApi.prodRollback(chatbotId, dto);
      if (!isMountedRef.current) return;
      onSwitched(res);
    } catch (e) {
      if (!isMountedRef.current) return;
      if (e instanceof ApiError && (e.code === 'ENV_POINTER_STALE' || e.code === 'ENV_SWITCH_BUSY' || e.code === 'ENV_TARGET_NOT_STAGING')) {
        setBanner(MESSAGES.environment.errors[e.code]);
        await fetchPreview();
      } else if (e instanceof ApiError && e.code === 'ENV_GATE_NOT_PASSED') {
        setBanner(MESSAGES.environment.errors.ENV_GATE_NOT_PASSED);
        await fetchPreview();
      } else if (e instanceof ApiError && e.code === 'ENV_APPROVAL_REQUIRED') {
        // [신규 No.36] 열려 있던 대화상자가 정책을 모르던 경우 — 안내 후 미리보기를 다시 조회해 요청 모드로 전환한다
        // (사유·경고 확인 체크는 유지되고, 자동으로 요청을 보내지 않는다 — 한 번 더 확정 버튼을 눌러야 한다).
        setBanner(approvalErrorView(e, 'REQUEST').text);
        await fetchPreview();
      } else {
        setBanner(e instanceof ApiError ? e.message : MESSAGES.errors.generic);
      }
    } finally {
      if (isMountedRef.current) setConfirming(false);
    }
  }

  const title = soloRollback
    ? apMsg.soloTitle
    : requestMode
      ? kind === 'SWITCH'
        ? apMsg.requestTitleSwitch
        : apMsg.requestTitleRollback
      : kind === 'SWITCH'
        ? msg.titleSwitch
        : msg.titleRollback;
  const isNoop = preview?.outcome === 'NOOP';
  // FR-EN4-4: 직전 운영 버전으로의 롤백(directRollback)에서만 게이트 BLOCK을 경고로 취급한다(긴급 복귀 우선).
  // [N40-1] 직전이 아닌 이력 버전(directRollback=false)은 일반 전환과 같은 게이트가 적용되어 차단이 유지된다.
  const gateRelaxed = isRollbackGateRelaxed(kind === 'ROLLBACK', preview?.directRollback);
  const effectiveBlockers = effectiveSwitchBlockers(preview?.blockers ?? [], gateRelaxed);
  const hasBlockers = effectiveBlockers.length > 0;

  return (
    <Modal isOpen={isOpen} title={title} onClose={handleClose} closeOnEsc={!confirming} initialFocusSelector='[data-autofocus="cancel"]'>
      {loading && (
        <p role="status" aria-live="polite">
          {msg.previewLoading}
        </p>
      )}
      {!loading && loadError && (
        <p className="modal-banner modal-banner--error" role="alert">
          {msg.loadFailed}
        </p>
      )}
      {!loading && !loadError && preview && (
        <div>
          {banner && (
            <p className="modal-banner modal-banner--warning" role="status" aria-live="polite">
              {banner}
              {pendingRequestId && (
                <>
                  {' '}
                  <Link to={`/environment-approvals/${chatbotId}/${pendingRequestId}`}>{apMsg.pendingExistsLink}</Link>
                </>
              )}
            </p>
          )}

          {/* [신규 No.36] 요청 모드·단독 롤백 모드 안내(ui-spec §9.4) — 승인 정책이 꺼져 있으면(approval 키 없음) 렌더하지 않는다. */}
          {!isNoop && requestMode && (
            <p className="modal-banner modal-banner--info">
              {kind === 'ROLLBACK' ? apMsg.rollbackRequestInfo : apMsg.requestInfo(approvalTtlHours)}
            </p>
          )}
          {!isNoop && soloRollback && (
            <p className="modal-banner modal-banner--info">
              <SeverityBadge severity="WARNING" label={apMsg.soloBadge} /> {apMsg.soloInfo}
            </p>
          )}

          {isNoop ? (
            <p>{msg.outcomeNoop}</p>
          ) : (
            <>
              <p>{msg.currentToTarget(preview.current.versionNo, preview.target.versionNo)}</p>
              <p className="restore-diff-summary">{summaryLine(preview.diffSummary.rows)}</p>

              <p>
                <GateResultBadge gate={displayGate(preview.gate, gateRelaxed)} settings={gateSettings} />
              </p>

              {hasBlockers ? (
                <ul className="restore-blocker-list">
                  {effectiveBlockers.map((b, i) => (
                    <li key={i}>
                      <span aria-hidden="true">⚠</span> {SwitchBlockerText(b as ProdSwitchBlockerCode, preview.gate, gateSettings)}
                      {b === 'GATE_CONFIG_ERROR' && (
                        <>
                          {' '}
                          {/* [신규 No.40 — §4.6(c), R1 M-1] `?openGate=1`로 이동하면 EN1이 게이트 설정 섹션을 펼친
                              채로 보여준다(쿼리 파라미터로 상태 전달). `Link`로 SPA 내 이동만 수행해 전체 새로고침을
                              피한다 — 같은 라우트(`EnvironmentTab`)가 `useSearchParams()`로 값을 읽으므로 전체 이동이
                              필요하지 않다. */}
                          <Link to={`/chatbots/${chatbotId}/environment?openGate=1`}>{msg.gateGoToSettingsLink}</Link>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                preview.warnings.length > 0 && (
                  <div className="restore-warning-block">
                    <p className="restore-warning-heading">{msg.warningsHeading}</p>
                    <ul className="restore-warning-list">
                      {preview.warnings.map((w, i) => (
                        <li key={i}>{SwitchWarningText(w, gateSettings)}</li>
                      ))}
                    </ul>
                  </div>
                )
              )}

              {!hasBlockers && preview.warnings.length > 0 && (
                <label className="restore-ack-checkbox" id="switch-ack-warnings-label">
                  <input type="checkbox" checked={acknowledgeWarnings} onChange={(e) => { setAcknowledgeWarnings(e.target.checked); setAckError(false); }} />
                  {msg.acknowledgeLabel}
                </label>
              )}
              {ackError && (
                <p className="field-error" role="alert">
                  {msg.acknowledgeError}
                </p>
              )}

              {!hasBlockers && (
                <div className="form-field">
                  <label htmlFor="prod-switch-reason">{msg.reasonLabel}</label>
                  <textarea
                    id="prod-switch-reason"
                    value={reason}
                    maxLength={ENVIRONMENT_LIMITS.reasonMaxCodePoints}
                    onChange={(e) => setReason(e.target.value)}
                  />
                  <p className="char-counter">{msg.reasonCount(Array.from(reason).length, ENVIRONMENT_LIMITS.reasonMaxCodePoints)}</p>
                </div>
              )}

              {!hasBlockers && soloRollback && (
                <div>
                  <label className="restore-ack-checkbox" id="switch-solo-ack-label">
                    <input
                      type="checkbox"
                      checked={soloAck}
                      onChange={(e) => {
                        setSoloAck(e.target.checked);
                        setSoloAckError(false);
                      }}
                    />
                    {apMsg.soloAck}
                  </label>
                  {soloAckError && (
                    <p className="field-error" role="alert">
                      {apMsg.soloAckError}
                    </p>
                  )}
                </div>
              )}
            </>
          )}

          <div className="modal-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={confirming} data-autofocus="cancel">
              {isNoop || hasBlockers ? msg.confirmedButtonOnly : msg.cancelButton}
            </button>
            {!isNoop && !hasBlockers && soloRollback && (
              <button type="button" className="btn btn-secondary" onClick={() => setForceRequest(true)} disabled={confirming}>
                {apMsg.soloAlternative}
              </button>
            )}
            {!isNoop && !hasBlockers && (
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void (requestMode ? handleRequest() : handleConfirm())}
                disabled={confirming}
                aria-disabled={confirming}
                aria-describedby={ackError ? 'switch-ack-warnings-label' : soloAckError ? 'switch-solo-ack-label' : undefined}
              >
                {confirming
                  ? requestMode
                    ? apMsg.requesting
                    : msg.confirming
                  : requestMode
                    ? kind === 'SWITCH'
                      ? apMsg.requestConfirmSwitch(preview.target.versionNo)
                      : apMsg.requestConfirmRollback(preview.target.versionNo)
                    : soloRollback
                      ? apMsg.soloConfirm(preview.target.versionNo)
                      : kind === 'SWITCH'
                        ? msg.confirmButtonSwitch(preview.target.versionNo)
                        : msg.confirmButtonRollback(preview.target.versionNo)}
              </button>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
