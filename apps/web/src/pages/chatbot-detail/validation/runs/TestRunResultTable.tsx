import { useState } from 'react';
import type { TestRunResult } from '@chat-bot/shared-types';
import { JudgmentBadge } from '../../../../components/JudgmentBadge';
import { Pagination } from '../../../../components/Pagination';
import { MESSAGES } from '../../../../constants/messages';
import { SurveyPreviewJudgmentBadge } from '../../../dialogue/components/survey/badges';
import { OpenInSimulatorButton } from './OpenInSimulatorButton';

const PREVIEW_LEN = 120;

function TestRunResultRow({ chatbotId, item }: { chatbotId: string; item: TestRunResult }): JSX.Element {
  const msg = MESSAGES.validation.result;
  const [expanded, setExpanded] = useState(false);
  const preview = item.outputsPreviewA ?? '';
  const truncated = preview.length > PREVIEW_LEN;
  const isMultiTurn = item.questionText.includes('\n');
  const lastLine = isMultiTurn ? item.questionText.split('\n').slice(-1)[0] : item.questionText;

  return (
    <tr>
      <td>
        {isMultiTurn && (
          <button type="button" className="btn btn-secondary" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}>
            ▸
          </button>
        )}{' '}
        {lastLine}
      </td>
      <td>{item.expectedTargetName ?? item.expectedTargetId ?? MESSAGES.validation.case.noTargetLabel}</td>
      <td>{item.matchedNameA ?? '—'}</td>
      <td>
        <JudgmentBadge value={item.resultA} withHint />
        {item.surveyPreviewA && <SurveyPreviewJudgmentBadge />}
      </td>
      <td>{item.bandA ? MESSAGES.simulator.matchScorePanel.bandLabel[item.bandA] : '—'}</td>
      <td>{item.top1ScoreA !== null ? item.top1ScoreA.toFixed(2) : '—'}</td>
      <td>
        {truncated ? `${preview.slice(0, PREVIEW_LEN)}${msg.previewMore}` : preview}
        {item.unsupportedCountA > 0 && <span className="import-row-error-badge">{msg.unsupportedBadge}</span>}
        {item.blockedByFilterA && <span className="import-row-error-badge">{msg.blockedBadge}</span>}
      </td>
      <td>
        <OpenInSimulatorButton chatbotId={chatbotId} questionText={lastLine} />
      </td>
    </tr>
  );
}

export interface TestRunResultTableProps {
  chatbotId: string;
  items: TestRunResult[];
  total: number;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
}

/** V4 — 결과 표(ui-spec §4.4.1, 서버 페이지네이션). */
export function TestRunResultTable({ chatbotId, items, total, page, pageSize, onPageChange }: TestRunResultTableProps): JSX.Element {
  const msg = MESSAGES.validation.result;
  return (
    <div className="import-report-table-wrap">
      <table className="import-report-table">
        <thead>
          <tr>
            <th scope="col">{msg.columnQuestion}</th>
            <th scope="col">{msg.columnExpected}</th>
            <th scope="col">{msg.columnActual}</th>
            <th scope="col">{msg.columnJudgment}</th>
            <th scope="col">{msg.columnBand}</th>
            <th scope="col">{msg.columnScore}</th>
            <th scope="col">{msg.columnPreview}</th>
            <th scope="col">{msg.columnAction}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <TestRunResultRow key={item.id} chatbotId={chatbotId} item={item} />
          ))}
        </tbody>
      </table>
      <Pagination page={page} pageSize={pageSize} total={total} onPageChange={onPageChange} />
    </div>
  );
}
