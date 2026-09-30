import { useLayoutEffect, useRef, type MouseEvent } from 'react';
import { Link } from 'react-router-dom';
import type { GuardrailRule } from '@chat-bot/shared-types';
import { GUARDRAIL_CATEGORY_LABELS } from '@chat-bot/shared-types';
import { MESSAGES } from '../../../constants/messages';
import { ChannelToggle } from '../channels/ChannelToggle';
import { RuleActionBadge, RuleStageText, RuleWarningList } from './RuleBadges';

export interface GuardrailRuleTableProps {
  chatbotId: string;
  rules: GuardrailRule[];
  canWrite: boolean;
  ragActive: boolean;
  /** 요청 진행 중인 규칙 id(스위치·이동 버튼을 `aria-disabled`로 막는다 — 중복 실행 방지). */
  busyRuleId: string | null;
  onToggle: (rule: GuardrailRule) => void;
  onMove: (rule: GuardrailRule, direction: 'UP' | 'DOWN') => void;
  onDelete: (rule: GuardrailRule) => void;
}

type Variant = 'd' | 'm';

/**
 * GR-1 규칙 표(데스크톱) + 카드(640px 미만) — `ai-guardrails-ui-spec.md` §4.2·§15. 정렬 버튼은 두지 않는다(순서가 의미다).
 * 위/아래 버튼은 끝 행에서 `disabled`가 아니라 `aria-disabled`(포커스 유실 방지)이고, 이동 뒤에는 같은 방향 버튼에 포커스를 되돌린다.
 */
export function GuardrailRuleTable({ chatbotId, rules, canWrite, ragActive, busyRuleId, onToggle, onMove, onDelete }: GuardrailRuleTableProps): JSX.Element {
  const msg = MESSAGES.guardrails.rules;
  const pendingFocus = useRef<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // 이동 뒤(목록 순서가 바뀐 직후) 같은 방향 버튼으로 포커스를 되돌린다.
  useLayoutEffect(() => {
    const key = pendingFocus.current;
    if (!key) return;
    pendingFocus.current = null;
    const el = rootRef.current?.querySelector<HTMLElement>(`[data-focus-key="${key}"]`);
    el?.focus();
  }, [rules]);

  function handleMove(e: MouseEvent<HTMLButtonElement>, rule: GuardrailRule, direction: 'UP' | 'DOWN', index: number): void {
    const atEdge = direction === 'UP' ? index === 0 : index === rules.length - 1;
    if (atEdge || busyRuleId !== null) return;
    pendingFocus.current = e.currentTarget.dataset.focusKey ?? null;
    onMove(rule, direction);
  }

  function moveButtons(rule: GuardrailRule, index: number, variant: Variant): JSX.Element {
    const busy = busyRuleId !== null;
    const upEdge = index === 0;
    const downEdge = index === rules.length - 1;
    return (
      <span className="guardrail-move-buttons">
        <button
          type="button"
          className="btn btn-secondary guardrail-move-button"
          aria-label={msg.moveUp(rule.name)}
          aria-disabled={upEdge || busy || undefined}
          data-focus-key={`${variant}:${rule.id}:UP`}
          onClick={(e) => handleMove(e, rule, 'UP', index)}
        >
          <span aria-hidden="true">▲</span>
        </button>
        <button
          type="button"
          className="btn btn-secondary guardrail-move-button"
          aria-label={msg.moveDown(rule.name)}
          aria-disabled={downEdge || busy || undefined}
          data-focus-key={`${variant}:${rule.id}:DOWN`}
          onClick={(e) => handleMove(e, rule, 'DOWN', index)}
        >
          <span aria-hidden="true">▼</span>
        </button>
      </span>
    );
  }

  function enabledControl(rule: GuardrailRule, variant: Variant): JSX.Element {
    if (!canWrite) {
      return (
        <span>
          <span aria-hidden="true">{rule.enabled ? '●' : '○'}</span> {rule.enabled ? msg.enabledLabelOn : msg.enabledLabelOff}
        </span>
      );
    }
    return (
      <ChannelToggle
        id={`gr-toggle-${variant}-${rule.id}`}
        enabled={rule.enabled}
        locked={false}
        busy={busyRuleId === rule.id}
        onLabel={msg.enabledLabelOn}
        offLabel={msg.enabledLabelOff}
        onToggle={() => onToggle(rule)}
      />
    );
  }

  function operations(rule: GuardrailRule): JSX.Element {
    return (
      <span className="guardrail-row-actions">
        <Link to={`/chatbots/${chatbotId}/guardrails/rules/${rule.id}`} className="btn btn-secondary" aria-label={msg.editLinkLabel(rule.name)}>
          {msg.editLink}
        </Link>
        <button type="button" className="btn btn-secondary" aria-label={msg.deleteButtonLabel(rule.name)} onClick={() => onDelete(rule)}>
          {msg.deleteButton}
        </button>
      </span>
    );
  }

  return (
    <div ref={rootRef}>
      <table className="dialogue-table desktop-only guardrail-rule-table">
        <caption className="sr-only">{msg.tableCaption}</caption>
        <thead>
          <tr>
            <th scope="col">{msg.columns.order}</th>
            <th scope="col">{msg.columns.name}</th>
            <th scope="col">{msg.columns.category}</th>
            <th scope="col">{msg.columns.appliesTo}</th>
            <th scope="col">{msg.columns.action}</th>
            <th scope="col">{msg.columns.expressions}</th>
            <th scope="col">{msg.columns.enabled}</th>
            <th scope="col">{msg.columns.hits7d}</th>
            <th scope="col">{msg.columns.warnings}</th>
            {canWrite && (
              <th scope="col">
                <span className="sr-only">{msg.columns.operations}</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {rules.map((rule, index) => (
            <tr key={rule.id}>
              <td>{canWrite ? moveButtons(rule, index, 'd') : index + 1}</td>
              <td className="guardrail-break">{rule.name}</td>
              <td>{GUARDRAIL_CATEGORY_LABELS[rule.category]}</td>
              <td>
                <RuleStageText appliesTo={rule.appliesTo} />
              </td>
              <td>
                <RuleActionBadge action={rule.action} />
              </td>
              <td>{rule.expressionCount}</td>
              <td>{enabledControl(rule, 'd')}</td>
              <td>{rule.recentHits7d}</td>
              <td>
                <RuleWarningList rule={rule} ragActive={ragActive} />
              </td>
              {canWrite && <td>{operations(rule)}</td>}
            </tr>
          ))}
        </tbody>
      </table>

      <ul className="settings-card-list mobile-only">
        {rules.map((rule, index) => (
          <li key={rule.id} className="settings-card">
            <div className="settings-card-header">
              <span className="settings-card-title guardrail-break">{rule.name}</span>
            </div>
            <dl className="settings-card-fields">
              <div>
                <dt>{msg.columns.category}</dt>
                <dd>{GUARDRAIL_CATEGORY_LABELS[rule.category]}</dd>
              </div>
              <div>
                <dt>{msg.columns.appliesTo}</dt>
                <dd>
                  <RuleStageText appliesTo={rule.appliesTo} />
                </dd>
              </div>
              <div>
                <dt>{msg.columns.action}</dt>
                <dd>
                  <RuleActionBadge action={rule.action} />
                </dd>
              </div>
              <div>
                <dt>{msg.columns.expressions}</dt>
                <dd>{rule.expressionCount}</dd>
              </div>
              <div>
                <dt>{msg.cardHitsLabel}</dt>
                <dd>{rule.recentHits7d}</dd>
              </div>
              <div>
                <dt>{msg.columns.warnings}</dt>
                <dd>
                  <RuleWarningList rule={rule} ragActive={ragActive} />
                </dd>
              </div>
              <div>
                <dt>{msg.columns.enabled}</dt>
                <dd>{enabledControl(rule, 'm')}</dd>
              </div>
            </dl>
            {canWrite && (
              <div className="settings-card-actions">
                {moveButtons(rule, index, 'm')}
                {operations(rule)}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
