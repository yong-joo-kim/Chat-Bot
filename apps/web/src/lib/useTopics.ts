import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Topic } from '@chat-bot/shared-types';
import { topicsApi } from '../api/topics';

/**
 * 챗봇의 토픽 전량을 1회 로드해 공유하는 훅(`topic-system-ui-spec.md` §9-3 "토픽당 요청 1회 원칙").
 * `TopicSelectField`·필터 드롭다운·일괄 지정 모달이 이 훅이 반환한 배열/맵을 그대로 재사용한다.
 */
export function useTopics(chatbotId: string): {
  topics: Topic[];
  topicsById: Map<string, Topic>;
  loading: boolean;
  /** [코드 리뷰 1회차 L-4] 실패를 삼키지 않고 노출한다 — 호출부(주로 목록 화면)가 안내+재시도를 보여준다. */
  error: boolean;
  reload: () => Promise<void>;
} {
  const [topics, setTopics] = useState<Topic[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const res = await topicsApi.list(chatbotId);
      setTopics(res.items);
    } catch {
      setTopics([]);
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [chatbotId]);

  useEffect(() => {
    void load();
  }, [load]);

  const topicsById = useMemo(() => new Map(topics.map((t) => [t.id, t])), [topics]);

  return { topics, topicsById, loading, error, reload: load };
}
