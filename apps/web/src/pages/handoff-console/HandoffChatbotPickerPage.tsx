import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { HandoffConsoleChatbotItem } from '@chat-bot/shared-types';
import { handoffApi } from '../../api/handoff';
import { ApiError } from '../../api/client';
import { SkeletonCard } from '../../components/Skeleton';
import { ErrorState } from '../../components/ErrorState';
import { EmptyState } from '../../components/EmptyState';
import { MESSAGES } from '../../constants/messages';

/** HC0 — 상담 콘솔 진입 · 챗봇 선택기(hybrid-cs-ui-spec.md §3.1, `/handoff-console`). */
export function HandoffChatbotPickerPage(): JSX.Element {
  const msg = MESSAGES.handoffConsole;
  const [items, setItems] = useState<HandoffConsoleChatbotItem[]>([]);
  const [myActiveCount, setMyActiveCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const res = await handoffApi.consoleChatbots();
      // FR-CS2-8: 상담 연계가 켜진 챗봇을 앞쪽에 배치.
      const sorted = [...res.items].sort((a, b) => Number(b.handoffEnabled) - Number(a.handoffEnabled));
      setItems(sorted);
      setMyActiveCount(res.myActiveCount);
    } catch (e) {
      setError(!(e instanceof ApiError) || e.status >= 500);
      if (e instanceof ApiError && e.status < 500) setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="handoff-chatbot-picker-page">
      <div className="dialogue-toolbar">
        <h1>{msg.pickerTitle}</h1>
        <span>{msg.myActiveCount(myActiveCount)}</span>
      </div>

      {loading ? (
        <div className="handoff-chatbot-card-grid">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      ) : error ? (
        <ErrorState title={MESSAGES.errors.generic} onRetry={load} />
      ) : items.length === 0 ? (
        <EmptyState title={msg.pickerEmptyTitle} />
      ) : (
        <div className="handoff-chatbot-card-grid">
          {items.map((item) => (
            <div key={item.chatbotId} className={`handoff-chatbot-card${item.handoffEnabled ? '' : ' handoff-chatbot-card--disabled'}`}>
              <h2>{item.name}</h2>
              {item.handoffEnabled ? (
                <>
                  <p>{item.activeHandoffCount}건 상담 중</p>
                  <Link className="btn btn-primary" to={`/handoff-console/${item.chatbotId}/live`}>
                    열기 →
                  </Link>
                </>
              ) : (
                <p className="field-hint">{msg.pickerDisabledCardHint}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
