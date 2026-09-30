import { Link } from 'react-router-dom';
import type { GuardrailOverview, Permission } from '@chat-bot/shared-types';
import { GUARDRAIL_CATEGORY_LABELS, GUARDRAIL_PII_KIND_LABELS } from '@chat-bot/shared-types';
import { MESSAGES } from '../../../constants/messages';
import { formatDateTime, formatPercent } from '../../../lib/date';
import { MetricCard } from '../MetricCard';
import { RuleActionBadge } from './RuleBadges';

/** 요약 카드 7(§7.2). 값 옆에 글자 레이블을 항상 병기하고, 0이어도 카드를 숨기지 않는다. */
export function OverviewSummaryCards({ overview }: { overview: GuardrailOverview }): JSX.Element {
  const c = MESSAGES.guardrails.overview.cards;
  const t = overview.totals;
  const ratio = overview.rag.replacedRatio;
  return (
    <div className="dashboard-cards guardrail-summary-cards" role="group" aria-label={MESSAGES.guardrails.overview.cardsLabel}>
      <MetricCard label={c.inbound.label} value={String(t.inboundHits)} caption={c.inbound.caption} />
      <MetricCard label={c.outbound.label} value={String(t.outboundHits)} caption={c.outbound.caption} />
      <MetricCard label={c.replaced.label} value={String(t.replaced)} caption={c.replaced.caption} />
      <MetricCard label={c.noRag.label} value={String(t.noRag)} caption={c.noRag.caption} />
      <MetricCard label={c.masked.label} value={String(t.maskedAnswers)} caption={c.masked.caption} />
      <MetricCard label={c.errors.label} value={String(t.errorFallbacks)} caption={c.errors.caption} />
      <MetricCard
        label={c.ratio.label}
        value={ratio === null ? MESSAGES.guardrails.overview.ratioNone : formatPercent(ratio)}
        srValue={ratio === null ? MESSAGES.guardrails.overview.ratioNoneLabel : undefined}
        caption={c.ratio.caption}
      />
    </div>
  );
}

/** 규칙별 걸림 표(데스크톱) + 카드(모바일). 서버 집계를 그대로 표시한다(클라이언트 합계 재계산 없음). */
export function RuleHitTable({ rules, chatbotId, from, to }: { rules: GuardrailOverview['rules']; chatbotId: string; from: string; to: string }): JSX.Element {
  const m = MESSAGES.guardrails.overview.ruleTable;
  const linkFor = (r: GuardrailOverview['rules'][number]): string =>
    `/chatbots/${chatbotId}/guardrails/events?ruleId=${encodeURIComponent(r.ruleId)}&from=${from}&to=${to}`;
  const nameCell = (r: GuardrailOverview['rules'][number]): string =>
    `${r.ruleName}${r.category ? `(${GUARDRAIL_CATEGORY_LABELS[r.category]})` : ''}`;
  const actionCell = (r: GuardrailOverview['rules'][number]): JSX.Element =>
    r.deleted || !r.currentAction ? (
      <span>—</span>
    ) : (
      <>
        <RuleActionBadge action={r.currentAction} />
        {r.currentEnabled === false && <span className="field-hint"> {MESSAGES.guardrails.rules.enabledLabelOff}</span>}
      </>
    );
  return (
    <>
      <table className="dialogue-table desktop-only">
        <caption>{m.caption}</caption>
        <thead>
          <tr>
            <th scope="col">{m.columns.rule}</th>
            <th scope="col">{m.columns.action}</th>
            <th scope="col">{m.columns.inbound}</th>
            <th scope="col">{m.columns.outbound}</th>
            <th scope="col">{m.columns.changed}</th>
            <th scope="col">
              <span className="sr-only">{m.columns.link}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rules.map((r) => (
            <tr key={r.ruleId}>
              <td className="guardrail-break">
                {nameCell(r)}
                {r.deleted && <span className="field-hint"> {m.deleted}</span>}
              </td>
              <td>{actionCell(r)}</td>
              <td>{r.inboundHits}</td>
              <td>{r.outboundHits}</td>
              <td>{r.changedHits}</td>
              <td>
                {!r.deleted && (
                  <Link to={linkFor(r)} aria-label={m.viewEventsLabel(r.ruleName)}>
                    {m.viewEvents}
                  </Link>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <ul className="settings-card-list mobile-only">
        {rules.map((r) => (
          <li key={r.ruleId} className="settings-card">
            <div className="settings-card-header">
              <span className="settings-card-title guardrail-break">{nameCell(r)}</span>
            </div>
            <dl className="settings-card-fields">
              <div>
                <dt>{m.columns.action}</dt>
                <dd>{actionCell(r)}</dd>
              </div>
              <div>
                <dt>{m.columns.inbound}</dt>
                <dd>{r.inboundHits}</dd>
              </div>
              <div>
                <dt>{m.columns.outbound}</dt>
                <dd>{r.outboundHits}</dd>
              </div>
              <div>
                <dt>{m.columns.changed}</dt>
                <dd>{r.changedHits}</dd>
              </div>
            </dl>
            {!r.deleted && (
              <div className="settings-card-actions">
                <Link to={linkFor(r)} aria-label={m.viewEventsLabel(r.ruleName)}>
                  {m.viewEvents}
                </Link>
              </div>
            )}
          </li>
        ))}
      </ul>
      <p className="field-hint">{m.note}</p>
    </>
  );
}

/** 개인정보 가림 종류별 표. 없으면 "이 기간에 가린 번호가 없습니다." */
export function PiiCountTable({ rows }: { rows: GuardrailOverview['pii'] }): JSX.Element {
  const m = MESSAGES.guardrails.overview.piiTable;
  if (rows.length === 0) return <p>{m.empty}</p>;
  return (
    <>
      <table className="dialogue-table desktop-only">
        <caption>{m.caption}</caption>
        <thead>
          <tr>
            <th scope="col">{m.kind}</th>
            <th scope="col">{m.answers}</th>
            <th scope="col">{m.count}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.kind}>
              <td>{GUARDRAIL_PII_KIND_LABELS[r.kind]}</td>
              <td>{r.answers}</td>
              <td>{r.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <ul className="settings-card-list mobile-only">
        {rows.map((r) => (
          <li key={r.kind} className="settings-card">
            <div className="settings-card-header">
              <span className="settings-card-title">{GUARDRAIL_PII_KIND_LABELS[r.kind]}</span>
            </div>
            <dl className="settings-card-fields">
              <div>
                <dt>{m.answers}</dt>
                <dd>{r.answers}</dd>
              </div>
              <div>
                <dt>{m.count}</dt>
                <dd>{r.count}</dd>
              </div>
            </dl>
          </li>
        ))}
      </ul>
    </>
  );
}

/** 승인 없이 되돌린 기록 — 사후 확인용 정적 섹션이라 `role="alert"`를 쓰지 않는다. */
export function SoloRollbackAlertList({ alerts, chatbotId }: { alerts: GuardrailOverview['alerts']; chatbotId: string }): JSX.Element {
  const m = MESSAGES.guardrails.overview.alerts;
  return (
    <section aria-labelledby="gr-alerts-title" className="guardrail-alerts">
      <h3 id="gr-alerts-title">{m.title}</h3>
      <p>{m.desc}</p>
      {alerts.length === 0 ? (
        <p>{m.empty}</p>
      ) : (
        <table className="dialogue-table">
          <caption className="sr-only">{m.caption}</caption>
          <thead>
            <tr>
              <th scope="col">{m.columns.at}</th>
              <th scope="col">{m.columns.actor}</th>
              <th scope="col">{m.columns.versions}</th>
              <th scope="col">
                <span className="sr-only">{MESSAGES.common.actionsColumnLabel}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {alerts.map((a) => (
              <tr key={a.switchLogId}>
                <td>{formatDateTime(a.at)}</td>
                <td className="guardrail-break">{a.actorEmail ?? '—'}</td>
                <td>{m.row(a.toVersionNo, a.fromVersionNo)}</td>
                <td>
                  <Link to={`/chatbots/${chatbotId}/environment`}>{m.link}</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

type HitlKey = keyof typeof MESSAGES.guardrails.overview.hitl.rows;

interface HitlRowDef {
  key: HitlKey;
  /** 바로가기 경로와 필요 권한(모두 있어야 링크를 렌더한다 — 없으면 글자만, F-4). */
  href: (chatbotId: string) => string;
  permissions: Permission[];
}

const HITL_ROWS: HitlRowDef[] = [
  { key: 'H1', href: (id) => `/chatbots/${id}/dialogue/intents`, permissions: ['dialogue:read'] },
  { key: 'H2', href: (id) => `/chatbots/${id}/stats/utterance-analyses`, permissions: ['dialogue:read'] },
  { key: 'H3', href: (id) => `/chatbots/${id}/stats/learning`, permissions: ['dialogue:read'] },
  { key: 'H4', href: (id) => `/chatbots/${id}/environment`, permissions: ['chatbot:read', 'dialogue:read'] },
  { key: 'H5', href: (id) => `/chatbots/${id}/deploy-schedules`, permissions: ['chatbot:read'] },
  { key: 'H6', href: (id) => `/chatbots/${id}/versions`, permissions: ['chatbot:read'] },
  { key: 'H7', href: (id) => `/handoff-console/${id}/live`, permissions: ['cs:read'] },
  { key: 'H8', href: () => '/settings/workflow-automation', permissions: ['security:read'] },
  { key: 'H9', href: () => '/settings/kb-crawling', permissions: ['security:read'] },
  { key: 'H10', href: (id) => `/chatbots/${id}/guardrails/rules`, permissions: ['security:read'] },
];

function approvalCell(key: HitlKey, hitl: GuardrailOverview['hitl'] | null): string {
  const h = MESSAGES.guardrails.overview.hitl;
  switch (key) {
    case 'H4':
      if (!hitl) return MESSAGES.guardrails.overview.unknownDelta;
      return !hitl.envModeOn ? h.approvalEnvOff : hitl.approvalRequired ? h.approvalOn : h.approvalOff;
    case 'H5':
      if (!hitl) return MESSAGES.guardrails.overview.unknownDelta;
      return !hitl.envModeOn ? h.approvalEnvOff : hitl.approvalRequired ? h.approvalScheduledOn : h.approvalScheduledOff;
    case 'H6':
      return h.approvalNoneNoDirect;
    case 'H7':
    case 'H10':
      return h.approvalNotApplicable;
    case 'H8':
      return h.approvalOutOfScope;
    default:
      return h.approvalNone;
  }
}

/** 사람이 확인하는 절차 표(읽기 전용 · 데이터 변경 0). 값을 못 받았어도(`hitl=null`) 정적 표는 그대로 보인다. */
export function HitlProcedureTable({ hitl, chatbotId, can }: { hitl: GuardrailOverview['hitl'] | null; chatbotId: string; can: (p: Permission) => boolean }): JSX.Element {
  const m = MESSAGES.guardrails.overview.hitl;
  const link = (row: HitlRowDef): JSX.Element | null => {
    if (!row.permissions.every((p) => can(p))) return null;
    return (
      <Link to={row.href(chatbotId)} aria-label={`${m.rows[row.key].name} ${m.linkText}`}>
        {m.linkText}
      </Link>
    );
  };
  return (
    <section aria-labelledby="gr-hitl-title" className="guardrail-hitl">
      <h3 id="gr-hitl-title">{m.title}</h3>
      <p>{m.desc}</p>
      <table className="dialogue-table desktop-only">
        <caption className="sr-only">{m.caption}</caption>
        <thead>
          <tr>
            <th scope="col">{m.columns.procedure}</th>
            <th scope="col">{m.columns.check}</th>
            <th scope="col">{m.columns.who}</th>
            <th scope="col">{m.columns.approval}</th>
            <th scope="col">{m.columns.link}</th>
          </tr>
        </thead>
        <tbody>
          {HITL_ROWS.map((row) => (
            <tr key={row.key}>
              <td>
                {row.key} {m.rows[row.key].name}
              </td>
              <td>{m.rows[row.key].check}</td>
              <td>{m.rows[row.key].who}</td>
              <td>{approvalCell(row.key, hitl)}</td>
              <td>{link(row)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <ul className="settings-card-list mobile-only">
        {HITL_ROWS.map((row) => (
          <li key={row.key} className="settings-card">
            <div className="settings-card-header">
              <span className="settings-card-title">
                {row.key} {m.rows[row.key].name}
              </span>
            </div>
            <dl className="settings-card-fields">
              <div>
                <dt>{m.columns.check}</dt>
                <dd>{m.rows[row.key].check}</dd>
              </div>
              <div>
                <dt>{m.columns.who}</dt>
                <dd>{m.rows[row.key].who}</dd>
              </div>
              <div>
                <dt>{m.columns.approval}</dt>
                <dd>{approvalCell(row.key, hitl)}</dd>
              </div>
            </dl>
            <div className="settings-card-actions">{link(row)}</div>
          </li>
        ))}
      </ul>
      <p className="field-hint">{m.footer}</p>
    </section>
  );
}
