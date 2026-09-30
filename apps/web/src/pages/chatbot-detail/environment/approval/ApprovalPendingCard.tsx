import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { ProdSwitchApprovalSummary } from '@chat-bot/shared-types';
import { switchApprovalsApi } from '../../../../api/switchApprovals';
import { GateResultBadge } from '../../../../components/GateResultBadge';
import { ProposalContainer } from '../../../../components/ProposalContainer';
import { ConfirmDialog } from '../../../../components/Modal';
import { useToast } from '../../../../components/Toast';
import { useAuth } from '../../../../context/AuthContext';
import { MESSAGES } from '../../../../constants/messages';
import { approvalActionLabel, approvalErrorView, approvalSummaryText } from '../../../../lib/approvalText';
import { formatDateTime } from '../../../../lib/date';
import { useMinuteClock } from '../../../../lib/useApprovalPolicy';
import { RemainingTimeText } from './RemainingTimeText';

export interface ApprovalPendingCardProps {
  chatbotId: string;
  request: ProdSwitchApprovalSummary;
  /** 승인 요청을 막 보낸 직후에는 카드 제목으로 포커스를 옮긴다(트리거 버튼이 문구를 바꾸며 사라질 수 있어서다). */
  focusOnMount?: boolean;
  /** 취소·새로 고침 뒤 환경 탭이 정책·요청을 다시 조회한다. */
  onChanged: () => void;
}

/**
 * 환경 탭 대기 요청 카드(`ai-guardrails-ui-spec.md` §9.6) — `ProposalContainer`(제안-자산 분리)로 감싼다. 목록·카드에서 바로 승인하지 않고
 * 반드시 상세(AP-2)에서 다시 확인한다.
 */
export function ApprovalPendingCard({ chatbotId, request, focusOnMount = false, onChanged }: ApprovalPendingCardProps): JSX.Element {
  const msg = MESSAGES.switchApproval.pending;
  const { can } = useAuth();
  const { showToast } = useToast();
  const now = useMinuteClock();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelBanner, setCancelBanner] = useState<string | null>(null);

  useEffect(() => {
    if (focusOnMount) headingRef.current?.focus();
  }, [focusOnMount]);

  const detailHref = `/environment-approvals/${chatbotId}/${request.id}`;
  const canDeploy = can('chatbot:deploy');
  const line = request.action === 'PROD_ROLLBACK' ? msg.rollbackLine(request.target.versionNo, request.base.versionNo) : msg.switchLine(request.target.versionNo, request.base.versionNo);

  async function handleCancel(): Promise<void> {
    setCancelling(true);
    setCancelBanner(null);
    try {
      await switchApprovalsApi.cancel(chatbotId, request.id);
      setCancelOpen(false);
      showToast(MESSAGES.switchApproval.cancelDialog.success);
      onChanged();
      // 카드가 사라지므로 포커스는 승인 설정 패널 제목으로 옮긴다.
      window.setTimeout(() => document.getElementById('approval-policy-title')?.focus(), 0);
    } catch (e) {
      const view = approvalErrorView(e, 'CANCEL');
      setCancelBanner(view.text);
      if (view.kind === 'NOT_PENDING' || view.kind === 'NOT_FOUND') {
        setCancelOpen(false);
        showToast(view.text);
        onChanged();
      }
    } finally {
      setCancelling(false);
    }
  }

  return (
    <ProposalContainer title={msg.title} safetyNotice={msg.safetyNotice}>
      <div className="approval-pending-card">
        <h3 ref={headingRef} tabIndex={-1} id="approval-pending-title">
          {msg.headingLabel}
        </h3>
        <p>
          <strong>{approvalActionLabel(request)}</strong>: {line}{' '}
          <GateResultBadge gate={{ verdict: request.gateVerdict, run: null }} showReason={false} />
        </p>
        <p className="field-hint">{msg.gateLine(request.warningCodes.length, request.diffChangedCount)}</p>
        <p className="guardrail-break">
          {msg.requester(request.requestedBy.email, formatDateTime(request.createdAt))}
          {!request.requestedBy.active && <> {msg.inactiveAccount}</>}
        </p>
        {!request.requestedBy.active && <p className="field-hint">{msg.inactiveHint}</p>}
        <p>
          <RemainingTimeText expiresAt={request.expiresAt} now={now} onRefresh={onChanged} />
        </p>
        {request.reason && <p className="guardrail-break">{msg.reason(request.reason)}</p>}
        <div className="approval-pending-actions">
          {request.canApprove && canDeploy && (
            <Link to={detailHref} className="btn btn-primary">
              {msg.detailApprove}
            </Link>
          )}
          {request.canCancel && canDeploy && (
            <>
              <p className="field-hint">
                <span aria-hidden="true">ⓘ</span> {msg.mine}
              </p>
              <button type="button" className="btn btn-secondary" onClick={() => setCancelOpen(true)}>
                {msg.cancelButton}
              </button>
            </>
          )}
          {!request.canApprove && !request.canCancel && (
            <Link to={detailHref} className="btn btn-secondary">
              {msg.detailOnly}
            </Link>
          )}
        </div>
      </div>

      <ConfirmDialog
        isOpen={cancelOpen}
        title={MESSAGES.switchApproval.cancelDialog.title}
        description={MESSAGES.switchApproval.cancelDialog.desc(approvalSummaryText(request))}
        confirmLabel={cancelling ? MESSAGES.switchApproval.cancelDialog.confirming : MESSAGES.switchApproval.cancelDialog.confirm}
        cancelLabel={MESSAGES.switchApproval.cancelDialog.close}
        danger
        confirmDisabled={cancelling}
        onConfirm={() => void handleCancel()}
        onCancel={() => !cancelling && setCancelOpen(false)}
      >
        {cancelBanner && (
          <p className="modal-banner modal-banner--error" role="alert">
            {cancelBanner}
          </p>
        )}
      </ConfirmDialog>
    </ProposalContainer>
  );
}
