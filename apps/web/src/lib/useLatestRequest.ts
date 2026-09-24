import { useRef } from 'react';

export interface LatestRequestGuard {
  /** 요청을 시작할 때 호출해 이번 요청의 순번을 발급받는다. */
  next: () => number;
  /** 응답/오류 처리 직전에 호출한다. true면 그 사이 더 새 요청이 시작된 것이므로 상태 반영을 건너뛴다. */
  isStale: (reqId: number) => boolean;
}

/**
 * 같은 슬라이스에 대해 여러 비동기 요청이 겹칠 때(예: 스코프/기간을 빠르게 전환), 늦게 도착한 이전 요청의
 * 응답·오류가 최신 상태를 덮어쓰지 않도록 막는 요청 순번 가드.
 *
 * 반환 객체(`next`/`isStale`)는 리렌더와 무관하게 항상 같은 참조를 유지하므로 `useCallback` 의존성 배열에
 * 안전하게 넣을 수 있다.
 */
export function useLatestRequest(): LatestRequestGuard {
  const seqRef = useRef(0);
  const guardRef = useRef<LatestRequestGuard>();
  if (!guardRef.current) {
    guardRef.current = {
      next: () => {
        seqRef.current += 1;
        return seqRef.current;
      },
      isStale: (reqId: number) => reqId !== seqRef.current,
    };
  }
  return guardRef.current;
}
