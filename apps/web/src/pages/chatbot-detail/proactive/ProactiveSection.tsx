import { useEffect, useState } from 'react';
import type { ProactiveOverviewResponse, ProactiveRuleView } from '@chat-bot/shared-types';
import { PROACTIVE_LIMITS } from '@chat-bot/shared-types';
import { proactiveApi } from '../../../api/proactive';
import { chatbotsApi } from '../../../api/chatbots';
import { ApiError } from '../../../api/client';
import { useAuth } from '../../../context/AuthContext';
import { useToast } from '../../../components/Toast';
import { SkeletonCard, SkeletonRow } from '../../../components/Skeleton';
import { ErrorState } from '../../../components/ErrorState';
import { EmptyState } from '../../../components/EmptyState';
import { InlineFieldError } from '../../../components/InlineFieldError';
import { ConfirmDialog } from '../../../components/Modal';
import { MESSAGES } from '../../../constants/messages';
import { ProactiveRuleTable } from './ProactiveRuleTable';
import { ProactiveRuleEditModal } from './ProactiveRuleEditModal';
import { ProactiveStatsPanel } from './ProactiveStatsPanel';

/** 기존 삽입 코드 문자열에 `data-proactive="on"`을 끼워 예시로만 보여준다(서버 변경 0, §3.7). */
function withProactiveAttr(snippet: string): string {
  if (snippet.includes('data-proactive=')) return snippet;
  return snippet.replace('></script>', ' data-proactive="on"></script>');
}

export interface ProactiveSectionProps {
  chatbotId: string;
  isArchived: boolean;
  primaryColor: string;
}

/**
 * [신규 No.35] PA-C1~PA-C3·PA-C7 — WEB `ChannelCard` 안 "선제 안내" 펼침 섹션(화면 설계서 §3.1~§3.3,
 * §3.7). `ChannelCard`의 기존 "설정 열기/닫기"와 독립적으로 펼칠 수 있다(§0).
 */
export function ProactiveSection({ chatbotId, isArchived, primaryColor }: ProactiveSectionProps): JSX.Element {
  const msg = MESSAGES.proactive;
  const { can } = useAuth();
  const { showToast } = useToast();
  const canWrite = can('channel:write') && !isArchived;

  const [overview, setOverview] = useState<ProactiveOverviewResponse | null>(null);
  const [loadError, setLoadError] = useState(false);

  const [enabled, setEnabled] = useState(false);
  const [maxPerSession, setMaxPerSession] = useState<number>(PROACTIVE_LIMITS.maxPerSessionDefault);
  const [minIntervalSec, setMinIntervalSec] = useState<number>(PROACTIVE_LIMITS.minIntervalSecDefault);
  const [quietAfterUserMessageSec, setQuietAfterUserMessageSec] = useState<number>(PROACTIVE_LIMITS.quietAfterUserMessageSecDefault);
  const [settingsErrors, setSettingsErrors] = useState<Record<string, string>>({});
  const [savingSettings, setSavingSettings] = useState(false);

  const [modalState, setModalState] = useState<{ rule: ProactiveRuleView | null } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ProactiveRuleView | null>(null);
  const [statsOpen, setStatsOpen] = useState(false);
  const [embedSnippet, setEmbedSnippet] = useState<string | null>(null);

  async function load(): Promise<void> {
    setLoadError(false);
    try {
      const res = await proactiveApi.getOverview(chatbotId);
      setOverview(res);
      setEnabled(res.settings.enabled);
      setMaxPerSession(res.settings.maxPerSession);
      setMinIntervalSec(res.settings.minIntervalSec);
      setQuietAfterUserMessageSec(res.settings.quietAfterUserMessageSec);
    } catch {
      setLoadError(true);
    }
  }

  useEffect(() => {
    void load();
    chatbotsApi
      .embedCode(chatbotId)
      .then((res) => setEmbedSnippet(withProactiveAttr(res.pc)))
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatbotId]);

  async function handleSaveSettings(): Promise<void> {
    const errors: Record<string, string> = {};
    if (maxPerSession < PROACTIVE_LIMITS.maxPerSessionMin || maxPerSession > PROACTIVE_LIMITS.maxPerSessionMax) errors.maxPerSession = msg.settings.errorMaxPerSession;
    if (minIntervalSec < PROACTIVE_LIMITS.minIntervalSecMin || minIntervalSec > PROACTIVE_LIMITS.minIntervalSecMax) errors.minIntervalSec = msg.settings.errorMinInterval;
    if (quietAfterUserMessageSec < PROACTIVE_LIMITS.quietAfterUserMessageSecMin || quietAfterUserMessageSec > PROACTIVE_LIMITS.quietAfterUserMessageSecMax) {
      errors.quietAfterUserMessageSec = msg.settings.errorQuietAfterSend;
    }
    if (Object.keys(errors).length > 0) {
      setSettingsErrors(errors);
      return;
    }
    setSettingsErrors({});
    setSavingSettings(true);
    try {
      await proactiveApi.saveSettings(chatbotId, { enabled, maxPerSession, minIntervalSec, quietAfterUserMessageSec });
      showToast(msg.settings.saveSuccess);
      await load();
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : msg.settings.saveFailed);
    } finally {
      setSavingSettings(false);
    }
  }

  async function handleToggleRule(rule: ProactiveRuleView): Promise<void> {
    try {
      if (rule.enabled) await proactiveApi.disableRule(chatbotId, rule.id);
      else await proactiveApi.enableRule(chatbotId, rule.id);
      await load();
    } catch (e) {
      showToast(e instanceof ApiError && e.code === 'LIMIT_EXCEEDED' ? msg.rule.enableLimitToast : e instanceof ApiError ? e.message : MESSAGES.errors.generic);
    }
  }

  async function handleMoveRule(rule: ProactiveRuleView, direction: 'UP' | 'DOWN'): Promise<void> {
    try {
      await proactiveApi.moveRule(chatbotId, rule.id, { direction });
      await load();
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : MESSAGES.errors.generic);
    }
  }

  async function handleDeleteRule(): Promise<void> {
    if (!deleteTarget) return;
    try {
      await proactiveApi.deleteRule(chatbotId, deleteTarget.id);
      setDeleteTarget(null);
      showToast(MESSAGES.common.confirm);
      await load();
    } catch (e) {
      setDeleteTarget(null);
      showToast(e instanceof ApiError ? e.message : MESSAGES.errors.generic);
    }
  }

  function handleDuplicateRule(rule: ProactiveRuleView): void {
    // U-5 — 복제 접미사는 NodesListPage.handleCopy와 같은 "(사본)"으로 통일한다.
    setModalState({ rule: { ...rule, id: '', name: `${rule.name} (사본)` } });
  }

  if (loadError && !overview) {
    return <ErrorState title={msg.loadFailed} onRetry={() => void load()} />;
  }

  if (!overview) {
    return (
      <div>
        <SkeletonCard />
        <SkeletonRow />
        <SkeletonRow />
        <SkeletonRow />
      </div>
    );
  }

  return (
    <div className="proactive-section">
      {!overview.serverEnabled && <p className="form-banner form-banner--info">{msg.serverDisabledBanner}</p>}
      {overview.context.launcherHidden && <p className="form-banner form-banner--info">{msg.launcherHiddenBanner}</p>}
      {overview.context.chatbotStatus !== 'ACTIVE' || !overview.context.webChannelEnabled ? (
        <p className="form-banner form-banner--info">{msg.notPublicBanner}</p>
      ) : null}

      <div className="form-field">
        <div className="form-field--inline">
          <input id="pa-settings-enabled" type="checkbox" checked={enabled} disabled={!canWrite} onChange={(e) => setEnabled(e.target.checked)} />
          <label htmlFor="pa-settings-enabled">{msg.settings.switchLabel}</label>
        </div>
      </div>
      <div className="form-field">
        <label htmlFor="pa-settings-max-per-session">{msg.settings.maxPerSessionLabel}</label>
        <input
          id="pa-settings-max-per-session"
          type="number"
          min={PROACTIVE_LIMITS.maxPerSessionMin}
          max={PROACTIVE_LIMITS.maxPerSessionMax}
          value={maxPerSession}
          disabled={!canWrite}
          onChange={(e) => setMaxPerSession(Number(e.target.value))}
          aria-invalid={Boolean(settingsErrors.maxPerSession)}
        />
        <InlineFieldError id="pa-settings-max-per-session-error" message={settingsErrors.maxPerSession} />
      </div>
      <div className="form-field">
        <label htmlFor="pa-settings-min-interval">{msg.settings.minIntervalLabel}</label>
        <input
          id="pa-settings-min-interval"
          type="number"
          min={PROACTIVE_LIMITS.minIntervalSecMin}
          max={PROACTIVE_LIMITS.minIntervalSecMax}
          value={minIntervalSec}
          disabled={!canWrite}
          onChange={(e) => setMinIntervalSec(Number(e.target.value))}
          aria-invalid={Boolean(settingsErrors.minIntervalSec)}
        />
        <InlineFieldError id="pa-settings-min-interval-error" message={settingsErrors.minIntervalSec} />
      </div>
      <div className="form-field">
        <label htmlFor="pa-settings-quiet">{msg.settings.quietAfterSendLabel}</label>
        <input
          id="pa-settings-quiet"
          type="number"
          min={PROACTIVE_LIMITS.quietAfterUserMessageSecMin}
          max={PROACTIVE_LIMITS.quietAfterUserMessageSecMax}
          value={quietAfterUserMessageSec}
          disabled={!canWrite}
          onChange={(e) => setQuietAfterUserMessageSec(Number(e.target.value))}
          aria-invalid={Boolean(settingsErrors.quietAfterUserMessageSec)}
        />
        <InlineFieldError id="pa-settings-quiet-error" message={settingsErrors.quietAfterUserMessageSec} />
      </div>
      <p className="field-hint">{msg.settings.saveNotice}</p>
      <div className="form-actions">
        <button type="button" className="btn btn-primary" disabled={!canWrite || savingSettings} onClick={() => void handleSaveSettings()}>
          {savingSettings ? MESSAGES.common.saving : msg.settings.saveButton}
        </button>
      </div>

      {embedSnippet && (
        <div className="form-banner form-banner--info">
          <p>{msg.embed.banner}</p>
          <pre className="embed-code-pre">
            <code>{embedSnippet}</code>
          </pre>
          <a className="btn btn-secondary" href={`/chatbots/${chatbotId}/skin?section=embed`}>
            {msg.embed.viewFullCodeLink}
          </a>
        </div>
      )}

      {overview.rules.length === 0 ? (
        <EmptyState
          title={msg.emptyTitle}
          action={
            canWrite && (
              <button type="button" className="btn btn-primary" onClick={() => setModalState({ rule: null })}>
                {msg.addRuleButton}
              </button>
            )
          }
        />
      ) : (
        <>
          {canWrite && overview.rules.length < overview.limits.rulesMax && (
            <button type="button" className="btn btn-primary" onClick={() => setModalState({ rule: null })}>
              {msg.addRuleButton}
            </button>
          )}
          <ProactiveRuleTable
            rules={overview.rules}
            limits={overview.limits}
            canWrite={canWrite}
            onEdit={(rule) => setModalState({ rule })}
            onDelete={(rule) => setDeleteTarget(rule)}
            onToggle={(rule) => void handleToggleRule(rule)}
            onMove={(rule, dir) => void handleMoveRule(rule, dir)}
            onDuplicate={handleDuplicateRule}
            onStats={() => setStatsOpen(true)}
          />
        </>
      )}

      {statsOpen && <ProactiveStatsPanel chatbotId={chatbotId} onClose={() => setStatsOpen(false)} />}

      {modalState && (
        <ProactiveRuleEditModal
          isOpen
          chatbotId={chatbotId}
          rule={modalState.rule}
          primaryColor={primaryColor}
          onClose={() => setModalState(null)}
          onSaved={() => {
            setModalState(null);
            void load();
          }}
        />
      )}

      <ConfirmDialog
        isOpen={Boolean(deleteTarget)}
        title={msg.rule.deleteConfirmTitle}
        description={deleteTarget ? msg.rule.deleteConfirmDesc(deleteTarget.name) : ''}
        confirmLabel={MESSAGES.common.delete}
        danger
        onConfirm={() => void handleDeleteRule()}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
