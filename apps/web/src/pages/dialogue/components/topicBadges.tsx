import type { Topic } from '@chat-bot/shared-types';
import { MESSAGES } from '../../../constants/messages';

export type TopicDisplayStatus = 'ACTIVE' | 'INACTIVE' | 'COMMON';

/**
 * `TopicStatusBadge` — 색상 + 텍스트 병행(UIUX §1). 활성은 배경 없는 회색 텍스트(기본값이라
 * 강조하지 않는다), 비활성은 주황 배경 + 텍스트(색 점이 아니라 텍스트 배지), 공통은 파랑 텍스트
 * + 자물쇠 아이콘(삭제·비활성 불가라는 고정성, `topic-system-ui-spec.md` §2.1).
 */
export function TopicStatusBadge({ status }: { status: TopicDisplayStatus }): JSX.Element {
  const msg = MESSAGES.topics;
  if (status === 'COMMON') {
    return (
      <span className="topic-status-badge topic-status-badge--common">
        <span aria-hidden="true">🔒</span> {msg.statusCommon}
      </span>
    );
  }
  if (status === 'INACTIVE') {
    return (
      <span className="topic-status-badge topic-status-badge--inactive">
        <span aria-hidden="true">○</span> {msg.statusInactive}
      </span>
    );
  }
  return (
    <span className="topic-status-badge topic-status-badge--active">
      <span aria-hidden="true">●</span> {msg.statusActive}
    </span>
  );
}

export function topicStatusLabel(status: TopicDisplayStatus): string {
  const msg = MESSAGES.topics;
  return status === 'COMMON' ? msg.statusCommon : status === 'INACTIVE' ? msg.statusInactive : msg.statusActive;
}

/**
 * `TopicNameChip` — 목록 6화면의 "토픽" 열 등에서 쓰는 순수 텍스트 칩. 비활성이면 "(비활성)"
 * 접미사, 토픽 id가 필터에는 남아 있지만 목록에서 찾을 수 없으면(삭제됨) "(삭제된 토픽)"(EX-TP-24).
 */
export function TopicNameChip({ topicId, topicsById }: { topicId: string | null | undefined; topicsById: Map<string, Topic> }): JSX.Element {
  const msg = MESSAGES.topics;
  if (!topicId) return <span className="topic-name-chip">{msg.commonRowLabel}</span>;
  const topic = topicsById.get(topicId);
  if (!topic) return <span className="topic-name-chip">{msg.filterDeletedTopicChip}</span>;
  return <span className="topic-name-chip">{topic.enabled ? topic.name : `${topic.name}(${msg.statusInactive})`}</span>;
}

/** `CrossTopicRefBadge` — 서버가 내려준 `crossTopicRefCount`를 그대로 렌더한다(프론트 그래프 계산 0). */
export function CrossTopicRefBadge({ count }: { count: number }): JSX.Element | null {
  if (!count) return null;
  return <span className="dialogue-badge dialogue-badge--neutral cross-topic-ref-badge">{MESSAGES.topics.crossTopicRefBadge(count)}</span>;
}

/**
 * [코드 리뷰 1회차 L-4] `useTopics()`가 실패했을 때 목록 화면이 공통으로 보여주는 안내+재시도.
 * 토픽 필터/열/일괄 지정이 전부 빈 상태로 조용히 동작하는 대신, 실패했다는 사실을 알린다.
 */
export function TopicLoadErrorNotice({ onRetry }: { onRetry: () => void }): JSX.Element {
  return (
    <p className="form-banner form-banner--error" role="alert">
      {MESSAGES.topics.loadFailed}{' '}
      <button type="button" className="link-button" onClick={onRetry}>
        {MESSAGES.common.retry}
      </button>
    </p>
  );
}

/** START/FALLBACK 노드 폼에서 `TopicSelectField` 대신 렌더하는 고정 텍스트. */
export function SystemNodeTopicLockedHint(): JSX.Element {
  return (
    <div className="form-field">
      <span className="field-label-static">{MESSAGES.topics.topicFieldLabel}</span>
      <p className="field-hint">{MESSAGES.topics.topicFieldSystemLockedHint}</p>
    </div>
  );
}
