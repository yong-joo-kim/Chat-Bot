import { useMemo } from 'react';
import { BulkImportModal } from '../../../dialogue/components/BulkImportModal';
import { createTestCaseImportApi } from '../../../../api/validation';

export interface TestCaseImportModalProps {
  chatbotId: string;
  setId: string;
  isOpen: boolean;
  onClose: () => void;
  onCommitted: () => void;
}

/**
 * `BulkImportModal`의 4번째 소비자(ui-spec §4.2.2, FR-V1-9) — 정책 선택 없이(병합 개념 없음)
 * 세트 스코프 API로 래핑만 한다.
 */
export function TestCaseImportModal({ chatbotId, setId, isOpen, onClose, onCommitted }: TestCaseImportModalProps): JSX.Element {
  const api = useMemo(() => createTestCaseImportApi(setId), [setId]);
  return (
    <BulkImportModal
      resourceType="TEST_CASE"
      chatbotId={chatbotId}
      isOpen={isOpen}
      onClose={onClose}
      onCommitted={onCommitted}
      apiOverride={api}
      hideMergePolicy
    />
  );
}
