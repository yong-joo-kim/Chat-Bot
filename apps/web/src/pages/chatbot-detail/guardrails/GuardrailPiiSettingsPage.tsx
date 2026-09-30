import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { GuardrailPiiKind, GuardrailSettingsResponse } from '@chat-bot/shared-types';
import { GUARDRAIL_PII_DEFAULT_KINDS, GUARDRAIL_PII_KIND_LABELS } from '@chat-bot/shared-types';
import { ApiError } from '../../../api/client';
import { guardrailsApi } from '../../../api/guardrails';
import { ConfirmDialog } from '../../../components/Modal';
import { ErrorState } from '../../../components/ErrorState';
import { SkeletonCard } from '../../../components/Skeleton';
import { useToast } from '../../../components/Toast';
import { useAuth } from '../../../context/AuthContext';
import { MESSAGES } from '../../../constants/messages';
import { useGuardrailContext } from './guardrailContext';
import { GuardrailTestPanel } from './GuardrailTestPanel';
import { PiiKindCheckboxGroup } from './PiiKindCheckboxGroup';

const SENSITIVE_KINDS: GuardrailPiiKind[] = ['RRN', 'CARD'];

function sameKinds(a: GuardrailPiiKind[], b: GuardrailPiiKind[]): boolean {
  return a.length === b.length && a.every((k) => b.includes(k));
}

/** GR-3 AI 답변 개인정보 가림 설정(+ 시험하기) — `ai-guardrails-ui-spec.md` §6. */
export function GuardrailPiiSettingsPage(): JSX.Element {
  const { chatbot, guardrail } = useGuardrailContext();
  const { meta, canWrite } = guardrail;
  const { can } = useAuth();
  const { showToast } = useToast();
  const msg = MESSAGES.guardrails.pii;
  const shellMsg = MESSAGES.guardrails.shell;

  const [settings, setSettings] = useState<GuardrailSettingsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [kinds, setKinds] = useState<GuardrailPiiKind[]>([]);
  const [preserveDates, setPreserveDates] = useState(true);
  const [saving, setSaving] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);

  const applySettings = useCallback((s: GuardrailSettingsResponse) => {
    setSettings(s);
    setKinds(s.piiExit.kinds);
    setPreserveDates(s.piiExit.preserveDates);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      applySettings(await guardrailsApi.getSettings(chatbot.id));
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [chatbot.id, applySettings]);

  useEffect(() => {
    void load();
  }, [load]);

  const dirty = useMemo(
    () => settings !== null && (!sameKinds(kinds, settings.piiExit.kinds) || preserveDates !== settings.piiExit.preserveDates),
    [settings, kinds, preserveDates],
  );

  function handleKindToggle(kind: GuardrailPiiKind, checked: boolean): void {
    setKinds((prev) => (checked ? [...prev.filter((k) => k !== kind), kind] : prev.filter((k) => k !== kind)));
    if (kind === 'ACCOUNT' && checked) setStatus(msg.accountTurnedOn);
  }

  function handleReset(): void {
    setKinds([...GUARDRAIL_PII_DEFAULT_KINDS]);
    setPreserveDates(true);
    setStatus(msg.resetNotice);
  }

  /** 약화 저장 = 주민등록번호·카드번호 중 지금 가리는 것을 빼는 저장(종류만 늘리는 저장은 확인 없이). */
  const removedSensitive = useMemo(() => {
    const current = settings?.piiExit.kinds ?? [];
    return SENSITIVE_KINDS.filter((k) => current.includes(k) && !kinds.includes(k));
  }, [settings, kinds]);

  function handleSaveClick(): void {
    if (!dirty || saving) return;
    if (removedSensitive.length > 0) {
      setConfirmOpen(true);
      return;
    }
    void doSave();
  }

  async function doSave(): Promise<void> {
    setConfirmOpen(false);
    setSaving(true);
    setBanner(null);
    try {
      const res = await guardrailsApi.updateSettings(chatbot.id, { piiExit: { kinds, preserveDates } });
      applySettings(res);
      showToast(msg.savedToast);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'VALIDATION_FAILED' && e.details?.some((d) => d.message.includes('GOVERNANCE_FLOOR'))) {
        setBanner(msg.floorError);
        // 하한 잠금을 반영하려고 설정을 다시 불러온다.
        await load();
      } else if (e instanceof ApiError && e.code === 'CHATBOT_ARCHIVED') {
        setBanner(msg.archived);
      } else {
        setBanner(msg.saveFailed);
      }
    } finally {
      setSaving(false);
    }
  }

  const ragActive = meta?.ragActive ?? true;
  const serverOffHere = !meta && settings?.serverEnabled === false;
  const draftPiiExit = useMemo(() => ({ kinds, preserveDates }), [kinds, preserveDates]);
  const weakenLabels = removedSensitive.map((k) => GUARDRAIL_PII_KIND_LABELS[k]).join('·');
  const allOff = kinds.length === 0;

  return (
    <div className="guardrail-pii-page">
      <h2 tabIndex={-1}>{msg.title}</h2>
      <p>{msg.intro}</p>
      <p className="field-hint">{msg.introExample}</p>

      {serverOffHere && (
        <p className="form-banner form-banner--warning">
          <span aria-hidden="true">⚠</span> {shellMsg.serverOffBanner}
        </p>
      )}
      {meta && !ragActive && (
        <p className="form-banner form-banner--info">
          <span aria-hidden="true">ⓘ</span> {shellMsg.ragInactiveBanner}{' '}
          {can('dialogue:read') && <Link to={`/chatbots/${chatbot.id}/answer-settings`}>{shellMsg.ragInactiveLink}</Link>}
        </p>
      )}

      <p role="status" className="sr-only">
        {status}
      </p>

      {loading ? (
        <div aria-busy="true">
          <SkeletonCard />
        </div>
      ) : loadError || !settings ? (
        <ErrorState title={msg.loadFailed} onRetry={() => void load()} />
      ) : (
        <>
          <p className="form-banner form-banner--info">
            <span aria-hidden="true">ⓘ</span> {settings.isDefault ? msg.statusDefault : msg.statusCustom}
          </p>
          {banner && (
            <p className="form-banner form-banner--error" role="alert">
              <span aria-hidden="true">⚠</span> {banner}
            </p>
          )}

          <PiiKindCheckboxGroup
            kinds={kinds}
            preserveDates={preserveDates}
            governanceFloor={settings.governanceFloor}
            readOnly={!canWrite}
            onKindToggle={handleKindToggle}
            onPreserveDatesChange={setPreserveDates}
          />

          <p className="field-hint">
            <span aria-hidden="true">ⓘ</span> {msg.strengthNotice}
          </p>
          <p className="field-hint">
            <span aria-hidden="true">ⓘ</span> {msg.limitsNotice}
          </p>

          {canWrite && (
            <div className="form-actions">
              <button type="button" className="btn btn-secondary" onClick={handleReset}>
                {msg.reset}
              </button>
              <button
                type="button"
                className="btn btn-primary"
                aria-disabled={!dirty || undefined}
                disabled={saving}
                onClick={handleSaveClick}
              >
                {saving ? msg.saving : msg.save}
              </button>
            </div>
          )}

          <GuardrailTestPanel
            chatbotId={chatbot.id}
            mode="pii"
            draftPiiExit={draftPiiExit}
            exampleText={MESSAGES.guardrails.test.exampleText}
            defaultOpen
          />
        </>
      )}

      <ConfirmDialog
        isOpen={confirmOpen}
        title={msg.weakenTitle}
        description={allOff ? msg.weakenDescAll : msg.weakenDescSome(weakenLabels)}
        confirmLabel={msg.weakenConfirm}
        cancelLabel={msg.cancel}
        danger
        onConfirm={() => void doSave()}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}
