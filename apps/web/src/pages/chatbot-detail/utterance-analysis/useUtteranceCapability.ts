import { useCallback, useEffect, useRef, useState } from 'react';
import type { UtteranceAnalysisCapability } from '@chat-bot/shared-types';
import { ApiError } from '../../../api/client';
import { utteranceAnalysesApi } from '../../../api/utteranceAnalyses';

/** `off` = 404(기능 꺼짐), `error` = 그 밖의 조회 실패(서버 판정에 맡긴다 — 화면 §3.4 마지막 문단). */
export type UtteranceCapabilityState =
  | { status: 'loading' }
  | { status: 'off' }
  | { status: 'error' }
  | { status: 'ready'; data: UtteranceAnalysisCapability };

/**
 * `GET …/capability`를 진입 시 1회 조회하고, `refresh()`로 조용히 다시 읽는다(목록 폴링 때마다 호출).
 * 이미 읽은 값이 있으면 재조회 실패로 덮어쓰지 않는다.
 */
export function useUtteranceCapability(chatbotId: string): { state: UtteranceCapabilityState; refresh: () => Promise<void> } {
  const [state, setState] = useState<UtteranceCapabilityState>({ status: 'loading' });
  const seqRef = useRef(0);

  const refresh = useCallback(async (): Promise<void> => {
    const seq = ++seqRef.current;
    try {
      const data = await utteranceAnalysesApi.capability(chatbotId);
      if (seq === seqRef.current) setState({ status: 'ready', data });
    } catch (e) {
      if (seq !== seqRef.current) return;
      if (e instanceof ApiError && e.status === 404) setState({ status: 'off' });
      else setState((prev) => (prev.status === 'ready' ? prev : { status: 'error' }));
    }
  }, [chatbotId]);

  useEffect(() => {
    setState({ status: 'loading' });
    void refresh();
    return () => {
      seqRef.current += 1;
    };
  }, [refresh]);

  return { state, refresh };
}
