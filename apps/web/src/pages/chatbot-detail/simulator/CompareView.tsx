import { useState } from 'react';
import { Link } from 'react-router-dom';
import { COMPARE_LIMITS, isOverlayEmpty, type CompareResponse, type DialogueOverlay } from '@chat-bot/shared-types';
import { simulationApi } from '../../../api/simulation';
import { ApiError } from '../../../api/client';
import { MESSAGES } from '../../../constants/messages';
import { SkeletonRow } from '../../../components/Skeleton';
import { SeverityBadge } from '../../../components/SeverityBadge';
import { InlineFieldError } from '../../../components/InlineFieldError';
import { CompareTurnRow } from './CompareTurnRow';

/** SIM2 — 저장본(A) vs 저장본+오버레이(B) 비교(FR-10-25~31, J-1). */
export function CompareView({
  chatbotId,
  overlay,
  initialState,
}: {
  chatbotId: string;
  overlay: DialogueOverlay | undefined;
  initialState?: unknown;
}): JSX.Element {
  const msg = MESSAGES.simulator.compare;
  const [rawText, setRawText] = useState('');
  const [differentOnly, setDifferentOnly] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<CompareResponse | null>(null);
  const [error, setError] = useState<string | undefined>(undefined);

  const lines = rawText
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  const overlayEmpty = !overlay || isOverlayEmpty(overlay);
  const overLimit = lines.length > COMPARE_LIMITS.messages;
  const canRun = !overlayEmpty && lines.length > 0 && !overLimit && !loading;

  async function handleRun(): Promise<void> {
    if (!overlay || !canRun) return;
    setLoading(true);
    setError(undefined);
    try {
      const res = await simulationApi.compare(chatbotId, { messages: lines, overlay, initialState });
      setResult(res);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : MESSAGES.errors.generic);
    } finally {
      setLoading(false);
    }
  }

  const visibleTurns = result ? (differentOnly ? result.turns.filter((t) => t.diff.status === 'DIFFERENT') : result.turns) : [];

  return (
    <div className="compare-view">
      {overlayEmpty && <SeverityBadge severity="INFO" label={msg.noOverlayNotice} />}
      <div className="form-field">
        <label htmlFor="compare-input">{msg.inputLabel}</label>
        <textarea
          id="compare-input"
          rows={6}
          value={rawText}
          disabled={overlayEmpty}
          onChange={(e) => setRawText(e.target.value)}
        />
        <p className="field-hint">{msg.inputCount(lines.length, COMPARE_LIMITS.messages)}</p>
        <p className="field-hint">
          <span aria-hidden="true">ⓘ</span> {msg.bulkVerificationHint}{' '}
          <Link to={`/chatbots/${chatbotId}/validation/sets`}>{msg.bulkVerificationLink}</Link>
        </p>
        <InlineFieldError id="compare-input-error" message={overLimit ? msg.inputMaxError : undefined} />
        {overLimit && (
          <p className="field-hint">
            <Link to={`/chatbots/${chatbotId}/validation/sets`}>{msg.bulkVerificationLink}</Link>
          </p>
        )}
      </div>
      <div className="compare-toolbar">
        <label className="form-field--inline">
          <input type="checkbox" checked={differentOnly} onChange={(e) => setDifferentOnly(e.target.checked)} />
          {msg.differentOnly}
        </label>
        <button type="button" className="btn btn-primary" disabled={!canRun} aria-disabled={!canRun} onClick={handleRun}>
          {msg.runButton}
        </button>
      </div>
      <InlineFieldError id="compare-run-error" message={error} />
      {loading && (
        <div className="compare-loading">
          {lines.map((_, i) => (
            <SkeletonRow key={i} />
          ))}
        </div>
      )}
      {result && !loading && (
        <>
          <p className="compare-summary-badge">{msg.resultSummary(result.summary.total, result.summary.different)}</p>
          <div className="compare-turn-list">
            {visibleTurns.map((turn) => (
              <CompareTurnRow key={turn.index} turn={turn} chatbotId={chatbotId} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
