import type { UtteranceAnalysisCounts, UtterancePreviewResponse } from '@chat-bot/shared-types';
import { MESSAGES } from '../../../constants/messages';

const EXCLUSION_ORDER = ['EMPTY', 'TOO_LONG', 'TOO_SHORT', 'NO_CONTENT'] as const;

/**
 * 파일 검사 결과 표(UA-2 §4.2)와 결과 상세의 "처리 정보" 표가 함께 쓴다. 숫자가 본문이고 색은 쓰지 않는다.
 * `maxChars`는 capability 한계값(없으면 사유 설명에서 숫자를 뺀다).
 */
export function UploadPreviewTable({
  counts,
  maxChars,
  caption,
}: {
  counts: UtteranceAnalysisCounts | UtterancePreviewResponse;
  maxChars?: number;
  caption?: string;
}): JSX.Element {
  const msg = MESSAGES.utteranceAnalysis;
  const rows: Array<{ key: string; label: string; note?: string; value: number }> = [
    { key: 'totalRows', label: msg.previewRows.totalRows, value: counts.totalRows },
    { key: 'validCount', label: msg.previewRows.validCount, value: counts.validCount },
    { key: 'mergedCount', label: msg.previewRows.mergedCount, value: counts.mergedCount },
    ...EXCLUSION_ORDER.map((reason) => ({
      key: reason,
      label: msg.previewRows[reason],
      note: reason === 'TOO_LONG' && maxChars ? msg.previewRowNotes.TOO_LONG(maxChars) : reason === 'NO_CONTENT' ? msg.previewRowNotes.NO_CONTENT : undefined,
      value: counts.excluded[reason] ?? 0,
    })),
    { key: 'maskedRowCount', label: msg.previewRows.maskedRowCount, value: counts.maskedRowCount },
    { key: 'bannedRowCount', label: msg.previewRows.bannedRowCount, note: msg.previewRowNotes.bannedRowCount, value: counts.bannedRowCount },
    { key: 'invalidCountRows', label: msg.previewRows.invalidCountRows, note: msg.previewRowNotes.invalidCountRows, value: counts.invalidCountRows },
    { key: 'occurrenceTotal', label: msg.previewRows.occurrenceTotal, value: counts.occurrenceTotal },
  ];
  return (
    <table className="dialogue-table ua-preview-table">
      <caption>{caption ?? msg.previewCaption(counts.validCount)}</caption>
      <thead>
        <tr>
          <th scope="col">{msg.previewColumnItem}</th>
          <th scope="col">{msg.previewColumnValue}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key}>
            <th scope="row">
              {r.label}
              {r.note && <span className="ua-row-note"> — {r.note}</span>}
            </th>
            <td>{r.value.toLocaleString('ko-KR')}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
