import { useState } from 'react';
import type { InterveneHandoffResponse } from '@chat-bot/shared-types';
import { handoffApi } from '../../api/handoff';
import { ApiError } from '../../api/client';
import { ConfirmDialog } from '../Modal';
import { MESSAGES } from '../../constants/messages';

/**
 * 개입 버튼 + 확인 다이얼로그(hybrid-cs-ui-spec.md §2.2 `InterveneButton`/`InterveneConfirmDialog`).
 * 활성 상담이 있으면 `disabled` + 사유를 병기한다(NFR-CSA6). 개입 CAS 충돌(409)은 호출부의
 * `onConflict`로 위임한다.
 */
export function InterveneButton({
  chatbotId,
  sessionRef,
  disabledReason,
  onSuccess,
  onConflict,
  onError,
}: {
  chatbotId: string;
  sessionRef: string;
  disabledReason?: string;
  onSuccess: (detail: InterveneHandoffResponse) => void;
  onConflict: (message: string) => void;
  onError: (message: string) => void;
}): JSX.Element {
  const msg = MESSAGES.handoffConsole;
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const disabled = Boolean(disabledReason);

  async function handleConfirm(): Promise<void> {
    setSubmitting(true);
    try {
      const detail = await handoffApi.intervene(chatbotId, sessionRef);
      setConfirmOpen(false);
      onSuccess(detail);
    } catch (e) {
      setConfirmOpen(false);
      if (e instanceof ApiError && e.code === 'HANDOFF_ALREADY_ASSIGNED') {
        // 서버 메시지에 이미 담당자명이 포함되어 있다("이미 {name}님이 담당 중입니다.", handoff-thread.service.ts).
        onConflict(e.message || msg.interveneAlreadyAssignedBanner(''));
      } else if (e instanceof ApiError && e.code === 'HANDOFF_SESSION_NOT_LIVE') {
        onConflict(msg.interveneSessionNotLiveBanner);
      } else if (e instanceof ApiError && e.code === 'HANDOFF_DISABLED') {
        onConflict(msg.interveneDisabledBanner);
      } else {
        onError(e instanceof ApiError ? e.message : MESSAGES.errors.generic);
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className="btn btn-primary"
        disabled={disabled}
        aria-disabled={disabled}
        title={disabledReason}
        onClick={() => setConfirmOpen(true)}
      >
        {msg.interveneButton}
      </button>
      {disabled && disabledReason && <span className="field-hint">{disabledReason}</span>}
      <ConfirmDialog
        isOpen={confirmOpen}
        title={msg.interveneConfirmTitle}
        description={msg.interveneConfirmDesc}
        confirmLabel={msg.interveneButton}
        onConfirm={() => void handleConfirm()}
        onCancel={() => setConfirmOpen(false)}
        confirmDisabled={submitting}
      />
    </>
  );
}
