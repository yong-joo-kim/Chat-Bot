import type { GuardrailAction, GuardrailAppliesTo, GuardrailRule } from '@chat-bot/shared-types';
import { GUARDRAIL_ACTION_LABELS, GUARDRAIL_APPLIES_TO_LABELS } from '@chat-bot/shared-types';
import { SeverityBadge, type Severity } from '../../../components/SeverityBadge';
import { MESSAGES } from '../../../constants/messages';

/** 동작 글자 배지 — 기록만=INFO · 안전 문구로 대체·AI로 보내지 않음=WARNING(색+아이콘+글자, ui-spec §2.1). */
export function RuleActionBadge({ action }: { action: GuardrailAction }): JSX.Element {
  const severity: Severity = action === 'MONITOR' ? 'INFO' : 'WARNING';
  return <SeverityBadge severity={severity} label={GUARDRAIL_ACTION_LABELS[action]} />;
}

/** 적용 위치 글자("사용자 질문"/"AI 답변"/"둘 다"). */
export function RuleStageText({ appliesTo }: { appliesTo: GuardrailAppliesTo }): JSX.Element {
  return <>{GUARDRAIL_APPLIES_TO_LABELS[appliesTo]}</>;
}

export interface RuleWarning {
  severity: Severity;
  text: string;
}

/** 행의 "확인할 점" 계산(ui-spec §4.3). */
export function ruleWarnings(rule: Pick<GuardrailRule, 'replacementBannedHit' | 'appliesTo' | 'action'>, ragActive: boolean): RuleWarning[] {
  const msg = MESSAGES.guardrails.rules;
  const list: RuleWarning[] = [];
  if (rule.replacementBannedHit) list.push({ severity: 'WARNING', text: msg.warnReplacementBanned });
  if (!ragActive) {
    if (rule.appliesTo === 'OUTBOUND') list.push({ severity: 'INFO', text: msg.infoOutboundInactive });
    if (rule.action === 'NO_RAG') list.push({ severity: 'INFO', text: msg.infoNoRagInactive });
    if (rule.appliesTo === 'BOTH') list.push({ severity: 'INFO', text: msg.infoBothInactive });
  }
  return list;
}

/** 행 아래 확인할 점 목록 — 없으면 "—". 색 단독이 아니라 배지 안 글자로 전달한다. */
export function RuleWarningList({ rule, ragActive }: { rule: GuardrailRule; ragActive: boolean }): JSX.Element {
  const warnings = ruleWarnings(rule, ragActive);
  if (warnings.length === 0) return <>{MESSAGES.guardrails.rules.noWarnings}</>;
  return (
    <ul className="guardrail-warning-list">
      {warnings.map((w) => (
        <li key={w.text}>
          <SeverityBadge severity={w.severity} label={w.text} />
        </li>
      ))}
    </ul>
  );
}
