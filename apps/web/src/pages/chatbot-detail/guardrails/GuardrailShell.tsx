import { useCallback, useEffect, useMemo, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import type { GuardrailRule, GuardrailRuleListResponse } from '@chat-bot/shared-types';
import { useChatbotDetailContext } from '../../ChatbotDetailLayout';
import { useAuth } from '../../../context/AuthContext';
import { guardrailsApi } from '../../../api/guardrails';
import { useLatestRequest } from '../../../lib/useLatestRequest';
import { MESSAGES } from '../../../constants/messages';
import { ArchivedBanner } from '../ArchivedBanner';
import type { GuardrailContext } from './guardrailContext';

/**
 * 챗봇 상세 "검증" 그룹 4번째 탭 "안전 가드레일"의 셸(ai-guardrails-ui-spec.md §3, GR-0). 서브내비 4 + 공통 배너 +
 * 규칙 목록 1회 조회(`ragActive`·`serverEnabled`가 규칙 목록 응답에만 있어서다 — 조정 A-3). 셸 조회가 실패해도
 * 현황·걸린 기록은 자체 API로 동작하므로 서브내비와 `Outlet`은 항상 그린다.
 */
export function GuardrailShell(): JSX.Element {
  const ctx = useChatbotDetailContext();
  const { chatbot } = ctx;
  const { can } = useAuth();
  const msg = MESSAGES.guardrails.shell;
  const isArchived = chatbot.status === 'ARCHIVED';
  const canWrite = can('security:write') && !isArchived;

  const [rules, setRulesState] = useState<GuardrailRule[]>([]);
  const [meta, setMeta] = useState<GuardrailRuleListResponse['meta'] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const guard = useLatestRequest();

  const load = useCallback(
    async (silent: boolean) => {
      const reqId = guard.next();
      if (!silent) {
        setLoading(true);
        setError(false);
      }
      try {
        const res = await guardrailsApi.listRules(chatbot.id);
        if (guard.isStale(reqId)) return;
        setRulesState(res.items);
        setMeta(res.meta);
        setError(false);
      } catch {
        if (guard.isStale(reqId)) return;
        // 이미 받아 둔 목록이 있으면 조용히 유지한다(silent 새로고침 실패로 화면을 비우지 않는다).
        if (!silent) setError(true);
      } finally {
        if (!guard.isStale(reqId)) setLoading(false);
      }
    },
    [chatbot.id, guard],
  );

  useEffect(() => {
    void load(false);
  }, [load]);

  const reload = useCallback(() => load(true), [load]);
  const setRules = useCallback((next: GuardrailRule[]) => setRulesState(next), []);

  const shared = useMemo(
    () => ({ rules, meta, loading, error, reload, setRules, canWrite }),
    [rules, meta, loading, error, reload, setRules, canWrite],
  );

  const subNavClassName = ({ isActive }: { isActive: boolean }): string => `stats-subnav-link${isActive ? ' stats-subnav-link--active' : ''}`;
  const base = `/chatbots/${chatbot.id}/guardrails`;

  return (
    <div className="stats-shell guardrail-shell">
      <h1 className="guardrail-shell-title">{MESSAGES.detail.tabGuardrails}</h1>
      <p className="field-hint guardrail-shell-subtitle">{msg.subtitle}</p>
      <ArchivedBanner visible={isArchived} />
      {meta && !meta.serverEnabled && (
        <p className="form-banner form-banner--warning">
          <span aria-hidden="true">⚠</span> {msg.serverOffBanner}
        </p>
      )}
      <p className="form-banner form-banner--info">
        <span aria-hidden="true">ⓘ</span> {msg.immediateNotice}
      </p>
      <nav className="stats-subnav" aria-label={msg.subNavLabel}>
        <NavLink to={`${base}/rules`} className={subNavClassName}>
          {msg.tabRules}
        </NavLink>
        <NavLink to={`${base}/pii`} className={subNavClassName}>
          {msg.tabPii}
        </NavLink>
        <NavLink to={`${base}/overview`} className={subNavClassName}>
          {msg.tabOverview}
        </NavLink>
        <NavLink to={`${base}/events`} className={subNavClassName}>
          {msg.tabEvents}
        </NavLink>
      </nav>
      <div className="stats-content" aria-busy={loading}>
        <Outlet context={{ ...ctx, guardrail: shared } satisfies GuardrailContext} />
      </div>
    </div>
  );
}
