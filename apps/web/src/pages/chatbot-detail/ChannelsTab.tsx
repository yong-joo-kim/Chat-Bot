import { useEffect, useState } from 'react';
import type { ChannelListItem } from '@chat-bot/shared-types';
import { useChatbotDetailContext } from '../ChatbotDetailLayout';
import { channelsApi } from '../../api/channels';
import { ApiError } from '../../api/client';
import { useToast } from '../../components/Toast';
import { SeverityBadge } from '../../components/SeverityBadge';
import { SkeletonCard } from '../../components/Skeleton';
import { ErrorState } from '../../components/ErrorState';
import { MESSAGES } from '../../constants/messages';
import { ChannelCard } from './channels/ChannelCard';

/** CH1 — 채널 관리(`/chatbots/:chatbotId/channels`, FR-11-1~13). 항상 8종 카드를 렌더한다(AC-11-1). */
export function ChannelsTab(): JSX.Element {
  const { chatbot } = useChatbotDetailContext();
  const { showToast } = useToast();
  const [items, setItems] = useState<ChannelListItem[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const isArchived = chatbot.status === 'ARCHIVED';

  async function load(): Promise<void> {
    setLoadError(false);
    try {
      const res = await channelsApi.list(chatbot.id);
      setItems(res.items);
    } catch (e) {
      setLoadError(true);
      showToast(e instanceof ApiError ? e.message : MESSAGES.errors.generic);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatbot.id]);

  function handleChanged(updated: ChannelListItem): void {
    setItems((prev) => prev?.map((it) => (it.type === updated.type ? updated : it)) ?? null);
  }

  function handleRemoved(type: ChannelListItem['type']): void {
    setItems(
      (prev) =>
        prev?.map((it) =>
          it.type === type
            ? {
                ...it,
                configured: false,
                enabled: false,
                updatedAt: null,
                config:
                  it.type === 'WEB'
                    ? { allowedOrigins: [], quickReplies: [], launcherPosition: 'RIGHT', showLauncher: true }
                    : { note: undefined },
              }
            : it,
        ) ?? null,
    );
  }

  return (
    <div className="channels-tab">
      <h2>{MESSAGES.channels.title}</h2>
      {isArchived && <SeverityBadge severity="WARNING" label={MESSAGES.channels.archivedBanner} />}
      {loadError && !items && <ErrorState title={MESSAGES.channels.loadFailed} onRetry={() => void load()} />}
      <div className="channel-card-grid">
        {items === null && !loadError
          ? Array.from({ length: 8 }).map((_, i) => <SkeletonCard key={i} />)
          : items?.map((item) => (
              <ChannelCard
                key={item.type}
                chatbotId={chatbot.id}
                item={item}
                isArchived={isArchived}
                onChanged={handleChanged}
                onRemoved={handleRemoved}
              />
            ))}
      </div>
    </div>
  );
}
