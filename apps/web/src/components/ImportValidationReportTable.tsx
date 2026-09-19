import { useState } from 'react';
import type { ImportConflict, ImportRowError, ImportRowErrorCode } from '@chat-bot/shared-types';
import { MESSAGES } from '../constants/messages';
import { Pagination } from './Pagination';

export interface ImportValidationSummary {
  totalRows: number;
  newItems: number;
  updatedItems: number;
  newValues: number;
  duplicatedRows: number;
}

export interface ImportValidationReportTableProps {
  summary: ImportValidationSummary;
  errors: ImportRowError[];
  conflicts?: ImportConflict[];
  onJumpToOwner?: (ownerId: string) => void;
  columnLabels?: { value?: string };
}

const PAGE_SIZE = 50;

/** 검증/커밋 결과 표(ui-spec §2.2-2). 오류는 네이티브 `<table>`로 렌더링해 스크린리더 탐색을 보장한다. */
export function ImportValidationReportTable({
  summary,
  errors,
  conflicts = [],
  onJumpToOwner,
}: ImportValidationReportTableProps): JSX.Element {
  const [page, setPage] = useState(1);
  const msg = MESSAGES.dialogue.bulkImport;
  const pageErrors = errors.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div className="import-report">
      <div className="import-report-summary">
        <span className="import-report-badge">{msg.summaryTotal(summary.totalRows)}</span>
        <span className="import-report-badge">{msg.summaryNew(summary.newItems)}</span>
        <span className="import-report-badge">{msg.summaryUpdated(summary.updatedItems)}</span>
        <span className="import-report-badge">{msg.summaryNewValues(summary.newValues)}</span>
        <span className="import-report-badge">{msg.summaryDuplicated(summary.duplicatedRows)}</span>
        <span className={`import-report-badge${errors.length > 0 ? ' import-report-badge--error' : ''}`}>
          {msg.summaryErrors(errors.length)}
        </span>
      </div>

      {errors.length > 0 && (
        <div className="import-report-table-wrap">
          <table className="import-report-table">
            <thead>
              <tr>
                <th scope="col">{msg.reportColumnRow}</th>
                <th scope="col">{msg.reportColumnColumn}</th>
                <th scope="col">{msg.reportColumnValue}</th>
                <th scope="col">{msg.reportColumnCode}</th>
                <th scope="col">{msg.reportColumnMessage}</th>
              </tr>
            </thead>
            <tbody>
              {pageErrors.map((err, i) => (
                <tr key={`${err.row}-${err.column}-${i}`}>
                  <td>{err.row}</td>
                  <td>{err.column}</td>
                  <td>{err.value.length > 200 ? `${err.value.slice(0, 200)}…` : err.value}</td>
                  <td>
                    <ImportRowErrorBadge code={err.code} />
                  </td>
                  <td>{err.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pagination page={page} pageSize={PAGE_SIZE} total={errors.length} onPageChange={setPage} />
        </div>
      )}

      {conflicts.length > 0 && (
        <div className="import-report-conflicts">
          <h3>{msg.conflictsTitle}</h3>
          <ul>
            {conflicts.map((c) => (
              <li key={`${c.value}-${c.ownerId}`}>
                {onJumpToOwner ? (
                  <button type="button" className="link-button" onClick={() => onJumpToOwner(c.ownerId)}>
                    {msg.conflictArrow(c.value, c.ownerName)}
                  </button>
                ) : (
                  msg.conflictArrow(c.value, c.ownerName)
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function ImportRowErrorBadge({ code }: { code: ImportRowErrorCode }): JSX.Element {
  return <span className="import-row-error-badge">{MESSAGES.dialogue.importRowError[code]}</span>;
}
