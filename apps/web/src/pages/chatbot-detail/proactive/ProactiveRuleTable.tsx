import type { ProactiveRuleIssue, ProactiveRuleView } from '@chat-bot/shared-types';
import { ChannelToggle } from '../channels/ChannelToggle';
import { KebabMenu } from '../../../components/KebabMenu';
import { MESSAGES } from '../../../constants/messages';

const ISSUE_LABEL: Record<ProactiveRuleIssue, string> = {
  TARGET_UNAVAILABLE: MESSAGES.proactive.rule.issueTargetUnavailable,
  SERVING_UNVERIFIABLE: MESSAGES.proactive.rule.issueServingUnverifiable,
  BANNED_WORD: MESSAGES.proactive.rule.issueBannedWord,
  INVALID_STORED: MESSAGES.proactive.rule.issueInvalidStored,
  LINK_OUTSIDE_POLICY: MESSAGES.proactive.rule.issueLinkOutsidePolicy,
};

const PERIOD_LABEL: Record<string, string> = {
  ALWAYS: MESSAGES.proactive.rule.periodAlways,
  SCHEDULED: MESSAGES.proactive.rule.periodScheduled,
  ACTIVE: MESSAGES.proactive.rule.periodActive,
  ENDED: MESSAGES.proactive.rule.periodEnded,
};

/** [신규 No.35] 규칙 문제 배지(§2.1) — 색상만으로 전달하지 않는다, 텍스트를 항상 병기한다. */
export function ProactiveRuleIssueBadge({ issue }: { issue: ProactiveRuleIssue }): JSX.Element {
  const severe = issue !== 'LINK_OUTSIDE_POLICY';
  return (
    <span className={`channel-status-badge channel-status-badge--${severe ? 'warning' : 'neutral'}`}>
      <span aria-hidden="true">{severe ? '⚠' : 'ⓘ'}</span> {ISSUE_LABEL[issue]}
    </span>
  );
}

export function ProactivePeriodStateBadge({ state }: { state: string }): JSX.Element {
  return <span className="channel-status-badge channel-status-badge--neutral">{PERIOD_LABEL[state] ?? state}</span>;
}

export function ProactiveFrequentDismissNotice(): JSX.Element {
  return (
    <p className="field-hint">
      <span aria-hidden="true">ⓘ</span> {MESSAGES.proactive.rule.frequentlyDismissedNotice}
    </p>
  );
}

export interface ProactiveRuleTableProps {
  rules: ProactiveRuleView[];
  limits: { rulesMax: number; enabledRulesMax: number };
  canWrite: boolean;
  onEdit: (rule: ProactiveRuleView) => void;
  onDelete: (rule: ProactiveRuleView) => void;
  onToggle: (rule: ProactiveRuleView) => void;
  onMove: (rule: ProactiveRuleView, direction: 'UP' | 'DOWN') => void;
  onDuplicate: (rule: ProactiveRuleView) => void;
  onStats: () => void;
}

function conditionSummary(rule: ProactiveRuleView): string {
  if (rule.trigger.kind !== 'PAGE_DWELL') return '';
  return MESSAGES.proactive.rule.conditionSummary(rule.trigger.pathInclude, rule.trigger.dwellSec, rule.trigger.pathExclude);
}

/** [신규 No.35] PA-C3 — 규칙 목록(화면 설계서 §3.3). */
export function ProactiveRuleTable({ rules, limits, canWrite, onEdit, onDelete, onToggle, onMove, onDuplicate, onStats }: ProactiveRuleTableProps): JSX.Element {
  const msg = MESSAGES.proactive.rule;
  const enabledCount = rules.filter((r) => r.enabled).length;

  return (
    <div className="proactive-rule-table-wrap">
      <div className="proactive-rule-table-header">
        <p className="result-count-badge">{msg.listCaption(rules.length, enabledCount)}</p>
        <button type="button" className="btn btn-secondary" onClick={onStats}>
          {msg.statsButton}
        </button>
      </div>
      <table className="dialogue-table">
        <thead>
          <tr>
            <th scope="col">{msg.columnOrder}</th>
            <th scope="col">{msg.columnName}</th>
            <th scope="col">{msg.columnCondition}</th>
            <th scope="col">{msg.columnEnabled}</th>
            <th scope="col">{msg.columnPeriod}</th>
            <th scope="col">{msg.columnIssue}</th>
            <th scope="col">{msg.columnLast7d}</th>
            <th scope="col">{MESSAGES.common.actionsColumnLabel}</th>
          </tr>
        </thead>
        <tbody>
          {rules.map((rule, index) => (
            <tr key={rule.id}>
              <td>
                <button type="button" className="btn btn-secondary" aria-label={`${rule.name} ${msg.moveUp}`} disabled={!canWrite || index === 0} onClick={() => onMove(rule, 'UP')}>
                  ▲
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  aria-label={`${rule.name} ${msg.moveDown}`}
                  disabled={!canWrite || index === rules.length - 1}
                  onClick={() => onMove(rule, 'DOWN')}
                >
                  ▼
                </button>
              </td>
              <td>
                <button type="button" className="link-button" onClick={() => onEdit(rule)}>
                  {rule.name}
                </button>
              </td>
              <td>{conditionSummary(rule)}</td>
              <td>
                <ChannelToggle id={`pa-rule-toggle-${rule.id}`} enabled={rule.enabled} locked={!canWrite} onToggle={() => onToggle(rule)} />
              </td>
              <td>
                <ProactivePeriodStateBadge state={rule.periodState} />
              </td>
              <td>
                {rule.issues.map((issue) => (
                  <ProactiveRuleIssueBadge key={issue} issue={issue} />
                ))}
              </td>
              <td>
                {rule.last7d.shown} / {rule.last7d.clicked} / {rule.last7d.dismissed} / {rule.last7d.optedOut}
                {rule.frequentlyDismissed && <ProactiveFrequentDismissNotice />}
              </td>
              <td>
                <KebabMenu
                  label={`${rule.name} 메뉴`}
                  items={[
                    { label: msg.editAction, onSelect: () => onEdit(rule), disabled: !canWrite },
                    { label: msg.duplicateAction, onSelect: () => onDuplicate(rule), disabled: !canWrite },
                    { label: msg.deleteAction, onSelect: () => onDelete(rule), disabled: !canWrite },
                  ]}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {rules.length >= limits.rulesMax && <p className="field-hint">{msg.limitReachedTooltip}</p>}
    </div>
  );
}
