import { useState } from 'react';
import type { ChannelListItem, PlaceholderChannelConfig, WebChannelConfig } from '@chat-bot/shared-types';
import { channelsApi } from '../../../api/channels';
import { ApiError } from '../../../api/client';
import { useToast } from '../../../components/Toast';
import { MESSAGES } from '../../../constants/messages';
import { ChannelToggle } from './ChannelToggle';
import { WebChannelForm } from './WebChannelForm';
import { PlaceholderChannelForm } from './PlaceholderChannelForm';
import { ChannelDeleteConfirmDialog } from './ChannelDeleteConfirmDialog';

/** 8종 카드 중 1개(FR-11-2~13). `implementation`/`enabled`/`configured`는 항상 응답값을 렌더한다(DD-29). */
export function ChannelCard({
  chatbotId,
  item,
  isArchived,
  onChanged,
  onRemoved,
}: {
  chatbotId: string;
  item: ChannelListItem;
  isArchived: boolean;
  onChanged: (updated: ChannelListItem) => void;
  onRemoved: (type: ChannelListItem['type']) => void;
}): JSX.Element {
  const msg = MESSAGES.channels;
  const { showToast } = useToast();
  const [expanded, setExpanded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const locked = isArchived || item.implementation !== 'IMPLEMENTED';
  const reason = isArchived ? msg.toggleReasonArchived : item.implementation !== 'IMPLEMENTED' ? msg.toggleReasonConfigOnly : undefined;

  async function handleToggle(): Promise<void> {
    setToggling(true);
    try {
      const updated = await channelsApi.upsert(chatbotId, item.type, { enabled: !item.enabled });
      onChanged(updated);
      showToast(msg.saveSuccess);
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : MESSAGES.errors.generic);
    } finally {
      setToggling(false);
    }
  }

  async function handleSaveConfig(config: WebChannelConfig | PlaceholderChannelConfig): Promise<void> {
    setSaving(true);
    try {
      const updated = await channelsApi.upsert(chatbotId, item.type, { config });
      onChanged(updated);
      setExpanded(false);
      showToast(msg.saveSuccess);
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : MESSAGES.errors.generic);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(): Promise<void> {
    try {
      await channelsApi.remove(chatbotId, item.type);
      setDeleteOpen(false);
      setExpanded(false);
      onRemoved(item.type);
      showToast(msg.deleteSuccess);
    } catch (e) {
      setDeleteOpen(false);
      showToast(e instanceof ApiError ? e.message : MESSAGES.errors.generic);
    }
  }

  const summary =
    item.type === 'WEB'
      ? (item.config as WebChannelConfig).allowedOrigins.length === 0
        ? msg.summaryWebAllOrigins
        : msg.summaryWeb((item.config as WebChannelConfig).allowedOrigins.length)
      : (item.config as PlaceholderChannelConfig).note
        ? msg.summaryNote(((item.config as PlaceholderChannelConfig).note as string).slice(0, 40))
        : msg.summaryNoteEmpty;

  return (
    <div className="channel-card">
      <div className="channel-card-header">
        <h3>{item.label}</h3>
        <div className="channel-card-badges">
          {item.implementation !== 'IMPLEMENTED' && (
            <span className="channel-status-badge channel-status-badge--neutral">
              <span aria-hidden="true">🔒</span> {msg.implementationBadge}
            </span>
          )}
          {item.enabled && (
            <span className="channel-status-badge channel-status-badge--success">
              <span aria-hidden="true">●</span> {msg.enabledBadge}
            </span>
          )}
          {!item.enabled && item.configured && (
            <span className="channel-status-badge channel-status-badge--neutral">{msg.configuredOnlyBadge}</span>
          )}
        </div>
      </div>
      <p className="channel-card-summary">{summary}</p>
      <ChannelToggle
        id={`channel-toggle-${item.type}`}
        enabled={item.enabled}
        locked={locked || toggling}
        reason={reason}
        onToggle={() => void handleToggle()}
      />
      <div className="channel-card-actions">
        <button type="button" className="btn btn-secondary" aria-expanded={expanded} onClick={() => setExpanded((v) => !v)}>
          {expanded ? msg.closeSettings : msg.openSettings}
        </button>
        {item.type === 'WEB' && (
          <a className="btn btn-secondary" href={`/chatbots/${chatbotId}/skin?section=embed`}>
            {msg.embedCodeLink}
          </a>
        )}
        {item.configured && (
          <button type="button" className="btn btn-secondary" aria-disabled={isArchived} onClick={() => !isArchived && setDeleteOpen(true)}>
            {msg.deleteAction}
          </button>
        )}
      </div>
      {expanded &&
        (item.type === 'WEB' ? (
          <WebChannelForm
            initial={item.config as WebChannelConfig}
            saving={saving}
            onSave={(config) => void handleSaveConfig(config)}
            onCancel={() => setExpanded(false)}
          />
        ) : (
          <PlaceholderChannelForm
            initial={item.config as PlaceholderChannelConfig}
            saving={saving}
            onSave={(config) => void handleSaveConfig(config)}
            onCancel={() => setExpanded(false)}
          />
        ))}
      <ChannelDeleteConfirmDialog isOpen={deleteOpen} onConfirm={() => void handleDelete()} onCancel={() => setDeleteOpen(false)} />
    </div>
  );
}
