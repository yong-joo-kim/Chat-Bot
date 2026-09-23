import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { TestCaseSet } from '@chat-bot/shared-types';
import { ApiError } from '../../../api/client';
import { testSetsApi, testRunsApi } from '../../../api/validation';
import { MESSAGES } from '../../../constants/messages';
import { AugmentationImpactSetPickerDialog } from './AugmentationImpactSetPickerDialog';

export interface AugmentationImpactCheckButtonProps {
  chatbotId: string;
  intentId: string;
  selectedIds: string[];
}

/**
 * A1x — "선택 항목 영향도 검사"(ui-spec §4.6, FR-V3-3). `AugmentationBulkActionBar`에서
 * "선택 예문으로 추가"보다 왼쪽에 배치한다 — 비파괴적 검사가 파괴적 확정(승인)보다 먼저 눈에 띄어야
 * S-1의 "승인 전에 본다" 습관이 형성된다.
 */
export function AugmentationImpactCheckButton({ chatbotId, intentId, selectedIds }: AugmentationImpactCheckButtonProps): JSX.Element {
  const navigate = useNavigate();
  const msg = MESSAGES.validation.augmentationImpact;
  const [open, setOpen] = useState(false);
  const [sets, setSets] = useState<TestCaseSet[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | undefined>(undefined);

  async function handleOpen(): Promise<void> {
    setErrorMessage(undefined);
    setOpen(true);
    try {
      const res = await testSetsApi.list(chatbotId, { pageSize: 20 });
      setSets(res.items);
    } catch {
      setSets([]);
    }
  }

  async function handleStart(setId: string, useRag: boolean): Promise<void> {
    setSubmitting(true);
    setErrorMessage(undefined);
    try {
      window.sessionStorage.setItem('validationReturnTo', `/chatbots/${chatbotId}/dialogue/intents?resource=intent&edit=${intentId}`);
      const res = await testRunsApi.start(chatbotId, setId, {
        overlaySource: 'AUGMENTATION_SUGGESTIONS',
        suggestionIds: selectedIds,
        useRag,
      });
      setOpen(false);
      navigate(`/chatbots/${chatbotId}/validation/runs/${res.runId}`);
    } catch (e) {
      setErrorMessage(e instanceof ApiError ? e.message : MESSAGES.errors.generic);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <button type="button" className="btn btn-secondary" onClick={() => void handleOpen()}>
        {msg.checkButton}
      </button>
      <AugmentationImpactSetPickerDialog
        chatbotId={chatbotId}
        isOpen={open}
        sets={sets}
        suggestionCount={selectedIds.length}
        submitting={submitting}
        errorMessage={errorMessage}
        onStart={(setId, useRag) => void handleStart(setId, useRag)}
        onClose={() => setOpen(false)}
      />
    </>
  );
}
