import { Link } from 'react-router-dom';
import type { GuardrailInboundView, RagPreview } from '@chat-bot/shared-types';
import { GUARDRAIL_PII_KIND_LABELS, type GuardrailPiiKind } from '@chat-bot/shared-types';
import { SeverityBadge } from '../../../components/SeverityBadge';
import { useAuth } from '../../../context/AuthContext';
import { MESSAGES } from '../../../constants/messages';

/**
 * 시뮬레이터 말풍선 아래 "운영에서 이 질문은 어떻게 되나" 안내(`ai-guardrails-ui-spec.md` §10.1). 응답에 `guardrailInbound`가
 * 있을 때만 렌더한다(없으면 미렌더 = 기존과 동일). 판정 근거 접힘(`TracePanel`) 밖에 두어 항상 보이게 한다. 엔진의 원래 결과는 그대로다.
 */
export function GuardrailInboundNotice({ chatbotId, view, ragRequested }: { chatbotId: string; view: GuardrailInboundView; ragRequested?: boolean }): JSX.Element {
  const m = MESSAGES.guardrails.simulator;
  const { can } = useAuth();
  const names = view.ruleNames.join(', ');
  const severity = view.action === 'MONITOR' ? 'INFO' : 'WARNING';
  const badgeLabel = view.action === 'REPLACE' ? m.inboundBadgeReplace : view.action === 'NO_RAG' ? m.inboundBadgeNoRag : m.inboundBadgeMonitor;
  return (
    <div className="guardrail-inbound-notice" role="status">
      <SeverityBadge severity={severity} label={badgeLabel} />{' '}
      {view.action === 'REPLACE' && <strong>{m.inboundReplace(names, view.replacementText ?? '')}</strong>}
      {view.action === 'NO_RAG' && (
        <>
          <strong>{m.inboundNoRag(names)}</strong>
          {ragRequested && <> {m.inboundNoRagUseRag}</>}
        </>
      )}
      {view.action === 'MONITOR' && <>{m.inboundMonitor(names)}</>}
      {can('security:read') && (
        <>
          {' '}
          <Link to={`/chatbots/${chatbotId}/guardrails/rules`}>{m.viewRules}</Link>
        </>
      )}
    </div>
  );
}

/** 가림 건수 문장("주민등록번호 1건") — 0건은 생략. */
function piiParts(counts: RagPreview['piiCounts']): string {
  return (Object.keys(GUARDRAIL_PII_KIND_LABELS) as GuardrailPiiKind[])
    .filter((k) => (counts[k] ?? 0) > 0)
    .map((k) => MESSAGES.guardrails.test.piiCountItem(GUARDRAIL_PII_KIND_LABELS[k], counts[k] as number))
    .join(' · ');
}

/**
 * AI 답변 미리보기(운영에서 실제로 나가는 모습) — `matchTrace.ragPreview`가 있을 때만 렌더한다. 원래 AI 답변은 저장할 때처럼
 * 가려서 `<details>`(기본 접힘)에 두고, 모든 값은 글자로만 렌더한다.
 */
export function RagPreviewPanel({ preview }: { preview: RagPreview }): JSX.Element {
  const m = MESSAGES.guardrails.simulator;
  const names = preview.ruleNames.join(', ');
  const resultText =
    preview.outcome === 'MONITOR' ? m.outcomeMonitor(names) : preview.outcome === 'REPLACED' ? m.outcomeReplaced(names) : m.outcome[preview.outcome];
  const pii = piiParts(preview.piiCounts);
  return (
    <div className="rag-preview-panel">
      <p className="field-label-static">{m.previewTitle}</p>
      <p>
        {m.previewResult}: {resultText}
      </p>
      <p className="field-label-static">{m.finalTextLabel}</p>
      <p className="guardrail-result-text">{preview.finalText}</p>
      {preview.originalMasked !== undefined && (preview.outcome === 'REPLACED' || preview.outcome === 'FALLBACK') && (
        <details>
          <summary>{m.originalToggle}</summary>
          <p className="guardrail-result-text">{preview.originalMasked}</p>
          <p className="field-hint">{m.originalNotice}</p>
        </details>
      )}
      {pii && <p>{m.maskedLine(pii)}</p>}
      <p className="field-hint">
        <span aria-hidden="true">ⓘ</span> {m.noRecordNotice}
      </p>
    </div>
  );
}
