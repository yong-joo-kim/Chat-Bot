import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { GuardrailOverview } from '@chat-bot/shared-types';
import { ApiError } from '../../../api/client';
import { guardrailsApi } from '../../../api/guardrails';
import { EmptyState } from '../../../components/EmptyState';
import { ErrorState } from '../../../components/ErrorState';
import { SkeletonCard, SkeletonRow } from '../../../components/Skeleton';
import { useAuth } from '../../../context/AuthContext';
import { MESSAGES } from '../../../constants/messages';
import { useLatestRequest } from '../../../lib/useLatestRequest';
import { addDaysToDateInputValue, kstTodayDateInputValue } from '../../../lib/date';
import { PeriodSelector, type PeriodPreset } from '../PeriodSelector';
import { checkPeriod, computeRange } from './guardrailPeriod';
import { useGuardrailContext } from './guardrailContext';
import { HitlProcedureTable, OverviewSummaryCards, PiiCountTable, RuleHitTable, SoloRollbackAlertList } from './OverviewParts';

/** GR-4 현황(요약 카드 · 규칙별 · 가림 종류별 · 승인 없이 되돌린 알림 · 사람이 확인하는 절차) — `ai-guardrails-ui-spec.md` §7. */
export function GuardrailOverviewPage(): JSX.Element {
  const { chatbot, guardrail } = useGuardrailContext();
  const { rules: savedRules, meta } = guardrail;
  const { can } = useAuth();
  const msg = MESSAGES.guardrails.overview;
  const shellMsg = MESSAGES.guardrails.shell;
  const [searchParams, setSearchParams] = useSearchParams();

  const urlFrom = searchParams.get('from') ?? '';
  const urlTo = searchParams.get('to') ?? '';
  const today = kstTodayDateInputValue();
  const [preset, setPreset] = useState<PeriodPreset>(urlFrom && urlTo ? 'CUSTOM' : '7D');
  const [customFrom, setCustomFrom] = useState(urlFrom || addDaysToDateInputValue(today, -6));
  const [customTo, setCustomTo] = useState(urlTo || today);
  const range = useMemo(() => computeRange(preset, customFrom, customTo), [preset, customFrom, customTo]);
  const problem = checkPeriod(range.from, range.to);

  const [overview, setOverview] = useState<GuardrailOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [serverProblem, setServerProblem] = useState<'TOO_WIDE' | 'INVALID' | null>(null);
  const guard = useLatestRequest();

  const load = useCallback(async () => {
    if (checkPeriod(range.from, range.to)) return;
    const reqId = guard.next();
    setLoading(true);
    setError(false);
    setServerProblem(null);
    try {
      const res = await guardrailsApi.getOverview(chatbot.id, { from: range.from, to: range.to });
      if (guard.isStale(reqId)) return;
      setOverview(res);
    } catch (e) {
      if (guard.isStale(reqId)) return;
      if (e instanceof ApiError && e.code === 'STATS_RANGE_TOO_WIDE') setServerProblem('TOO_WIDE');
      else if (e instanceof ApiError && e.code === 'INVALID_PERIOD') setServerProblem('INVALID');
      else setError(true);
    } finally {
      if (!guard.isStale(reqId)) setLoading(false);
    }
  }, [chatbot.id, range.from, range.to, guard]);

  useEffect(() => {
    void load();
  }, [load]);

  // 기간은 URL(`?from=&to=`)과 동기화한다(유효할 때만 — 잘못된 값을 주소에 남기지 않는다).
  useEffect(() => {
    if (problem) return;
    setSearchParams({ from: range.from, to: range.to }, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range.from, range.to, problem]);

  const shownProblem = problem === 'TOO_WIDE' || serverProblem === 'TOO_WIDE' ? 'TOO_WIDE' : problem === 'INVALID' || serverProblem === 'INVALID' ? 'INVALID' : null;
  const problemText = shownProblem === 'TOO_WIDE' ? msg.rangeTooWide : shownProblem === 'INVALID' ? msg.rangeInvalid : undefined;

  const serverOff = overview ? !overview.serverEnabled : meta ? !meta.serverEnabled : false;
  const shellShowsBanner = meta ? !meta.serverEnabled : false;
  const allZero =
    overview !== null &&
    overview.rules.every((r) => r.inboundHits + r.outboundHits === 0) &&
    overview.totals.inboundHits + overview.totals.outboundHits + overview.totals.maskedAnswers + overview.totals.errorFallbacks === 0;

  return (
    <div className="guardrail-overview-page" aria-busy={loading}>
      <div className="dashboard-toolbar">
        <h2 tabIndex={-1}>{msg.title}</h2>
        <PeriodSelector
          preset={preset}
          onPresetChange={setPreset}
          from={customFrom}
          to={customTo}
          onFromChange={setCustomFrom}
          onToChange={setCustomTo}
        />
      </div>
      {problemText && (
        <p className="field-error" role="alert">
          <span aria-hidden="true">⚠</span> {problemText}
        </p>
      )}

      {serverOff && !shellShowsBanner && (
        <p className="form-banner form-banner--warning">
          <span aria-hidden="true">⚠</span> {shellMsg.serverOffBanner}
        </p>
      )}

      {error ? (
        <ErrorState title={msg.loadFailed} onRetry={() => void load()} />
      ) : loading && !overview ? (
        <>
          <div className="dashboard-cards">
            {Array.from({ length: 7 }, (_, i) => (
              <SkeletonCard key={i} />
            ))}
          </div>
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
        </>
      ) : overview ? (
        <>
          <OverviewSummaryCards overview={overview} />
          <p className="field-hint">
            <span aria-hidden="true">ⓘ</span> {msg.hitDefinition}
          </p>
          <p className="field-hint">
            <span aria-hidden="true">ⓘ</span>{' '}
            {msg.ratioDefinition(
              overview.rag.delivered,
              overview.rag.replaced,
              overview.rag.fallbackOnError,
              overview.rag.delivered + overview.rag.replaced + overview.rag.fallbackOnError,
              overview.rag.replaced,
            )}
          </p>
          {serverOff && <p className="field-hint">{msg.serverOffLine}</p>}

          <h3>{msg.ruleTable.title}</h3>
          {allZero || overview.rules.length === 0 ? (
            <EmptyState
              title={msg.emptyTitle}
              description={savedRules.length === 0 && !guardrail.loading && !guardrail.error ? msg.emptyNoRules : undefined}
              action={
                savedRules.length === 0 && !guardrail.loading && !guardrail.error && guardrail.canWrite ? (
                  <Link to={`/chatbots/${chatbot.id}/guardrails/rules/new`} className="btn btn-secondary">
                    {msg.emptyMakeRule}
                  </Link>
                ) : undefined
              }
            />
          ) : (
            <RuleHitTable rules={overview.rules} chatbotId={chatbot.id} from={range.from} to={range.to} />
          )}

          <h3>{msg.piiTable.title}</h3>
          <PiiCountTable rows={overview.pii} />

          <SoloRollbackAlertList alerts={overview.alerts} chatbotId={chatbot.id} />
        </>
      ) : null}

      {/* 절차 표는 정적이라 조회가 실패해도 그대로 보인다(2인 승인 셀만 "확인 중"). */}
      <HitlProcedureTable hitl={overview?.hitl ?? null} chatbotId={chatbot.id} can={can} />
    </div>
  );
}
