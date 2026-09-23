import { useState } from 'react';
import type { TestCase } from '@chat-bot/shared-types';
import { Pagination } from '../../../../components/Pagination';
import { MESSAGES } from '../../../../constants/messages';

export interface TestCaseTableProps {
  items: TestCase[];
  total: number;
  page: number;
  pageSize: number;
  canWrite: boolean;
  onPageChange: (page: number) => void;
  onEdit: (tc: TestCase) => void;
  onDelete: (tc: TestCase) => void;
}

const NO_TARGET_KINDS = new Set<TestCase['expectedKind']>(['FALLBACK', 'ANY']);

function TestCaseRow({ tc, canWrite, onEdit, onDelete }: { tc: TestCase; canWrite: boolean; onEdit: () => void; onDelete: () => void }): JSX.Element {
  const msg = MESSAGES.validation.case;
  const [expanded, setExpanded] = useState(false);
  const isMultiTurn = tc.messages.length > 1;
  const lastMessage = tc.messages[tc.messages.length - 1];
  const targetMissing = !NO_TARGET_KINDS.has(tc.expectedKind) && tc.expectedTargetId && !tc.expectedTargetName;

  return (
    <>
      <tr>
        <td>{tc.seq}</td>
        <td>
          {isMultiTurn && (
            <button type="button" className="btn btn-secondary" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}>
              {msg.multiTurnBadge(tc.messages.length)}
            </button>
          )}{' '}
          {lastMessage}
        </td>
        <td>{msg.expectedKindLabel[tc.expectedKind]}</td>
        <td>
          {NO_TARGET_KINDS.has(tc.expectedKind) ? msg.noTargetLabel : (tc.expectedTargetName ?? tc.expectedTargetId)}
          {targetMissing && <p className="field-error" role="alert">{msg.targetDeletedWarning}</p>}
        </td>
        <td>{tc.enabled ? '✔' : '—'}</td>
        <td>
          {canWrite && (
            <>
              <button type="button" className="btn btn-secondary" onClick={onEdit}>
                {msg.editButton}
              </button>{' '}
              <button type="button" className="btn btn-secondary" onClick={onDelete}>
                {msg.deleteButton}
              </button>
            </>
          )}
        </td>
      </tr>
      {expanded && isMultiTurn && (
        <tr>
          <td colSpan={6}>
            <ol className="test-case-turn-list">
              {tc.messages.slice(0, -1).map((m, i) => (
                <li key={i}>{m}</li>
              ))}
            </ol>
          </td>
        </tr>
      )}
    </>
  );
}

/** V2 — TC 표(서버 페이지네이션, ui-spec §4.2.2). */
export function TestCaseTable({ items, total, page, pageSize, canWrite, onPageChange, onEdit, onDelete }: TestCaseTableProps): JSX.Element {
  const msg = MESSAGES.validation.case;
  return (
    <div className="import-report-table-wrap">
      <table className="import-report-table">
        <thead>
          <tr>
            <th scope="col">{msg.columnSeq}</th>
            <th scope="col">{msg.columnQuestion}</th>
            <th scope="col">{msg.columnExpectedKind}</th>
            <th scope="col">{msg.columnExpectedTarget}</th>
            <th scope="col">{msg.columnEnabled}</th>
            <th scope="col">{msg.columnActions}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((tc) => (
            <TestCaseRow key={tc.id} tc={tc} canWrite={canWrite} onEdit={() => onEdit(tc)} onDelete={() => onDelete(tc)} />
          ))}
        </tbody>
      </table>
      <Pagination page={page} pageSize={pageSize} total={total} onPageChange={onPageChange} />
    </div>
  );
}
