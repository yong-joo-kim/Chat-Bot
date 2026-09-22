import { useState, type FormEvent } from 'react';
import type { BannedWordTestResponse } from '@chat-bot/shared-types';
import { bannedWordsApi } from '../../../api/bannedWords';
import { ApiError } from '../../../api/client';
import { BannedWordDecisionBadge, MatchTypeBadge, BannedWordPolicyBadge } from '../../../components/security/badges';
import { MESSAGES } from '../../../constants/messages';

/** B1 "문장으로 시험하기"(security-audit-ui-spec.md §3.8.2, S-10). 저장하지 않는 순수 진단이다. */
export function BannedWordTestPanel(): JSX.Element {
  const msg = MESSAGES.bannedWords;
  const [text, setText] = useState('');
  const [result, setResult] = useState<BannedWordTestResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (!text.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await bannedWordsApi.test(text);
      setResult(res);
    } catch (e2) {
      setResult(null);
      setError(e2 instanceof ApiError ? e2.message : MESSAGES.errors.generic);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="banned-word-test-panel dialogue-panel">
      <h2 className="dialogue-panel-header">{msg.testPanelTitle}</h2>
      <form onSubmit={handleSubmit} className="form-field--inline">
        <label htmlFor="banned-word-test-input" className="sr-only">
          {msg.testInputLabel}
        </label>
        <input
          id="banned-word-test-input"
          type="text"
          value={text}
          className="banned-word-test-input"
          onChange={(e) => setText(e.target.value)}
        />
        <button type="submit" className="btn btn-primary" disabled={submitting || !text.trim()}>
          {msg.testButton}
        </button>
      </form>
      {error && <p className="field-error" role="alert">{error}</p>}
      {result && (
        <div className="banned-word-test-result" role="status">
          <p>
            <strong>{msg.testResultLabel}:</strong> <BannedWordDecisionBadge decision={result.decision} />
          </p>
          {result.matches.length > 0 && (
            <p>
              {msg.detectedWordsLabel}:{' '}
              {result.matches.map((m, i) => (
                <span key={`${m.word}-${i}`}>
                  "{m.word}" (<MatchTypeBadge matchType={m.matchType} /> <BannedWordPolicyBadge policy={m.policy} />)
                  {i < result.matches.length - 1 ? ', ' : ''}
                </span>
              ))}
            </p>
          )}
          {result.decision !== 'PASS' && (
            <p>
              {msg.maskedPreviewLabel}: {result.maskedText}
            </p>
          )}
          {result.decision === 'BLOCK' && <p className="field-hint">{msg.blockNotice}</p>}
          {result.decision === 'WARN' && <p className="field-hint">{msg.warnNotice}</p>}
          {result.decision === 'PASS' && result.matches.length === 0 && <p className="field-hint">{msg.passNotice}</p>}
        </div>
      )}
    </section>
  );
}
