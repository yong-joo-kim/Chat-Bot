import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { EnvironmentGateSettings, ProdSwitchPreviewResponse, ProdSwitchResponse } from '@chat-bot/shared-types';
import { ENVIRONMENT_LIMITS } from '@chat-bot/shared-types';
import { Modal } from '../../../components/Modal';
import { GateResultBadge } from '../../../components/GateResultBadge';
import { MESSAGES } from '../../../constants/messages';
import { ApiError } from '../../../api/client';
import { environmentApi } from '../../../api/environment';
import { summaryLine } from '../versions/restore/restorePreviewText';
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
}

/** EN1-d 운영 전환·롤백 공용(`environment-separation-ui-spec.md` §4.6). */
export function ProdSwitchDialog({ chatbotId, kind, targetVersionId, isOpen, onClose, onSwitched, gateSettings }: ProdSwitchDialogProps): JSX.Element {
  const msg = MESSAGES.environment.switchDialog;
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
    void fetchPreview();
  }, [isOpen, fetchPreview]);

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
      } else {
        setBanner(e instanceof ApiError ? e.message : MESSAGES.errors.generic);
      }
    } finally {
      if (isMountedRef.current) setConfirming(false);
    }
  }

  const title = kind === 'SWITCH' ? msg.titleSwitch : msg.titleRollback;
  const isNoop = preview?.outcome === 'NOOP';
  // FR-EN4-4: 롤백에서는 게이트 BLOCK도 경고로만 취급 — 확정 버튼을 막지 않는다(긴급 복귀 우선).
  const effectiveBlockers = (preview?.blockers ?? []).filter((b) => !(kind === 'ROLLBACK' && b === 'GATE_BLOCKED'));
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
            </p>
          )}

          {isNoop ? (
            <p>{msg.outcomeNoop}</p>
          ) : (
            <>
              <p>{msg.currentToTarget(preview.current.versionNo, preview.target.versionNo)}</p>
              <p className="restore-diff-summary">{summaryLine(preview.diffSummary.rows)}</p>

              <p>
                <GateResultBadge gate={kind === 'ROLLBACK' ? { ...preview.gate, verdict: preview.gate.verdict === 'BLOCK' ? 'WARN' : preview.gate.verdict } : preview.gate} settings={gateSettings} />
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
            </>
          )}

          <div className="modal-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={confirming} data-autofocus="cancel">
              {isNoop || hasBlockers ? msg.confirmedButtonOnly : msg.cancelButton}
            </button>
            {!isNoop && !hasBlockers && (
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void handleConfirm()}
                disabled={confirming}
                aria-disabled={confirming}
                aria-describedby={ackError ? 'switch-ack-warnings-label' : undefined}
              >
                {confirming ? msg.confirming : kind === 'SWITCH' ? msg.confirmButtonSwitch(preview.target.versionNo) : msg.confirmButtonRollback(preview.target.versionNo)}
              </button>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
