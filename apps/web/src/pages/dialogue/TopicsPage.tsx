import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Topic, TopicAssetCounts, TopicListResponse } from '@chat-bot/shared-types';
import { useChatbotDetailContext } from '../ChatbotDetailLayout';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../components/Toast';
import { SkeletonRow } from '../../components/Skeleton';
import { ErrorState } from '../../components/ErrorState';
import { MESSAGES } from '../../constants/messages';
import { topicsApi } from '../../api/topics';
import { ApiError } from '../../api/client';
import { EnvironmentScopeNotice } from '../../components/EnvironmentScopeNotice';
import { TopicStatusBadge } from './components/topicBadges';
import { TopicForm } from './components/TopicForm';
import { DeleteTopicConfirmDialog } from './components/DeleteTopicConfirmDialog';
import { TopicImpactPreviewDialog } from './components/TopicImpactPreviewDialog';
import { TopicSplitWizard } from './components/TopicSplitWizard';

type Dialog =
  | { kind: 'form'; topic?: Topic }
  | { kind: 'delete'; topic: Topic; counts: TopicAssetCounts }
  | { kind: 'impact'; topic: Topic; action: 'ENABLE' | 'DISABLE' }
  | { kind: 'split' }
  | null;

/** TP0 — 토픽 관리(`topic-system-ui-spec.md` §3.1, `DialogueShell` 서브내비 8번째). */
export function TopicsPage(): JSX.Element {
  const { chatbot, environmentStatus } = useChatbotDetailContext();
  const { can } = useAuth();
  const { showToast } = useToast();
  const msg = MESSAGES.topics;
  const isArchived = chatbot.status === 'ARCHIVED';
  const canWrite = can('dialogue:write') && !isArchived;
  // FR-TP6-1/EX-TP-17 — 분리 미리보기(읽기)는 보관된 챗봇에서도 예외적으로 활성.
  const canSplit = can('dialogue:read') && can('chatbot:write');

  const [data, setData] = useState<TopicListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [movingId, setMovingId] = useState<string | null>(null);

  const load = useCallback(async (): Promise<TopicListResponse | null> => {
    setLoading(true);
    setError(false);
    try {
      const res = await topicsApi.list(chatbot.id);
      setData(res);
      return res;
    } catch {
      setError(true);
      return null;
    } finally {
      setLoading(false);
    }
  }, [chatbot.id]);

  // [코드 리뷰 1회차 M-5] 삭제 대화상자가 409 TOPIC_NOT_EMPTY를 다시 받으면 목록을 재조회해
  // 대화상자에 표시 중인 counts를 최신값으로 갱신한다(대화상자는 닫지 않는다, §3.1.2).
  async function refreshDeleteDialogCounts(): Promise<void> {
    const res = await load();
    if (!res) return;
    setDialog((prev) => {
      if (!prev || prev.kind !== 'delete') return prev;
      const updated = res.items.find((t) => t.id === prev.topic.id);
      return updated ? { kind: 'delete', topic: updated, counts: updated.counts } : prev;
    });
  }

  useEffect(() => {
    void load();
  }, [load]);

  async function handleMove(topic: Topic, direction: 'UP' | 'DOWN'): Promise<void> {
    if (movingId) return;
    setMovingId(topic.id);
    try {
      // 이동 응답(`{ items: Topic[] }`)에는 자산 수·교차 참조 수가 없다 — 전체 목록을 다시 불러
      // 정렬·수치를 함께 최신화한다(§3.1 컴포넌트 분해: "응답 전체 목록으로 즉시 재렌더").
      await topicsApi.move(chatbot.id, topic.id, { direction });
      await load();
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : MESSAGES.errors.generic);
    } finally {
      setMovingId(null);
    }
  }

  const atLimit = data ? data.items.length >= data.limit : false;

  return (
    <div className="topics-page">
      <EnvironmentScopeNotice visible={environmentStatus?.enabled === true} variant="topic" />
      <div className="dialogue-toolbar">
        <h2>
          {msg.pageTitle} {data && <span className="topics-limit-label">{msg.limitLabel(data.items.length, data.limit)}</span>}
        </h2>
        {canWrite && (
          <button
            type="button"
            className="btn btn-primary"
            disabled={atLimit}
            aria-disabled={atLimit}
            title={atLimit ? msg.addButtonLimitReached : undefined}
            onClick={() => setDialog({ kind: 'form' })}
          >
            {msg.addButton}
          </button>
        )}
      </div>

      {loading && (
        <>
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
        </>
      )}
      {!loading && error && <ErrorState title={msg.loadFailed} onRetry={load} />}

      {!loading && !error && data && (
        <div className="dialogue-table-wrap">
          <table className="dialogue-table topics-table">
            <thead>
              <tr>
                <th scope="col">{msg.columnName}</th>
                <th scope="col">{msg.columnStatus}</th>
                <th scope="col">{msg.columnIntents}</th>
                <th scope="col">{msg.columnKeywords}</th>
                <th scope="col">{msg.columnHomonyms}</th>
                <th scope="col">{msg.columnContexts}</th>
                <th scope="col">{msg.columnNodes}</th>
                <th scope="col">{msg.columnFaqs}</th>
                <th scope="col">{msg.columnCrossRefs}</th>
                <th scope="col">{MESSAGES.users.columnActions}</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>{msg.commonRowLabel}</td>
                <td>
                  <TopicStatusBadge status="COMMON" />
                </td>
                <td>{data.common.counts.intents}</td>
                <td>{data.common.counts.keywords}</td>
                <td>{data.common.counts.homonyms}</td>
                <td>{data.common.counts.contexts}</td>
                <td>{data.common.counts.dialogNodes}</td>
                <td>{data.common.counts.faqs}</td>
                <td>{data.common.outgoingCrossRefs} / —</td>
                <td />
              </tr>
              {data.items.map((topic, index) => (
                <tr key={topic.id}>
                  <td>{topic.name}</td>
                  <td>
                    <TopicStatusBadge status={topic.enabled ? 'ACTIVE' : 'INACTIVE'} />
                  </td>
                  <td>{topic.counts.intents}</td>
                  <td>{topic.counts.keywords}</td>
                  <td>{topic.counts.homonyms}</td>
                  <td>{topic.counts.contexts}</td>
                  <td>{topic.counts.dialogNodes}</td>
                  <td>{topic.counts.faqs}</td>
                  <td>
                    <Link to={`/chatbots/${chatbot.id}/dialogue/nodes`}>
                      {topic.outgoingCrossRefs} / {topic.incomingCrossRefs}
                    </Link>
                  </td>
                  <td className="topics-row-actions">
                    <button
                      type="button"
                      className="reorderable-btn"
                      aria-label={`${topic.name} ${msg.moveUpAction}`}
                      disabled={!canWrite || index === 0 || movingId !== null}
                      aria-disabled={!canWrite || index === 0 || movingId !== null}
                      onClick={() => void handleMove(topic, 'UP')}
                    >
                      ▲
                    </button>
                    <button
                      type="button"
                      className="reorderable-btn"
                      aria-label={`${topic.name} ${msg.moveDownAction}`}
                      disabled={!canWrite || index === data.items.length - 1 || movingId !== null}
                      aria-disabled={!canWrite || index === data.items.length - 1 || movingId !== null}
                      onClick={() => void handleMove(topic, 'DOWN')}
                    >
                      ▼
                    </button>
                    {canWrite && (
                      <>
                        <button type="button" className="btn btn-secondary" onClick={() => setDialog({ kind: 'form', topic })}>
                          {msg.editAction}
                        </button>
                        <button
                          type="button"
                          className="btn btn-secondary"
                          onClick={() => setDialog({ kind: 'impact', topic, action: topic.enabled ? 'DISABLE' : 'ENABLE' })}
                        >
                          {topic.enabled ? msg.disableAction : msg.enableAction}
                        </button>
                        <button type="button" className="btn btn-secondary" onClick={() => setDialog({ kind: 'delete', topic, counts: topic.counts })}>
                          {msg.deleteAction}
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.items.length === 0 && (
            <p className="field-hint" role="status">
              {msg.emptyTitle} {msg.emptyDesc}
            </p>
          )}
          {canSplit && (
            <div className="dialogue-toolbar-actions topics-split-entry">
              <button type="button" className="btn btn-secondary" onClick={() => setDialog({ kind: 'split' })}>
                {msg.splitAction}
              </button>
            </div>
          )}
        </div>
      )}

      <TopicForm
        isOpen={dialog?.kind === 'form'}
        chatbotId={chatbot.id}
        value={dialog?.kind === 'form' ? dialog.topic : undefined}
        atLimit={atLimit}
        onClose={() => setDialog(null)}
        onSaved={load}
      />
      <DeleteTopicConfirmDialog
        isOpen={dialog?.kind === 'delete'}
        chatbotId={chatbot.id}
        topic={dialog?.kind === 'delete' ? dialog.topic : null}
        counts={dialog?.kind === 'delete' ? dialog.counts : null}
        onClose={() => setDialog(null)}
        onDeleted={() => {
          setDialog(null);
          void load();
        }}
        onStaleCounts={refreshDeleteDialogCounts}
      />
      <TopicImpactPreviewDialog
        isOpen={dialog?.kind === 'impact'}
        chatbotId={chatbot.id}
        topic={dialog?.kind === 'impact' ? dialog.topic : null}
        action={dialog?.kind === 'impact' ? dialog.action : 'DISABLE'}
        onClose={() => setDialog(null)}
        onDone={() => {
          setDialog(null);
          void load();
        }}
      />
      {dialog?.kind === 'split' && (
        <TopicSplitWizard
          isOpen
          chatbotId={chatbot.id}
          topics={data?.items ?? []}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}
