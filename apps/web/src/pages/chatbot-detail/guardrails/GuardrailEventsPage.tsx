import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { GuardrailAppliedAction, GuardrailEventItem, GuardrailStage } from '@chat-bot/shared-types';
import { GUARDRAIL_APPLIES_TO_LABELS, GUARDRAIL_CATEGORY_LABELS, GUARDRAIL_PII_KIND_LABELS, GuardrailAppliedAction as AppliedActionEnum } from '@chat-bot/shared-types';
import { ApiError } from '../../../api/client';
import { guardrailsApi } from '../../../api/guardrails';
import { EmptyState } from '../../../components/EmptyState';
import { ErrorState } from '../../../components/ErrorState';
import { GovernanceViewAuditBanner } from '../../../components/GovernanceViewAuditBanner';
import { Pagination } from '../../../components/Pagination';
import { SeverityBadge, type Severity } from '../../../components/SeverityBadge';
import { SkeletonRow } from '../../../components/Skeleton';
import { useAuth } from '../../../context/AuthContext';
import { MESSAGES } from '../../../constants/messages';
import { addDaysToDateInputValue, formatDateTime, kstTodayDateInputValue } from '../../../lib/date';
import { useLatestRequest } from '../../../lib/useLatestRequest';
import { checkPeriod } from './guardrailPeriod';
import { useGuardrailContext } from './guardrailContext';

const PAGE_SIZE = 50;

interface AppliedFilters {
  from: string;
  to: string;
  ruleId: string;
  stage: GuardrailStage | '';
  appliedAction: GuardrailAppliedAction | '';
  page: number;
}

/** 대화 마스킹본 펼침(추가 API 호출 없음 — 목록 응답에 실려 온 본문). 글자로만 렌더한다(HTML 해석 없음). */
export function ConversationMaskedView({ conversation }: { conversation: GuardrailEventItem['conversation'] }): JSX.Element {
  const m = MESSAGES.guardrails.events;
  if (conversation === null) return <p>{m.noConversation}</p>;
  if (conversation.textPurged) return <p>{m.purged}</p>;
  return (
    <div className="guardrail-conversation">
      <p className="field-hint">{m.maskedNotice}</p>
      <p className="field-label-static">{m.userMessageTitle}</p>
      <p className="guardrail-result-text">{conversation.userMessage}</p>
      <p className="field-label-static">{m.botResponseTitle}</p>
      <p className="guardrail-result-text">{conversation.botResponse}</p>
    </div>
  );
}

function appliedSeverity(a: GuardrailAppliedAction): Severity {
  return a === 'MONITOR' || a === 'MASK' ? 'INFO' : 'WARNING';
}

function stageLabel(stage: GuardrailStage): string {
  return GUARDRAIL_APPLIES_TO_LABELS[stage];
}

/** GR-5 걸린 기록(목록 + 대화 보기) — `ai-guardrails-ui-spec.md` §8. 필터는 "조회" 버튼으로만 적용하고 URL과 동기화한다. */
export function GuardrailEventsPage(): JSX.Element {
  const { chatbot, guardrail } = useGuardrailContext();
  const { rules, error: rulesError, loading: rulesLoading, canWrite } = guardrail;
  const { user } = useAuth();
  const m = MESSAGES.guardrails.events;
  const [searchParams, setSearchParams] = useSearchParams();

  const today = kstTodayDateInputValue();
  const applied: AppliedFilters = useMemo(
    () => ({
      from: searchParams.get('from') || addDaysToDateInputValue(today, -6),
      to: searchParams.get('to') || today,
      ruleId: searchParams.get('ruleId') ?? '',
      stage: (searchParams.get('stage') as GuardrailStage | null) ?? '',
      appliedAction: (searchParams.get('appliedAction') as GuardrailAppliedAction | null) ?? '',
      page: Math.max(1, Number(searchParams.get('page') ?? '1') || 1),
    }),
    [searchParams, today],
  );

  // 입력 중인 값(조회를 눌러야 적용된다).
  const [draft, setDraft] = useState<Omit<AppliedFilters, 'page'>>({ from: applied.from, to: applied.to, ruleId: applied.ruleId, stage: applied.stage, appliedAction: applied.appliedAction });
  const [periodError, setPeriodError] = useState<string | undefined>(undefined);
  useEffect(() => {
    setDraft({ from: applied.from, to: applied.to, ruleId: applied.ruleId, stage: applied.stage, appliedAction: applied.appliedAction });
  }, [applied.from, applied.to, applied.ruleId, applied.stage, applied.appliedAction]);

  const [items, setItems] = useState<GuardrailEventItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const guard = useLatestRequest();

  const load = useCallback(async () => {
    if (checkPeriod(applied.from, applied.to)) {
      setLoading(false);
      return;
    }
    const reqId = guard.next();
    setLoading(true);
    setLoadError(false);
    try {
      const res = await guardrailsApi.listEvents(chatbot.id, {
        from: applied.from,
        to: applied.to,
        ruleId: applied.ruleId || undefined,
        stage: applied.stage || undefined,
        appliedAction: applied.appliedAction || undefined,
        page: applied.page,
        pageSize: PAGE_SIZE,
      });
      if (guard.isStale(reqId)) return;
      setItems(res.items);
      setTotal(res.total);
      setExpanded(new Set());
    } catch (e) {
      if (guard.isStale(reqId)) return;
      if (e instanceof ApiError && e.code === 'STATS_RANGE_TOO_WIDE') setPeriodError(m.rangeTooWide);
      else if (e instanceof ApiError && e.code === 'INVALID_PERIOD') setPeriodError(m.rangeInvalid);
      else setLoadError(true);
    } finally {
      if (!guard.isStale(reqId)) setLoading(false);
    }
  }, [chatbot.id, applied, guard, m.rangeTooWide, m.rangeInvalid]);

  useEffect(() => {
    void load();
  }, [load]);

  function writeFilters(next: Partial<AppliedFilters>): void {
    const merged = { ...applied, ...next };
    const params: Record<string, string> = { from: merged.from, to: merged.to };
    if (merged.ruleId) params.ruleId = merged.ruleId;
    if (merged.stage) params.stage = merged.stage;
    if (merged.appliedAction) params.appliedAction = merged.appliedAction;
    if (merged.page > 1) params.page = String(merged.page);
    setSearchParams(params);
  }

  function handleSearch(): void {
    const problem = checkPeriod(draft.from, draft.to);
    if (problem) {
      setPeriodError(problem === 'TOO_WIDE' ? m.rangeTooWide : problem === 'INVALID' ? m.rangeInvalid : m.rangeRequired);
      return;
    }
    setPeriodError(undefined);
    // 필터를 바꾸면 1페이지로.
    writeFilters({ ...draft, page: 1 });
  }

  function handleClear(): void {
    setPeriodError(undefined);
    setSearchParams({});
  }

  function toggle(id: string): void {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const hasFilter = Boolean(applied.ruleId || applied.stage || applied.appliedAction);
  const ruleOptions = rules;
  const urlRuleMissing = applied.ruleId && !ruleOptions.some((r) => r.id === applied.ruleId);

  function contentCell(item: GuardrailEventItem): JSX.Element {
    if (item.kind === 'PII') {
      const kind = item.piiKind ? GUARDRAIL_PII_KIND_LABELS[item.piiKind] : '';
      return <>{m.piiContent(kind, item.piiCount ?? 0)}</>;
    }
    if (item.kind === 'ERROR') return <>{m.errorContent(item.errorCode ?? '—')}</>;
    const deleted = item.ruleId !== null && !ruleOptions.some((r) => r.id === item.ruleId) && !rulesLoading && !rulesError;
    return (
      <>
        {m.ruleContent(item.ruleName ?? '—', item.category ? GUARDRAIL_CATEGORY_LABELS[item.category] : '—')}
        {deleted && <span className="field-hint"> {m.deletedRule}</span>}
      </>
    );
  }

  function expandButton(item: GuardrailEventItem, variant: string): JSX.Element {
    const open = expanded.has(item.id);
    const panelId = `gr-event-${variant}-${item.id}`;
    return (
      <button
        type="button"
        className="btn btn-secondary"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={m.viewConversationLabel(formatDateTime(item.createdAt))}
        onClick={() => toggle(item.id)}
      >
        {open ? m.hideConversation : m.viewConversation} <span aria-hidden="true">{open ? '▴' : '▸'}</span>
      </button>
    );
  }

  return (
    <div className="guardrail-events-page" aria-busy={loading}>
      <h2 tabIndex={-1}>{m.title}</h2>
      <GovernanceViewAuditBanner visible={user?.governanceModeOn ?? false} />

      <form
        className="guardrail-event-filter"
        onSubmit={(e) => {
          e.preventDefault();
          handleSearch();
        }}
        noValidate
      >
        <div className="form-field">
          <label htmlFor="gr-ev-from">{m.filterFrom}</label>
          <input id="gr-ev-from" type="date" value={draft.from} onChange={(e) => setDraft((p) => ({ ...p, from: e.target.value }))} />
        </div>
        <div className="form-field">
          <label htmlFor="gr-ev-to">{m.filterTo}</label>
          <input id="gr-ev-to" type="date" value={draft.to} onChange={(e) => setDraft((p) => ({ ...p, to: e.target.value }))} />
        </div>
        <div className="form-field">
          <label htmlFor="gr-ev-rule">{m.filterRule}</label>
          <select id="gr-ev-rule" value={draft.ruleId} disabled={rulesError} onChange={(e) => setDraft((p) => ({ ...p, ruleId: e.target.value }))}>
            <option value="">{m.filterAll}</option>
            {ruleOptions.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
            {urlRuleMissing && <option value={applied.ruleId}>{m.deletedRule}</option>}
          </select>
        </div>
        <div className="form-field">
          <label htmlFor="gr-ev-stage">{m.filterStage}</label>
          <select id="gr-ev-stage" value={draft.stage} onChange={(e) => setDraft((p) => ({ ...p, stage: e.target.value as GuardrailStage | '' }))}>
            <option value="">{m.filterAll}</option>
            <option value="INBOUND">{GUARDRAIL_APPLIES_TO_LABELS.INBOUND}</option>
            <option value="OUTBOUND">{GUARDRAIL_APPLIES_TO_LABELS.OUTBOUND}</option>
          </select>
        </div>
        <div className="form-field">
          <label htmlFor="gr-ev-applied">{m.filterAction}</label>
          <select
            id="gr-ev-applied"
            value={draft.appliedAction}
            onChange={(e) => setDraft((p) => ({ ...p, appliedAction: e.target.value as GuardrailAppliedAction | '' }))}
          >
            <option value="">{m.filterAll}</option>
            {AppliedActionEnum.options.map((a) => (
              <option key={a} value={a}>
                {m.applied[a]}
              </option>
            ))}
          </select>
        </div>
        <div className="guardrail-filter-actions">
          <button type="submit" className="btn btn-primary">
            {m.search}
          </button>
          <button type="button" className="btn btn-secondary" onClick={handleClear}>
            {m.clear}
          </button>
        </div>
      </form>
      {periodError && (
        <p className="field-error" role="alert">
          <span aria-hidden="true">⚠</span> {periodError}
        </p>
      )}
      {rulesError && <p className="field-hint">{MESSAGES.guardrails.shell.ruleFilterUnavailable}</p>}

      <p role="status" className="sr-only">
        {!loading && !loadError ? m.resultCount(total) : ''}
      </p>

      {loadError ? (
        <ErrorState title={m.loadFailed} onRetry={() => void load()} />
      ) : loading ? (
        <div>
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
        </div>
      ) : items.length === 0 ? (
        hasFilter ? (
          <EmptyState
            title={m.emptyFiltered}
            action={
              <button type="button" className="btn btn-secondary" onClick={handleClear}>
                {m.clear}
              </button>
            }
          />
        ) : (
          <EmptyState
            title={m.emptyTitle}
            action={
              rules.length === 0 && !rulesLoading && !rulesError && canWrite ? (
                <Link to={`/chatbots/${chatbot.id}/guardrails/rules/new`} className="btn btn-secondary">
                  {MESSAGES.guardrails.overview.emptyMakeRule}
                </Link>
              ) : undefined
            }
          />
        )
      ) : (
        <>
          <table className="dialogue-table desktop-only guardrail-events-table">
            <caption>{m.caption(total)}</caption>
            <thead>
              <tr>
                <th scope="col">{m.columns.at}</th>
                <th scope="col">{m.columns.stage}</th>
                <th scope="col">{m.columns.content}</th>
                <th scope="col">{m.columns.applied}</th>
                <th scope="col">{m.columns.effect}</th>
                <th scope="col">{m.columns.conversation}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <EventRows key={item.id} item={item} open={expanded.has(item.id)} content={contentCell(item)} button={expandButton(item, 'd')} panelId={`gr-event-d-${item.id}`} />
              ))}
            </tbody>
          </table>
          <ul className="settings-card-list mobile-only">
            {items.map((item) => (
              <li key={item.id} className="settings-card">
                <div className="settings-card-header">
                  <span className="settings-card-title">{formatDateTime(item.createdAt)}</span>
                </div>
                <dl className="settings-card-fields">
                  <div>
                    <dt>{m.columns.stage}</dt>
                    <dd>{stageLabel(item.stage)}</dd>
                  </div>
                  <div>
                    <dt>{m.columns.content}</dt>
                    <dd className="guardrail-break">{contentCell(item)}</dd>
                  </div>
                  <div>
                    <dt>{m.columns.applied}</dt>
                    <dd>
                      <SeverityBadge severity={appliedSeverity(item.appliedAction)} label={m.applied[item.appliedAction]} />
                    </dd>
                  </div>
                  <div>
                    <dt>{m.columns.effect}</dt>
                    <dd>{item.effect === 'CHANGED' ? m.effectChanged : m.effectNone}</dd>
                  </div>
                </dl>
                <div className="settings-card-actions">{expandButton(item, 'm')}</div>
                {expanded.has(item.id) && (
                  <div id={`gr-event-m-${item.id}`}>
                    <ConversationMaskedView conversation={item.conversation} />
                  </div>
                )}
              </li>
            ))}
          </ul>
          <Pagination page={applied.page} pageSize={PAGE_SIZE} total={total} onPageChange={(p) => writeFilters({ page: p })} />
        </>
      )}
    </div>
  );
}

function EventRows({ item, open, content, button, panelId }: { item: GuardrailEventItem; open: boolean; content: JSX.Element; button: JSX.Element; panelId: string }): JSX.Element {
  const m = MESSAGES.guardrails.events;
  return (
    <>
      <tr>
        <td>{formatDateTime(item.createdAt)}</td>
        <td>{stageLabel(item.stage)}</td>
        <td className="guardrail-break">{content}</td>
        <td>
          <SeverityBadge severity={appliedSeverity(item.appliedAction)} label={m.applied[item.appliedAction]} />
        </td>
        <td>{item.effect === 'CHANGED' ? m.effectChanged : m.effectNone}</td>
        <td>{button}</td>
      </tr>
      {open && (
        <tr>
          <td colSpan={6} id={panelId}>
            <ConversationMaskedView conversation={item.conversation} />
          </td>
        </tr>
      )}
    </>
  );
}
