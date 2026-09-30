import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import type { GuardrailRule } from '@chat-bot/shared-types';
import { ApiError } from '../../../api/client';
import { guardrailsApi } from '../../../api/guardrails';
import { ConfirmDialog } from '../../../components/Modal';
import { EmptyState } from '../../../components/EmptyState';
import { ErrorState } from '../../../components/ErrorState';
import { SkeletonRow } from '../../../components/Skeleton';
import { useToast } from '../../../components/Toast';
import { useAuth } from '../../../context/AuthContext';
import { MESSAGES } from '../../../constants/messages';
import { useGuardrailContext } from './guardrailContext';
import { GuardrailRuleTable } from './GuardrailRuleTable';
import { GuardrailTestPanel } from './GuardrailTestPanel';

/** GR-1 위험 응답 규칙 목록(`ai-guardrails-ui-spec.md` §4). 규칙 목록은 셸이 조회해 내려준다. */
export function GuardrailRuleListPage(): JSX.Element {
  const { chatbot, guardrail } = useGuardrailContext();
  const { rules, meta, loading, error, reload, setRules, canWrite } = guardrail;
  const { can } = useAuth();
  const { showToast } = useToast();
  const location = useLocation();
  const msg = MESSAGES.guardrails.rules;
  const shellMsg = MESSAGES.guardrails.shell;
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [status, setStatus] = useState('');
  const [busyRuleId, setBusyRuleId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<GuardrailRule | null>(null);
  const [deleting, setDeleting] = useState(false);

  // 규칙 저장·삭제 뒤 목록으로 돌아오면 제목으로 포커스를 옮긴다(행이 사라져 포커스를 잃지 않게).
  useEffect(() => {
    if ((location.state as { focusHeading?: boolean } | null)?.focusHeading) headingRef.current?.focus();
  }, [location.state]);

  const ragActive = meta?.ragActive ?? true;
  const limits = meta?.limits;
  const atLimit = Boolean(limits && limits.usedRules >= limits.maxRules);
  const nearExpressionLimit = Boolean(limits && limits.usedExpressions >= limits.maxExpressions * 0.9);

  async function handleToggle(rule: GuardrailRule): Promise<void> {
    if (busyRuleId) return;
    setBusyRuleId(rule.id);
    try {
      const updated = rule.enabled ? await guardrailsApi.disableRule(chatbot.id, rule.id) : await guardrailsApi.enableRule(chatbot.id, rule.id);
      // 낙관적 갱신 없이 응답으로만 바꾼다.
      setRules(rules.map((r) => (r.id === updated.id ? updated : r)));
      setStatus(updated.enabled ? msg.toggledOn(updated.name) : msg.toggledOff(updated.name));
    } catch (e) {
      showToast(e instanceof ApiError && e.status === 409 ? e.message : msg.toggleFailed);
    } finally {
      setBusyRuleId(null);
    }
  }

  async function handleMove(rule: GuardrailRule, direction: 'UP' | 'DOWN'): Promise<void> {
    if (busyRuleId) return;
    setBusyRuleId(rule.id);
    try {
      const next = await guardrailsApi.moveRule(chatbot.id, rule.id, direction);
      setRules(next);
      const position = next.findIndex((r) => r.id === rule.id) + 1;
      setStatus(msg.moved(rule.name, position));
    } catch {
      showToast(msg.moveFailed);
    } finally {
      setBusyRuleId(null);
    }
  }

  async function handleDeleteConfirm(): Promise<void> {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    const target = deleteTarget;
    try {
      await guardrailsApi.deleteRule(chatbot.id, target.id);
      setDeleteTarget(null);
      await reload();
      // 토스트가 라이브 영역이라 결과 문장은 1회만 낭독된다(알림 영역을 겹쳐 쓰지 않는다).
      showToast(msg.deleted(target.name));
      headingRef.current?.focus();
    } catch (e) {
      setDeleteTarget(null);
      if (e instanceof ApiError && e.status === 404) {
        showToast(msg.deleteNotFound);
        await reload();
        headingRef.current?.focus();
      } else {
        showToast(e instanceof ApiError && e.code === 'CHATBOT_ARCHIVED' ? MESSAGES.guardrails.form.errors.archived : msg.deleteFailed);
      }
    } finally {
      setDeleting(false);
    }
  }

  const addDisabledReasonId = 'guardrail-add-limit-reason';

  return (
    <div className="guardrail-rules-page">
      <div className="version-list-header">
        <h2 ref={headingRef} tabIndex={-1}>
          {msg.title}
        </h2>
        {meta && limits && (
          <p className="result-count-badge">
            {msg.countSummary(limits.usedRules, limits.maxRules, limits.usedExpressions, limits.maxExpressions)}
            {nearExpressionLimit && ` · ${msg.nearLimit}`}
          </p>
        )}
        {canWrite &&
          (atLimit ? (
            <span>
              <button type="button" className="btn btn-primary" aria-disabled="true" aria-describedby={addDisabledReasonId} onClick={(e) => e.preventDefault()}>
                {msg.addButton}
              </button>
              <span id={addDisabledReasonId} className="field-hint">
                {msg.limitReached(limits?.maxRules ?? 0, limits?.usedRules ?? 0)}
              </span>
            </span>
          ) : (
            <Link to={`/chatbots/${chatbot.id}/guardrails/rules/new`} className="btn btn-primary">
              {msg.addButton}
            </Link>
          ))}
      </div>

      <p className="form-banner form-banner--info">
        <span aria-hidden="true">ⓘ</span> {msg.limitationsNotice}
      </p>
      <p className="form-banner form-banner--info">
        <span aria-hidden="true">ⓘ</span> {msg.priorityNotice}
      </p>
      {meta && !meta.ragActive && (
        <p className="form-banner form-banner--info">
          <span aria-hidden="true">ⓘ</span> {shellMsg.ragInactiveBanner}{' '}
          {can('dialogue:read') && <Link to={`/chatbots/${chatbot.id}/answer-settings`}>{shellMsg.ragInactiveLink}</Link>}
        </p>
      )}

      <p role="status" className="sr-only">
        {status}
      </p>

      <GuardrailTestPanel chatbotId={chatbot.id} mode="rules" />

      {loading && rules.length === 0 ? (
        <div aria-busy="true">
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
        </div>
      ) : error ? (
        <ErrorState title={msg.loadFailed} onRetry={() => void reload()} />
      ) : rules.length === 0 ? (
        canWrite ? (
          <EmptyState
            title={msg.emptyTitle}
            description={msg.emptyDesc}
            action={
              <div>
                <ol className="guardrail-empty-steps">
                  {msg.emptySteps.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ol>
                <Link to={`/chatbots/${chatbot.id}/guardrails/rules/new`} className="btn btn-primary">
                  {msg.addButton}
                </Link>
              </div>
            }
          />
        ) : (
          <EmptyState title={msg.emptyReadOnly} />
        )
      ) : (
        <GuardrailRuleTable
          chatbotId={chatbot.id}
          rules={rules}
          canWrite={canWrite}
          ragActive={ragActive}
          busyRuleId={busyRuleId}
          onToggle={(r) => void handleToggle(r)}
          onMove={(r, d) => void handleMove(r, d)}
          onDelete={setDeleteTarget}
        />
      )}

      <ConfirmDialog
        isOpen={deleteTarget !== null}
        title={msg.deleteTitle}
        description={deleteTarget ? msg.deleteDesc(deleteTarget.name) : ''}
        confirmLabel={deleting ? msg.deleting : msg.deleteConfirm}
        danger
        confirmDisabled={deleting}
        onConfirm={() => void handleDeleteConfirm()}
        onCancel={() => {
          if (!deleting) setDeleteTarget(null);
        }}
      />
    </div>
  );
}
