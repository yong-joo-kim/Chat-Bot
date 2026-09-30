import type { GuardrailTestResponse } from '@chat-bot/shared-types';
import { GUARDRAIL_CATEGORY_LABELS, GUARDRAIL_PII_KIND_LABELS, type GuardrailPiiKind } from '@chat-bot/shared-types';
import { SeverityBadge, type Severity } from '../../../components/SeverityBadge';
import { MESSAGES } from '../../../constants/messages';
import { RuleActionBadge } from './RuleBadges';

/** 결과 배지 문장(글자) — 스크린리더는 이 한 줄만 읽는다(ui-spec §5.5). */
export function testResultSentence(result: GuardrailTestResponse): string {
  const m = MESSAGES.guardrails.test;
  switch (result.result) {
    case 'PASS':
      return m.resultPass;
    case 'MONITOR':
      return m.resultMonitor(result.hits.length);
    case 'NO_RAG':
      return m.resultNoRag;
    case 'REPLACE':
      return m.resultReplace;
    case 'MASKED': {
      const total = Object.values(result.piiCounts).reduce((a, b) => a + (b ?? 0), 0);
      return m.resultMasked(total);
    }
    case 'FALLBACK':
      return m.resultFallback;
    default:
      return '';
  }
}

function sentenceSeverity(kind: GuardrailTestResponse['result']): Severity {
  return kind === 'PASS' || kind === 'MONITOR' ? 'INFO' : 'WARNING';
}

/** 가림 건수 문장("주민등록번호 1건 · 카드번호 2건") — 0건은 생략, 전부 0이면 빈 문자열. */
export function piiCountsText(counts: Partial<Record<GuardrailPiiKind, number>>): string {
  const m = MESSAGES.guardrails.test;
  return (Object.keys(GUARDRAIL_PII_KIND_LABELS) as GuardrailPiiKind[])
    .filter((k) => (counts[k] ?? 0) > 0)
    .map((k) => m.piiCountItem(GUARDRAIL_PII_KIND_LABELS[k], counts[k] as number))
    .join(' · ');
}

/** 결과 배지 한 줄(라이브 영역 안에 넣는다). */
export function TestResultBadge({ result }: { result: GuardrailTestResponse }): JSX.Element {
  return <SeverityBadge severity={sentenceSeverity(result.result)} label={testResultSentence(result)} />;
}

/**
 * 시험 결과 상세 — 걸린 규칙 표 · 결과 문구 · 가림 건수(라이브 영역 밖이라 시험마다 낭독되지 않는다).
 * 결과 문구는 글자로만 렌더한다(`pre-wrap`, HTML 해석 없음).
 */
export function TestResultView({ result, showRules = true }: { result: GuardrailTestResponse; showRules?: boolean }): JSX.Element {
  const m = MESSAGES.guardrails.test;
  const piiText = piiCountsText(result.piiCounts);
  // FALLBACK인데 문구가 비어 있으면(§17.1 가정) 결과 문구 상자를 생략하고 배지 문장을 우선한다.
  const showResultText = result.resultText !== '';
  return (
    <div className="guardrail-test-result">
      {result.result === 'NO_RAG' && <p className="field-hint">{m.resultNoRagNote}</p>}
      {showRules && result.hits.length > 0 && (
        <table className="dialogue-table guardrail-test-hits">
          <caption>{m.hitsCaption}</caption>
          <thead>
            <tr>
              <th scope="col">{m.hitsColumns.rule}</th>
              <th scope="col">{m.hitsColumns.action}</th>
              <th scope="col">{m.hitsColumns.decisive}</th>
              <th scope="col">{m.hitsColumns.expressions}</th>
            </tr>
          </thead>
          <tbody>
            {result.hits.map((h, i) => (
              <tr key={`${h.ruleId ?? 'draft'}-${i}`}>
                <td>
                  {h.ruleName}({GUARDRAIL_CATEGORY_LABELS[h.category]}){h.ruleId === null && <> {m.unsavedRule}</>}
                </td>
                <td>
                  <RuleActionBadge action={h.action} />
                </td>
                <td>{h.decisive ? m.decisive : m.notDecisive}</td>
                <td>{h.matchedExpressions.join(', ') || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {showResultText && (
        <div className="guardrail-result-text-box">
          <p className="field-label-static">{m.resultTextTitle}</p>
          <p className="guardrail-result-text">{result.resultText}</p>
        </div>
      )}
      {result.stage === 'OUTBOUND' ? piiText && <p>{m.piiCountsLine(piiText)}</p> : <p className="field-hint">{m.piiNotAppliedInbound}</p>}
      <p className="field-hint">{m.alwaysNotice}</p>
    </div>
  );
}
