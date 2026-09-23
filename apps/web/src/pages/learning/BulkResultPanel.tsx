import type { BulkResult } from '@chat-bot/shared-types';
import { MESSAGES } from '../../constants/messages';
import { AutoSnapshotNotice } from '../../components/AutoSnapshotNotice';

export interface BulkResultPanelProps {
  result: BulkResult;
  chatbotId: string;
  /** 실패 건의 질문 요약 표시용(FR-C-9) — 목록 페이지가 이미 갖고 있는 질문 텍스트를 재사용한다. */
  questionTextById: Map<string, string>;
  onClose: () => void;
}

/** 일괄 처리 결과(FR-C-9, FR-15-31) — "N건 성공" 토스트로 끝내지 않고 실패 사유를 목록으로 보여준다. */
export function BulkResultPanel({ result, chatbotId, questionTextById, onClose }: BulkResultPanelProps): JSX.Element {
  return (
    <div className="bulk-result-panel" role="status">
      <p className="bulk-result-title">{MESSAGES.learning.bulkResultTitle(result.succeeded, result.failed.length)}</p>
      <AutoSnapshotNotice
        outcome={result.autoSnapshot}
        chatbotId={chatbotId}
        createdText={MESSAGES.learning.autoSnapshotCreated}
        viewLinkText={MESSAGES.learning.autoSnapshotViewLink}
        failedText={MESSAGES.learning.autoSnapshotFailed}
      />
      {result.failed.length > 0 && (
        <table className="chart-frame-data-table">
          <thead>
            <tr>
              <th scope="col">{MESSAGES.learning.bulkFailColumnQuestion}</th>
              <th scope="col">{MESSAGES.learning.bulkFailColumnReason}</th>
            </tr>
          </thead>
          <tbody>
            {result.failed.map((f) => (
              <tr key={f.id}>
                <td>{questionTextById.get(f.id) ?? f.id}</td>
                <td>{f.message}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <button type="button" className="btn btn-secondary" onClick={onClose}>
        {MESSAGES.common.close}
      </button>
    </div>
  );
}
