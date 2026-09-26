import { useEffect, useState } from 'react';
import type { ChatbotInboxSettingsResponse } from '@chat-bot/shared-types';
import { IDENTITY_SPACE_REF_PATTERN } from '@chat-bot/shared-types';
import { inboxApi } from '../../../api/inbox';
import { ApiError } from '../../../api/client';
import { useAuth } from '../../../context/AuthContext';
import { useToast } from '../../../components/Toast';
import { SkeletonRow } from '../../../components/Skeleton';
import { ErrorState } from '../../../components/ErrorState';
import { InlineFieldError } from '../../../components/InlineFieldError';
import { MESSAGES } from '../../../constants/messages';
import { IdentitySecretStatusBadge } from '../../../components/inbox/badges';
import { IdentityStatsTable } from './IdentityStatsTable';

/** OI-9 챗봇 설정 — 통합 인박스(`omnichannel-inbox-ui-spec.md` §3.9 `ChatbotInboxSettingsSection`). */
export function ChatbotInboxSettingsSection({ chatbotId, isArchived }: { chatbotId: string; isArchived: boolean }): JSX.Element {
  const msg = MESSAGES.inboxSettings;
  const { can } = useAuth();
  const { showToast } = useToast();
  const canWriteParticipation = can('chatbot:write');
  const canWriteIdentity = can('security:write');

  const [data, setData] = useState<ChatbotInboxSettingsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [openOnWarning, setOpenOnWarning] = useState(false);
  const [secretRef, setSecretRef] = useState('');
  const [secretRefError, setSecretRefError] = useState<string | undefined>();
  const [savingParticipation, setSavingParticipation] = useState(false);
  const [savingIdentity, setSavingIdentity] = useState(false);
  const [sharedChatbots, setSharedChatbots] = useState<string[]>([]);

  function applyData(res: ChatbotInboxSettingsResponse): void {
    setData(res);
    setEnabled(res.enabled);
    setOpenOnWarning(res.openOnWarning);
    setSecretRef(res.identity.secretRef ?? '');
  }

  function load(): void {
    setLoading(true);
    setError(false);
    inboxApi.settings
      .get(chatbotId)
      .then(applyData)
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatbotId]);

  // "같은 참조를 쓰는 다른 챗봇" 안내(§3.9.1) — 같은 식별 공간을 공유한다는 사실을 눈에 보이게 한다.
  const currentSecretRef = data?.identity.secretRef;
  useEffect(() => {
    if (!currentSecretRef) {
      setSharedChatbots([]);
      return;
    }
    inboxApi
      .identitySpaces()
      .then((res) => {
        const space = res.find((s) => s.ref === currentSecretRef);
        setSharedChatbots(space ? space.chatbots.filter((c) => c.id !== chatbotId).map((c) => c.name) : []);
      })
      .catch(() => setSharedChatbots([]));
  }, [currentSecretRef, chatbotId]);

  async function handleSaveParticipation(): Promise<void> {
    setSavingParticipation(true);
    try {
      const res = await inboxApi.settings.update(chatbotId, { enabled, openOnWarning });
      applyData(res);
      showToast(msg.saveParticipationSuccess);
    } catch (e) {
      showToast(e instanceof ApiError && e.code === 'CHATBOT_ARCHIVED' ? msg.archivedSaveError : e instanceof ApiError ? e.message : MESSAGES.errors.generic);
    } finally {
      setSavingParticipation(false);
    }
  }

  async function handleSaveIdentity(): Promise<void> {
    if (secretRef && !IDENTITY_SPACE_REF_PATTERN.test(secretRef)) {
      setSecretRefError(msg.identitySecretRefFormatError);
      return;
    }
    setSecretRefError(undefined);
    setSavingIdentity(true);
    try {
      const res = await inboxApi.settings.updateIdentity(chatbotId, { identitySecretRef: secretRef || null });
      applyData(res);
      showToast(msg.saveIdentitySuccess);
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : MESSAGES.errors.generic);
    } finally {
      setSavingIdentity(false);
    }
  }

  if (loading) {
    return (
      <>
        <SkeletonRow />
        <SkeletonRow />
        <SkeletonRow />
        <SkeletonRow />
      </>
    );
  }
  if (error || !data) return <ErrorState title={msg.loadFailed} onRetry={load} />;

  return (
    <div className="chatbot-inbox-settings-section">
      <p className="field-hint">{msg.outsideEnvironmentNotice}</p>

      <div className="form-field">
        <label htmlFor="inbox-settings-enabled">{msg.participationLabel}</label>
        <input
          id="inbox-settings-enabled"
          type="checkbox"
          role="switch"
          checked={enabled}
          disabled={!canWriteParticipation || isArchived}
          onChange={(e) => setEnabled(e.target.checked)}
        />{' '}
        {enabled ? msg.on : msg.off}
      </div>
      <div className="form-field">
        <label htmlFor="inbox-settings-open-on-warning">{msg.openOnWarningLabel}</label>
        <input
          id="inbox-settings-open-on-warning"
          type="checkbox"
          role="switch"
          checked={openOnWarning}
          disabled={!canWriteParticipation || isArchived}
          onChange={(e) => setOpenOnWarning(e.target.checked)}
        />{' '}
        {openOnWarning ? msg.on : msg.off}
      </div>
      {canWriteParticipation && (
        <div className="form-actions">
          <button type="button" className="btn btn-primary" onClick={() => void handleSaveParticipation()} disabled={savingParticipation || isArchived}>
            {savingParticipation ? MESSAGES.common.saving : msg.save}
          </button>
        </div>
      )}

      <h3>{msg.identitySectionTitle}</h3>
      <div className="form-field">
        <label htmlFor="inbox-settings-secret-ref">{msg.identitySecretRefLabel}</label>
        {canWriteIdentity ? (
          <input
            id="inbox-settings-secret-ref"
            type="text"
            maxLength={40}
            value={secretRef}
            disabled={isArchived}
            onChange={(e) => setSecretRef(e.target.value.toUpperCase())}
            aria-describedby="inbox-settings-secret-ref-error"
          />
        ) : (
          <span className="field-label-static">{data.identity.secretRef ?? '—'}</span>
        )}
        {!canWriteIdentity && <p className="field-hint">{msg.identitySecretRefAdminOnlyHint}</p>}
        <InlineFieldError id="inbox-settings-secret-ref-error" message={secretRefError} />
      </div>
      <p>
        <IdentitySecretStatusBadge status={data.identity.secretStatus} /> · {msg.customerKeyStatusLabel}:{' '}
        <IdentitySecretStatusBadge status={data.identity.customerKeyStatus} />
      </p>
      {data.identity.keyFingerprintChanged && <p className="field-hint field-hint--warning">{msg.fingerprintChangedWarning}</p>}
      {sharedChatbots.length > 0 && <p className="field-hint">{msg.sharedSpaceHint(sharedChatbots.join(', '))}</p>}
      {canWriteIdentity && (
        <div className="form-actions">
          <button type="button" className="btn btn-primary" onClick={() => void handleSaveIdentity()} disabled={savingIdentity || isArchived}>
            {savingIdentity ? MESSAGES.common.saving : msg.save}
          </button>
        </div>
      )}

      <IdentityStatsTable stats24h={data.identity.stats24h} />
    </div>
  );
}
