import type { RetentionPreviewResponse } from '@chat-bot/shared-types';
import { MESSAGES } from '../../../constants/messages';
import { formatDateTime } from '../../../lib/date';

function daysLabel(days: number | null): string {
  const msg = MESSAGES.dataGovernance.retention;
  return days === null ? msg.unlimitedDaysLabel : `${days}${msg.daysUnit}`;
}

/**
 * `POST …/retention/preview` 응답(`RetentionPreviewResponse`) — 종류별 영향 요약(§3.2.1).
 * [코드 리뷰 R1 L-3] 단축이 아닌 경우를 "진짜 변경 없음"(currentDays === newDays)과 "연장"(그 외)으로
 * 나눈다 — 무기한 → 무기한은 변경 없음, 유한 → 무기한/더 큰 유한값은 연장으로 표시한다.
 */
export function RetentionPreviewTable({ preview }: { preview: RetentionPreviewResponse }): JSX.Element {
  const msg = MESSAGES.dataGovernance.retention;
  return (
    <div className="retention-preview-table">
      <ul>
        {preview.items.map((item) => {
          const label = msg.kindLabels[item.kind];
          if (item.shortening) {
            return (
              <li key={item.kind}>
                {msg.affectedRowsText(
                  label,
                  item.newDays ?? 0,
                  item.affectedCount ?? 0,
                  item.firstPurgeAt ? formatDateTime(item.firstPurgeAt) : '—',
                )}
              </li>
            );
          }
          if (item.currentDays !== item.newDays) {
            return <li key={item.kind}>{msg.previewExtendedText(label, daysLabel(item.currentDays), daysLabel(item.newDays))}</li>;
          }
          return <li key={item.kind}>{msg.previewNoChangeText(label)}</li>;
        })}
      </ul>
      <p className="field-hint">{msg.previewNotice}</p>
    </div>
  );
}
