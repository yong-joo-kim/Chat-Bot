import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';

const PARAM = 'topicIds';

/**
 * 목록 6화면 공용 — 토픽 필터를 URL 쿼리 `topicIds=common,<uuid>,…`로 유지한다
 * (`topic-system-ui-spec.md` §5.3 "URL 쿼리 `topicIds=`로 유지"). 새로고침·뒤로가기에도
 * 필터가 보존된다. 같은 화면이 이미 쓰는 다른 쿼리(`?resource=`·`?edit=` 등)와 공존한다 —
 * `setSearchParams`에 함수형 업데이터를 넘겨 기존 파라미터를 보존한 채 `topicIds`만 갱신한다.
 * [코드 리뷰 1회차 M-1]
 */
export function useTopicFilterParam(): [string[], (next: string[]) => void] {
  const [searchParams, setSearchParams] = useSearchParams();

  const value = useMemo(() => {
    const raw = searchParams.get(PARAM);
    if (!raw) return [];
    return raw
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }, [searchParams]);

  const setValue = useCallback(
    (next: string[]) => {
      setSearchParams((prev) => {
        const params = new URLSearchParams(prev);
        if (next.length > 0) params.set(PARAM, next.join(','));
        else params.delete(PARAM);
        return params;
      });
    },
    [setSearchParams],
  );

  return [value, setValue];
}
